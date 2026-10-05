import type { Pool, PoolClient } from 'pg'
import type { RedisJsonClient } from './patient-state-store.ts'
import {
  SessionAuditEventSchema,
  SessionHistoryEventSchema,
  type SessionAuditEvent,
  type SessionHistoryEvent
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

export function createSessionEventWorker(
  redis: RedisJsonClient,
  pool: Pool,
  options: { consumerName?: string; blockMs?: number; onError?: (error: unknown) => void } = {}
): SessionEventWorker {
  const consumerName = options.consumerName ?? `gptmd-${process.pid}`
  const blockMs = options.blockMs ?? 1_000
  let groupReady = false

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
        if (auditEvent.success) await persistAuditEvent(pool, auditEvent.data)
        else await persistEvent(pool, SessionHistoryEventSchema.parse(rawEvent))
        await redis.sendCommand(['XACK', STREAM_KEY, CONSUMER_GROUP, entry.id])
        completed += 1
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

async function persistEvent(pool: Pool, event: SessionHistoryEvent): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const session = await client.query<{ status: string }>(
      `SELECT status FROM app_sessions WHERE session_id = $1 FOR UPDATE`,
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
