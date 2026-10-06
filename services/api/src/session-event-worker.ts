import { createHash } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { RedisJsonClient } from './patient-state-store.ts'
import {
  SessionAuditEventSchema,
  SessionHistoryEventSchema,
  SessionProviderUsageEventSchema,
  type SessionAuditEvent,
  type SessionHistoryEvent,
  type SessionProviderUsageEvent
} from './session-contracts.ts'

const STREAM_KEY = 'gptmd:session-events'
const CONSUMER_GROUP = 'gptmd-session-history'
const BATCH_SIZE = 10
const CLAIM_IDLE_MS = 1_000

type StreamEntry = { id: string; fields: Record<string, string> }

export type SessionEventWorker = {
  ensureGroup(): Promise<void>
  processOnce(): Promise<number>
  run(signal?: AbortSignal): Promise<void>
}

export type SessionEventWorkerMetrics = {
  observedAt: string
  processedEvents: number
  pendingEvents: number
  undeliveredEvents: number
  backlogEvents: number
  oldestPendingAgeMs: number | null
  maxPersistenceLagMs: number | null
}

export function createSessionEventWorker(
  redis: RedisJsonClient,
  pool: Pool,
  options: {
    consumerName?: string
    blockMs?: number
    metricsIntervalMs?: number
    onError?: (error: unknown) => void
    onMetrics?: (metrics: SessionEventWorkerMetrics) => void
  } = {}
): SessionEventWorker {
  const consumerName = options.consumerName ?? `gptmd-${process.pid}`
  const blockMs = options.blockMs ?? 1_000
  const metricsIntervalMs = options.metricsIntervalMs ?? 30_000
  let groupReady = false
  let lastMetricsAt = Date.now()
  let processedEventsSinceMetrics = 0
  let maxPersistenceLagMsSinceMetrics: number | null = null

  return {
    async ensureGroup() {
      if (!redis.isOpen) await redis.connect()
      try {
        await redis.sendCommand(['XGROUP', 'CREATE', STREAM_KEY, CONSUMER_GROUP, '0-0', 'MKSTREAM'])
      } catch (error) {
        if (!String(error).includes('BUSYGROUP')) throw error
      }
      groupReady = true
    },

    async processOnce() {
      if (!groupReady) await this.ensureGroup()
      const reclaimed = parseAutoClaim(await redis.sendCommand([
        'XAUTOCLAIM', STREAM_KEY, CONSUMER_GROUP, consumerName,
        String(CLAIM_IDLE_MS), '0-0', 'COUNT', String(BATCH_SIZE)
      ]))
      const entries = reclaimed.length > 0
        ? reclaimed
        : parseReadGroup(await redis.sendCommand([
            'XREADGROUP', 'GROUP', CONSUMER_GROUP, consumerName,
            'COUNT', String(BATCH_SIZE), 'BLOCK', String(blockMs), 'STREAMS', STREAM_KEY, '>'
          ]))
      let completed = 0
      for (const entry of entries) {
        const eventText = entry.fields.event
        if (!eventText) throw new Error('Redis session event is missing its event payload')
        const rawEvent: unknown = JSON.parse(eventText)
        const auditEvent = SessionAuditEventSchema.safeParse(rawEvent)
        const providerUsageEvent = auditEvent.success ? null : SessionProviderUsageEventSchema.safeParse(rawEvent)
        let occurredAt: string
        if (auditEvent.success) {
          occurredAt = auditEvent.data.occurredAt
          await persistAuditEvent(pool, auditEvent.data)
        } else if (providerUsageEvent?.success) {
          occurredAt = providerUsageEvent.data.occurredAt
          await persistProviderUsageEvent(pool, providerUsageEvent.data)
        } else {
          const historyEvent = SessionHistoryEventSchema.parse(rawEvent)
          occurredAt = historyEvent.occurredAt
          await persistEvent(pool, historyEvent)
        }
        const persistenceLagMs = Math.max(0, Date.now() - Date.parse(occurredAt))
        maxPersistenceLagMsSinceMetrics = Math.max(maxPersistenceLagMsSinceMetrics ?? 0, persistenceLagMs)
        processedEventsSinceMetrics += 1
        await redis.sendCommand(['XACK', STREAM_KEY, CONSUMER_GROUP, entry.id])
        completed += 1
      }
      if (options.onMetrics && Date.now() - lastMetricsAt >= metricsIntervalMs) {
        await reportWorkerMetrics(redis, options, {
          processedEvents: processedEventsSinceMetrics,
          maxPersistenceLagMs: maxPersistenceLagMsSinceMetrics
        })
        lastMetricsAt = Date.now()
        processedEventsSinceMetrics = 0
        maxPersistenceLagMsSinceMetrics = null
      }
      return completed
    },

    async run(signal = new AbortController().signal) {
      await this.ensureGroup()
      while (!signal.aborted) {
        try {
          await this.processOnce()
        } catch (error) {
          options.onError?.(error)
          await delay(Math.min(blockMs, 1_000), signal)
        }
      }
    }
  }
}

async function reportWorkerMetrics(
  redis: RedisJsonClient,
  callbacks: {
    onError?: (error: unknown) => void
    onMetrics?: (metrics: SessionEventWorkerMetrics) => void
  },
  interval: { processedEvents: number; maxPersistenceLagMs: number | null }
): Promise<void> {
  try {
    const groups = parseInfoGroups(await redis.sendCommand(['XINFO', 'GROUPS', STREAM_KEY]))
    const group = groups.find((item) => item.name === CONSUMER_GROUP)
    if (!group) throw new Error('Session event consumer group metrics are unavailable')
    const pendingEvents = readNonNegativeInteger(group.pending, 'pending')
    const undeliveredEvents = readNonNegativeInteger(group.lag, 'lag')
    const pendingSummary = pendingEvents > 0
      ? parsePendingSummary(await redis.sendCommand(['XPENDING', STREAM_KEY, CONSUMER_GROUP]))
      : null
    const oldestPendingAgeMs = pendingSummary?.oldestId
      ? Math.max(0, Date.now() - redisStreamIdTimestamp(pendingSummary.oldestId))
      : null
    callbacks.onMetrics?.({
      observedAt: new Date().toISOString(),
      processedEvents: interval.processedEvents,
      pendingEvents,
      undeliveredEvents,
      backlogEvents: pendingEvents + undeliveredEvents,
      oldestPendingAgeMs,
      maxPersistenceLagMs: interval.maxPersistenceLagMs
    })
  } catch (error) {
    try {
      callbacks.onError?.(error)
    } catch {
      // Observability errors must not alter event persistence or acknowledgement.
    }
  }
}

function parseInfoGroups(value: unknown): Array<Record<string, unknown>> {
  const rows = Array.isArray(value)
    ? value
    : isRecord(value) ? Object.values(value) : []
  return rows.map((row) => parseInfoPairs(row)).filter((row) => row.name !== undefined)
}

function parseInfoPairs(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value
  if (!Array.isArray(value)) return {}
  const result: Record<string, unknown> = {}
  for (let index = 0; index + 1 < value.length; index += 2) {
    const key = value[index]
    if (typeof key === 'string') result[key] = value[index + 1]
  }
  return result
}

function parsePendingSummary(value: unknown): { oldestId: string | null } {
  if (Array.isArray(value)) {
    return { oldestId: typeof value[1] === 'string' ? value[1] : null }
  }
  if (isRecord(value)) {
    const oldestId = value.min
    return { oldestId: typeof oldestId === 'string' ? oldestId : null }
  }
  return { oldestId: null }
}

function redisStreamIdTimestamp(id: string): number {
  const timestamp = Number(id.split('-', 1)[0])
  return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : Date.now()
}

function readNonNegativeInteger(value: unknown, field: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`Session event consumer group ${field} metric is invalid`)
  }
  return parsed
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function persistAuditEvent(pool: Pool, event: SessionAuditEvent): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const existing = await client.query<{
      session_id: string
      turn_id_hash: string
      event_type: string
      attempt_count: number
      occurred_at: Date
    }>(
      `SELECT session_id, turn_id_hash, event_type, attempt_count, occurred_at
       FROM session_turn_audits WHERE audit_id = $1`,
      [event.eventId]
    )
    const row = existing.rows[0]
    if (row) {
      const matches = row.session_id === event.sessionId && row.turn_id_hash === event.payload.turnIdHash &&
        row.event_type === event.eventType && row.attempt_count === event.payload.attemptCount &&
        row.occurred_at.getTime() === Date.parse(event.occurredAt)
      if (!matches) throw new Error('A durable audit ID was reused with different content')
      await client.query('COMMIT')
      return
    }

    await client.query(
      `INSERT INTO session_turn_audits
         (audit_id, session_id, turn_id_hash, event_type, attempt_count, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [event.eventId, event.sessionId, event.payload.turnIdHash, event.eventType,
        event.payload.attemptCount, event.occurredAt]
    )
    await client.query('COMMIT')
  } catch (error) {
    await rollback(client)
    throw error
  } finally {
    client.release()
  }
}

async function persistProviderUsageEvent(pool: Pool, event: SessionProviderUsageEvent): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const session = await client.query<{ tenant_id: string; subject_id: string }>(
      `SELECT tenant_id, subject_id FROM app_sessions WHERE session_id = $1`,
      [event.sessionId]
    )
    const owner = session.rows[0]
    if (!owner) throw new Error('Provider usage event references an unknown session')
    const existing = await client.query<{
      session_id: string
      operation: string
      model_id: string | null
      service_tier: string | null
      input_tokens: number
      cached_input_tokens: number
      cache_write_tokens: number
      output_tokens: number
      total_tokens: number
      estimated_cost_usd: string | null
      pricing_version: string | null
      duration_ms: number | null
      occurred_at: Date
    }>(
      `SELECT session_id, operation, model_id, service_tier, input_tokens, cached_input_tokens,
              cache_write_tokens, output_tokens, total_tokens, estimated_cost_usd,
              pricing_version, duration_ms, occurred_at
       FROM provider_usage WHERE provider = 'openai' AND provider_response_id = $1`,
      [event.usage.responseId]
    )
    const stored = existing.rows[0]
    if (stored) {
      const matches = stored.session_id === event.sessionId && stored.operation === event.operation &&
        stored.model_id === event.usage.model && stored.service_tier === event.usage.serviceTier &&
        Number(stored.input_tokens) === event.usage.inputTokens &&
        Number(stored.cached_input_tokens) === event.usage.cachedInputTokens &&
        Number(stored.cache_write_tokens) === event.usage.cacheWriteTokens &&
        Number(stored.output_tokens) === event.usage.outputTokens &&
        Number(stored.total_tokens) === event.usage.totalTokens &&
        (stored.estimated_cost_usd === null ? null : Number(stored.estimated_cost_usd)) ===
          (event.usage.estimatedCostUsd === null ? null : Number(event.usage.estimatedCostUsd)) &&
        stored.pricing_version === event.usage.pricingVersion &&
        stored.duration_ms === event.usage.durationMs &&
        stored.occurred_at.getTime() === Date.parse(event.occurredAt)
      if (!matches) throw new Error('A provider response ID was reused with different usage')
      await client.query('COMMIT')
      return
    }

    const usageId = createHash('sha256').update(`openai\0${event.usage.responseId}`).digest('hex')
    await client.query(
      `INSERT INTO provider_usage (
         usage_id, session_id, tenant_id, subject_id, event_id, provider, operation,
         provider_response_id, model_id, service_tier, input_tokens, cached_input_tokens,
         cache_write_tokens, output_tokens, total_tokens, estimated_cost_usd, pricing_version,
         duration_ms, occurred_at
       ) VALUES ($1, $2, $3, $4, NULL, 'openai', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [usageId, event.sessionId, owner.tenant_id, owner.subject_id, event.operation,
        event.usage.responseId, event.usage.model, event.usage.serviceTier, event.usage.inputTokens,
        event.usage.cachedInputTokens, event.usage.cacheWriteTokens, event.usage.outputTokens,
        event.usage.totalTokens, event.usage.estimatedCostUsd, event.usage.pricingVersion,
        event.usage.durationMs, event.occurredAt]
    )
    await client.query('COMMIT')
  } catch (error) {
    await rollback(client)
    throw error
  } finally {
    client.release()
  }
}

async function persistEvent(pool: Pool, event: SessionHistoryEvent): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const session = await client.query<{ status: string; tenant_id: string; subject_id: string }>(
      `SELECT status, tenant_id, subject_id FROM app_sessions WHERE session_id = $1 FOR UPDATE`,
      [event.sessionId]
    )
    if (!session.rows[0]) throw new Error('Event references an unknown session')

    const duplicate = await client.query<{
      sequence: string | number
      event_ordinal: number
      event_type: string
      occurred_at: Date
      payload_matches: boolean
    }>(
      `SELECT sequence, event_ordinal, event_type, occurred_at, payload = $3::jsonb AS payload_matches
       FROM session_events WHERE session_id = $1 AND event_id = $2`,
      [event.sessionId, event.eventId, event.payload]
    )
    const existing = duplicate.rows[0]
    if (existing) {
      const matches = Number(existing.sequence) === event.sequence &&
        existing.event_ordinal === event.eventOrdinal &&
        existing.event_type === event.eventType && existing.payload_matches &&
        existing.occurred_at.getTime() === Date.parse(event.occurredAt)
      if (!matches) throw new Error('A durable event ID was reused with different content')
      if (event.eventType === 'accepted_turn') {
        const usageRows = await client.query<{
          provider_response_id: string
          model_id: string | null
          service_tier: string | null
          input_tokens: number
          cached_input_tokens: number
          cache_write_tokens: number
          output_tokens: number
          total_tokens: number
          estimated_cost_usd: string | null
          pricing_version: string | null
          duration_ms: number | null
        }>(
          `SELECT provider_response_id, model_id, service_tier, input_tokens, cached_input_tokens,
                  cache_write_tokens, output_tokens, total_tokens, estimated_cost_usd,
                  pricing_version, duration_ms
           FROM provider_usage WHERE session_id = $1 AND event_id = $2 ORDER BY provider_response_id`,
          [event.sessionId, event.eventId]
        )
        const expected = [...event.providerUsage].sort((a, b) => a.responseId < b.responseId ? -1 : a.responseId > b.responseId ? 1 : 0)
        const actual = usageRows.rows.map((row) => ({
          responseId: row.provider_response_id,
          model: row.model_id,
          serviceTier: row.service_tier,
          inputTokens: Number(row.input_tokens),
          cachedInputTokens: Number(row.cached_input_tokens),
          cacheWriteTokens: Number(row.cache_write_tokens),
          outputTokens: Number(row.output_tokens),
          totalTokens: Number(row.total_tokens),
          durationMs: row.duration_ms === null ? null : Number(row.duration_ms),
          pricingVersion: row.pricing_version,
          estimatedCostUsd: row.estimated_cost_usd === null ? null : Number(row.estimated_cost_usd).toFixed(12)
        })).sort((a, b) => a.responseId < b.responseId ? -1 : a.responseId > b.responseId ? 1 : 0)
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error('A durable accepted-turn event has different provider usage')
        }
      }
      await client.query('COMMIT')
      return
    }

    if (['accepted_turn', 'disclosure', 'phase_changed', 'assessment_submitted'].includes(event.eventType) &&
        !['ready', 'active'].includes(session.rows[0].status)) {
      throw new Error(`${event.eventType} arrived for a non-active session`)
    }
    if (event.eventType === 'terminal' && !['ready', 'active'].includes(session.rows[0].status)) {
      throw new Error('Terminal event arrived for an already terminal session')
    }

    const latest = await client.query<{ sequence: string | number | null; event_ordinal: number | null }>(
      `SELECT sequence, event_ordinal FROM session_events
       WHERE session_id = $1 ORDER BY sequence DESC, event_ordinal DESC LIMIT 1`,
      [event.sessionId]
    )
    const latestSequence = Number(latest.rows[0]?.sequence ?? 0)
    const latestOrdinal = Number(latest.rows[0]?.event_ordinal ?? 0)
    const orderedAtCurrentTurn = ['disclosure', 'phase_changed', 'assessment_submitted'].includes(event.eventType)
    const expectedSequence = orderedAtCurrentTurn ? latestSequence : latestSequence + 1
    const expectedOrdinal = orderedAtCurrentTurn ? latestOrdinal + 1 : 0
    if (event.sequence !== expectedSequence || event.eventOrdinal !== expectedOrdinal) {
      throw new Error(`Session history is out of order: expected ${expectedSequence}.${expectedOrdinal}`)
    }

    await client.query(
      `INSERT INTO session_events (event_id, session_id, sequence, event_ordinal, event_type, occurred_at, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [event.eventId, event.sessionId, event.sequence, event.eventOrdinal,
        event.eventType, event.occurredAt, JSON.stringify(event.payload)]
    )

    if (event.eventType === 'accepted_turn') {
      for (const usage of event.providerUsage) {
        const usageId = createHash('sha256').update(`openai\0${usage.responseId}`).digest('hex')
        await client.query(
          `INSERT INTO provider_usage (
             usage_id, session_id, tenant_id, subject_id, event_id, provider, operation,
             provider_response_id, model_id, service_tier, input_tokens, cached_input_tokens,
             cache_write_tokens, output_tokens, total_tokens, estimated_cost_usd, pricing_version,
             duration_ms, occurred_at
           ) VALUES ($1, $2, $3, $4, $5, 'openai', 'patient_turn', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
          [usageId, event.sessionId, session.rows[0].tenant_id, session.rows[0].subject_id,
            event.eventId, usage.responseId, usage.model, usage.serviceTier, usage.inputTokens,
            usage.cachedInputTokens, usage.cacheWriteTokens, usage.outputTokens, usage.totalTokens,
            usage.estimatedCostUsd, usage.pricingVersion, usage.durationMs, event.occurredAt]
        )
      }
      await client.query(
        `UPDATE app_sessions SET status = 'active', updated_at = $2 WHERE session_id = $1
           AND status IN ('ready', 'active')`,
        [event.sessionId, event.occurredAt]
      )
    } else if (event.eventType === 'terminal') {
      await persistTerminalOutcome(client, event)
    }
    await client.query('COMMIT')
  } catch (error) {
    await rollback(client)
    throw error
  } finally {
    client.release()
  }
}

async function persistTerminalOutcome(
  client: PoolClient,
  event: Extract<SessionHistoryEvent, { eventType: 'terminal' }>
): Promise<void> {
  const terminal = event.payload
  await client.query(
    `UPDATE app_sessions SET status = $2, updated_at = $3 WHERE session_id = $1
       AND status IN ('ready', 'active', 'completed', 'cancelled')`,
    [event.sessionId, terminal.outcome, terminal.occurredAt]
  )
  await client.query(
    `INSERT INTO session_outcomes (
       session_id, terminal_event_id, outcome, final_turn_sequence, success, reason, occurred_at
     ) VALUES ($1, $2, $3, $4, NULL, $5, $6)`,
    [event.sessionId, terminal.eventId, terminal.outcome, terminal.finalTurnSequence, terminal.reason, terminal.occurredAt]
  )
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK')
  } catch {
    // Keep the original persistence error.
  }
}

function parseReadGroup(value: unknown): StreamEntry[] {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return Object.values(value).flatMap((entries) => parseEntries(entries))
  }
  if (!Array.isArray(value) || !value.length) return []
  const entries: StreamEntry[] = []
  for (const stream of value) {
    if (!Array.isArray(stream) || !Array.isArray(stream[1])) continue
    entries.push(...parseEntries(stream[1]))
  }
  return entries
}

function parseAutoClaim(value: unknown): StreamEntry[] {
  return Array.isArray(value) ? parseEntries(value[1]) : []
}

function parseEntries(value: unknown): StreamEntry[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry) => {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') return []
    const rawFields = entry[1]
    if (Array.isArray(rawFields)) {
      const fields: Record<string, string> = {}
      for (let i = 0; i + 1 < rawFields.length; i += 2) {
        const key = rawFields[i]
        if (typeof key === 'string') fields[key] = String(rawFields[i + 1])
      }
      return [{ id: entry[0], fields }]
    }
    if (rawFields instanceof Map) {
      return [{ id: entry[0], fields: Object.fromEntries(rawFields) as Record<string, string> }]
    }
    if (typeof rawFields === 'object' && rawFields !== null) {
      return [{ id: entry[0], fields: Object.fromEntries(Object.entries(rawFields).map(([key, item]) => [key, String(item)])) }]
    }
    return []
  })
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(resolve, milliseconds)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}
