import type { Pool, PoolClient } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { createSessionEventWorker, type SessionEventWorkerMetrics } from '../../services/api/src/session-event-worker.ts'
import type { ProviderUsageSample } from '../../services/api/src/session-contracts.ts'

const sessionId = 's'.repeat(43)
const turn = {
  turnId: 'turn-1', sessionId, sequence: 1,
  acceptedAt: '2026-10-01T00:01:00.000Z', phase: 'history', learnerMessage: 'What brings you in?',
  versions: {
    promptVersion: 'patient-turn-prompt-v7', modelVersion: 'gpt-6-luna',
    schemaVersion: 3, policyVersion: 'patient-turn-policy-v7', rubricVersion: null
  },
  learnerModality: 'typed', patientResponse: 'I have pelvic pain.', patientReportedFacts: [], historyCoverage: [],
  disclosedHistoryFields: [], disclosedFactIds: [], historyCoverageState: [], clinicalActions: []
}
const event = {
  eventId: turn.turnId, sessionId, sequence: turn.sequence, eventOrdinal: 0, eventType: 'accepted_turn',
  occurredAt: turn.acceptedAt, providerUsage: [], payload: turn
} as const

function usageSample(
  responseId: string,
  inputTokens: number,
  cachedInputTokens: number,
  outputTokens: number,
  durationMs: number
): ProviderUsageSample {
  return {
    responseId, model: 'gpt-6-luna', serviceTier: null,
    inputTokens, cachedInputTokens, cacheWriteTokens: 0,
    outputTokens, totalTokens: inputTokens + outputTokens, durationMs,
    pricingVersion: null, estimatedCostUsd: null
  }
}

function workerHarness(options: {
  existing?: boolean
  existingUsage?: Array<{
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
    duration_ms: number
  }>
  existingProviderUsage?: Array<{
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
  }>
  existingAudit?: { session_id: string; turn_id_hash: string; event_type: string; attempt_count: number; occurred_at: Date }
  failInsert?: boolean
  failUsageInsert?: boolean
  streamEvent?: unknown
  prior?: { sequence: number; event_ordinal: number }
  workerOptions?: {
    metricsIntervalMs?: number
    onError?: (error: unknown) => void
    onMetrics?: (metrics: SessionEventWorkerMetrics) => void
  }
} = {}) {
  const order: string[] = []
  const streamEvent = JSON.stringify(options.streamEvent ?? event)
  const redis = {
    isOpen: true,
    connect: vi.fn(),
    sendCommand: vi.fn(async (command: string[]) => {
      if (command[0] === 'XGROUP') return 'OK'
      if (command[0] === 'XAUTOCLAIM') return ['0-0', [], []]
      if (command[0] === 'XREADGROUP') {
        return [['gptmd:session-events', [['1-0', ['event', streamEvent]]]]]
      }
      if (command[0] === 'XACK') {
        order.push('ack')
        return 1
      }
      if (command[0] === 'XINFO' && command[1] === 'GROUPS') {
        return [[
          'name', 'gptmd-session-history', 'consumers', 1, 'pending', 2,
          'last-delivered-id', '1700000001000-0', 'entries-read', 2, 'lag', 3
        ]]
      }
      if (command[0] === 'XPENDING') return [2, '1700000000000-0', '1700000001000-0', []]
      throw new Error(`Unexpected Redis command: ${command[0]}`)
    })
  }
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      order.push(sql.toLowerCase())
      return { rows: [], rowCount: 0 }
    }
    if (sql.includes('SELECT status, tenant_id, subject_id FROM app_sessions')) {
      return { rows: [{ status: 'ready', tenant_id: 'tenant-a', subject_id: 'learner-a' }], rowCount: 1 }
    }
    if (sql.includes('SELECT tenant_id, subject_id FROM app_sessions')) {
      return { rows: [{ tenant_id: 'tenant-a', subject_id: 'learner-a' }], rowCount: 1 }
    }
    if (sql.includes('FROM session_turn_audits WHERE audit_id')) {
      return { rows: options.existingAudit ? [options.existingAudit] : [], rowCount: options.existingAudit ? 1 : 0 }
    }
    if (sql.includes('SELECT sequence, event_ordinal, event_type, occurred_at')) {
      return options.existing
        ? { rows: [{ sequence: 1, event_ordinal: 0, event_type: 'accepted_turn', occurred_at: new Date(turn.acceptedAt), payload_matches: true }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    }
    if (sql.includes('SELECT sequence, event_ordinal FROM session_events')) {
      return { rows: options.prior ? [options.prior] : [], rowCount: options.prior ? 1 : 0 }
    }
    if (sql.includes('FROM provider_usage WHERE session_id')) {
      return { rows: options.existingUsage ?? [], rowCount: options.existingUsage?.length ?? 0 }
    }
    if (sql.includes("FROM provider_usage WHERE provider = 'openai'")) {
      return { rows: options.existingProviderUsage ?? [], rowCount: options.existingProviderUsage?.length ?? 0 }
    }
    if (sql.includes('INSERT INTO provider_usage')) {
      if (options.failUsageInsert) throw new Error('usage database unavailable')
      order.push('insert-usage')
      expect(values?.[1]).toBe(sessionId)
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('INSERT INTO session_events')) {
      if (options.failInsert) throw new Error('database unavailable')
      order.push('insert')
      expect(values?.[1]).toBe(sessionId)
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('INSERT INTO session_turn_audits')) {
      if (options.failInsert) throw new Error('database unavailable')
      order.push('insert-audit')
      expect(values?.[1]).toBe(sessionId)
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('UPDATE app_sessions')) return { rows: [], rowCount: 1 }
    throw new Error(`Unexpected PostgreSQL query: ${sql}`)
  })
  const client = { query, release: vi.fn() } as unknown as PoolClient
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool
  const worker = createSessionEventWorker(redis, pool, {
    consumerName: 'test-worker', blockMs: 1, ...options.workerOptions
  })
  return { worker, order, redis, query, client }
}

describe('PostgreSQL session event worker', () => {
  it('reports stream backlog, oldest pending age, and persistence lag without event content', async () => {
    const onMetrics = vi.fn()
    const harness = workerHarness({ workerOptions: { metricsIntervalMs: 0, onMetrics } })

    await expect(harness.worker.processOnce()).resolves.toBe(1)

    expect(onMetrics).toHaveBeenCalledWith(expect.objectContaining({
      processedEvents: 1,
      pendingEvents: 2,
      undeliveredEvents: 3,
      backlogEvents: 5,
      oldestPendingAgeMs: expect.any(Number),
      maxPersistenceLagMs: expect.any(Number)
    }))
    const metrics = onMetrics.mock.calls[0]?.[0]
    expect(metrics?.oldestPendingAgeMs).toBeGreaterThan(0)
    expect(metrics).not.toHaveProperty('sessionId')
    expect(JSON.stringify(metrics)).not.toContain('Pelvic pain')
  })

  it('keeps persistence and acknowledgement successful when the metrics observer fails', async () => {
    const onError = vi.fn()
    const onMetrics = vi.fn(() => { throw new Error('metrics sink unavailable') })
    const harness = workerHarness({ workerOptions: { metricsIntervalMs: 0, onMetrics, onError } })

    await expect(harness.worker.processOnce()).resolves.toBe(1)

    expect(harness.order).toEqual(['begin', 'insert', 'commit', 'ack'])
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'metrics sink unavailable' }))
  })

  it('commits accepted history before acknowledging its stream entry', async () => {
    const harness = workerHarness()

    await expect(harness.worker.processOnce()).resolves.toBe(1)

    expect(harness.order).toEqual(['begin', 'insert', 'commit', 'ack'])
    expect(harness.client.release).toHaveBeenCalledOnce()
  })

  it('acknowledges a PostgreSQL duplicate after verifying its saved payload', async () => {
    const harness = workerHarness({ existing: true })

    await expect(harness.worker.processOnce()).resolves.toBe(1)

    expect(harness.order).toEqual(['begin', 'commit', 'ack'])
    expect(harness.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO session_events'), expect.anything())
  })

  it('persists provider token usage atomically with accepted history before acknowledgement', async () => {
    const usage = usageSample('resp-private', 120, 20, 30, 842)
    const harness = workerHarness({ streamEvent: { ...event, providerUsage: [usage] } })

    await expect(harness.worker.processOnce()).resolves.toBe(1)

    expect(harness.order).toEqual(['begin', 'insert', 'insert-usage', 'commit', 'ack'])
    expect(harness.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO provider_usage'), [
      expect.any(String), sessionId, 'tenant-a', 'learner-a', turn.turnId, 'resp-private',
      'gpt-6-luna', null, 120, 20, 0, 30, 150, null, null, 842, turn.acceptedAt
    ])
    const persistedTurn = harness.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO session_events'))?.[1]?.[6]
    expect(JSON.parse(String(persistedTurn))).toEqual(turn)
    expect(String(persistedTurn)).not.toContain('resp-private')
  })

  it('verifies saved provider usage on duplicate delivery instead of counting it twice', async () => {
    const usage = usageSample('resp-private', 120, 20, 30, 842)
    const harness = workerHarness({
      existing: true,
      streamEvent: { ...event, providerUsage: [usage] },
      existingUsage: [{
        provider_response_id: usage.responseId, model_id: usage.model, service_tier: usage.serviceTier,
        input_tokens: usage.inputTokens, cached_input_tokens: usage.cachedInputTokens,
        cache_write_tokens: usage.cacheWriteTokens, output_tokens: usage.outputTokens,
        total_tokens: usage.totalTokens, estimated_cost_usd: usage.estimatedCostUsd,
        pricing_version: usage.pricingVersion, duration_ms: usage.durationMs
      }]
    })

    await expect(harness.worker.processOnce()).resolves.toBe(1)

    expect(harness.order).toEqual(['begin', 'commit', 'ack'])
    expect(harness.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO provider_usage'), expect.anything())
  })

  it('keeps mismatched usage on a duplicate event pending for diagnosis', async () => {
    const harness = workerHarness({
      existing: true,
      streamEvent: { ...event, providerUsage: [usageSample('resp-private', 120, 20, 30, 842)] }
    })

    await expect(harness.worker.processOnce()).rejects.toThrow('different provider usage')

    expect(harness.order).toEqual(['begin', 'rollback'])
    expect(harness.redis.sendCommand).not.toHaveBeenCalledWith(['XACK', 'gptmd:session-events', 'gptmd-session-history', '1-0'])
  })

  it('persists setup-generation usage without adding it to clinical session history', async () => {
    const usage = usageSample('resp-setup', 900, 0, 300, 3420)
    const streamEvent = {
      eventId: 'usage_79f9b28a', sessionId, eventType: 'provider_usage',
      operation: 'scenario_generation', occurredAt: turn.acceptedAt, usage
    }
    const harness = workerHarness({ streamEvent })

    await expect(harness.worker.processOnce()).resolves.toBe(1)

    expect(harness.order).toEqual(['begin', 'insert-usage', 'commit', 'ack'])
    expect(harness.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO provider_usage'), [
      expect.any(String), sessionId, 'tenant-a', 'learner-a', 'scenario_generation',
      'resp-setup', 'gpt-6-luna', null, 900, 0, 0, 300, 1200, null, null, 3420, turn.acceptedAt
    ])
    expect(harness.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO session_events'), expect.anything())
  })

  it('acknowledges setup-usage retries only when the stored provider row matches', async () => {
    const usage = usageSample('resp-setup', 900, 0, 300, 3420)
    const streamEvent = {
      eventId: 'usage_79f9b28a', sessionId, eventType: 'provider_usage',
      operation: 'scenario_generation', occurredAt: turn.acceptedAt, usage
    }
    const harness = workerHarness({
      streamEvent,
      existingProviderUsage: [{
        session_id: sessionId, operation: 'scenario_generation', model_id: usage.model,
        service_tier: usage.serviceTier, input_tokens: 900, cached_input_tokens: 0,
        cache_write_tokens: 0, output_tokens: 300, total_tokens: 1200,
        estimated_cost_usd: null, pricing_version: null,
        duration_ms: 3420, occurred_at: new Date(turn.acceptedAt)
      }]
    })

    await expect(harness.worker.processOnce()).resolves.toBe(1)

    expect(harness.order).toEqual(['begin', 'commit', 'ack'])
    expect(harness.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO provider_usage'), expect.anything())
  })

  it('rejects accepted-turn stream entries without first-generation fields and leaves them pending', async () => {
    const { learnerModality: _learnerModality, ...turnWithoutModality } = turn
    const eventWithoutOrdinal: Record<string, unknown> = { ...event }
    delete eventWithoutOrdinal.eventOrdinal
    const oldShapes = [
      { ...event, payload: turnWithoutModality },
      eventWithoutOrdinal
    ]

    for (const streamEvent of oldShapes) {
      const harness = workerHarness({ streamEvent })
      await expect(harness.worker.processOnce()).rejects.toThrow()
      expect(harness.order).toEqual([])
      expect(harness.redis.sendCommand).not.toHaveBeenCalledWith([
        'XACK', 'gptmd:session-events', 'gptmd-session-history', '1-0'
      ])
    }
  })

  it('leaves a stream entry pending when the database commit path fails', async () => {
    const harness = workerHarness({ failInsert: true })

    await expect(harness.worker.processOnce()).rejects.toThrow('database unavailable')

    expect(harness.order).toEqual(['begin', 'rollback'])
    expect(harness.redis.sendCommand).not.toHaveBeenCalledWith(['XACK', 'gptmd:session-events', 'gptmd-session-history', '1-0'])
  })

  it('leaves the accepted event pending when usage persistence fails', async () => {
    const harness = workerHarness({
      failUsageInsert: true,
      streamEvent: { ...event, providerUsage: [usageSample('resp-private', 120, 20, 30, 842)] }
    })

    await expect(harness.worker.processOnce()).rejects.toThrow('usage database unavailable')

    expect(harness.order).toEqual(['begin', 'insert', 'rollback'])
    expect(harness.redis.sendCommand).not.toHaveBeenCalledWith(['XACK', 'gptmd:session-events', 'gptmd-session-history', '1-0'])
  })

  it('persists each disclosure after its accepted turn using a per-turn ordinal', async () => {
    const disclosure = {
      eventId: 'disclosure-1', sessionId, sequence: 1, eventOrdinal: 1,
      eventType: 'disclosure', occurredAt: turn.acceptedAt,
      payload: {
        turnId: turn.turnId, turnSequence: 1, field: 'anyPain', factId: 'fact-1', source: 'patient_reported'
      }
    }
    const harness = workerHarness({ streamEvent: disclosure, prior: { sequence: 1, event_ordinal: 0 } })

    await expect(harness.worker.processOnce()).resolves.toBe(1)

    expect(harness.order).toEqual(['begin', 'insert', 'commit', 'ack'])
    expect(harness.query).toHaveBeenCalledWith(
      expect.stringContaining('event_ordinal, event_type'),
      [disclosure.eventId, sessionId, disclosure.sequence, disclosure.eventOrdinal,
        disclosure.eventType, disclosure.occurredAt, JSON.stringify(disclosure.payload)]
    )
  })

  it('persists a confirmed assessment phase after the last disclosure ordinal', async () => {
    const phaseChange = {
      eventId: 'transition-1', sessionId, sequence: 1, eventOrdinal: 1,
      eventType: 'phase_changed', occurredAt: turn.acceptedAt,
      payload: {
        transitionId: 'transition-1', sessionId, turnSequence: 1,
        from: 'history', to: 'assessment', occurredAt: turn.acceptedAt
      }
    }
    const harness = workerHarness({ streamEvent: phaseChange, prior: { sequence: 1, event_ordinal: 0 } })

    await expect(harness.worker.processOnce()).resolves.toBe(1)
    expect(harness.order).toEqual(['begin', 'insert', 'commit', 'ack'])
  })

  it('persists the unscored assessment after the phase event in the same turn sequence', async () => {
    const assessment = {
      assessmentId: 'assessment-1', sessionId, turnSequence: 1,
      submittedAt: turn.acceptedAt, summary: 'Pelvic pain since yesterday.',
      differential: 'Ovarian cyst.', rationale: 'Acute onset.', plan: 'Evaluate further.'
    }
    const submission = {
      eventId: assessment.assessmentId, sessionId, sequence: 1, eventOrdinal: 2,
      eventType: 'assessment_submitted', occurredAt: turn.acceptedAt, payload: assessment
    }
    const harness = workerHarness({ streamEvent: submission, prior: { sequence: 1, event_ordinal: 1 } })

    await expect(harness.worker.processOnce()).resolves.toBe(1)
    expect(harness.order).toEqual(['begin', 'insert', 'commit', 'ack'])
    const insert = harness.query.mock.calls.find(([sql]) => sql.includes('INSERT INTO session_events'))
    expect(insert?.[1]?.slice(0, 6)).toEqual([
      submission.eventId, sessionId, submission.sequence, submission.eventOrdinal,
      submission.eventType, submission.occurredAt
    ])
    expect(JSON.parse(String(insert?.[1]?.[6]))).toEqual(submission.payload)
  })

  it('persists a bounded turn-failure audit and acknowledges it only after commit', async () => {
    const audit = {
      eventId: '58fa91f0-77f4-4dc7-a055-7783f0270c00', sessionId,
      eventType: 'patient_turn_validation_failure', occurredAt: turn.acceptedAt,
      payload: { turnIdHash: 'a'.repeat(64), attemptCount: 2 }
    } as const
    const harness = workerHarness({ streamEvent: audit })

    await expect(harness.worker.processOnce()).resolves.toBe(1)

    expect(harness.order).toEqual(['begin', 'insert-audit', 'commit', 'ack'])
    expect(harness.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO session_turn_audits'), [
      audit.eventId, sessionId, audit.payload.turnIdHash, audit.eventType, audit.payload.attemptCount, audit.occurredAt
    ])
  })

  it('acks an identical audit retry without inserting it twice', async () => {
    const audit = {
      eventId: '66d4bbd2-7d02-43bf-a818-2207a1fc99ad', sessionId,
      eventType: 'patient_turn_model_failure', occurredAt: turn.acceptedAt,
      payload: { turnIdHash: 'b'.repeat(64), attemptCount: 1 }
    } as const
    const harness = workerHarness({
      streamEvent: audit,
      existingAudit: {
        session_id: sessionId, turn_id_hash: audit.payload.turnIdHash, event_type: audit.eventType,
        attempt_count: audit.payload.attemptCount, occurred_at: new Date(audit.occurredAt)
      }
    })

    await expect(harness.worker.processOnce()).resolves.toBe(1)

    expect(harness.order).toEqual(['begin', 'commit', 'ack'])
    expect(harness.query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO session_turn_audits'), expect.anything())
  })

  it('leaves an audit stream entry pending when its database transaction fails', async () => {
    const audit = {
      eventId: '6f644d9f-f9ab-46af-8855-2d0b856235dd', sessionId,
      eventType: 'patient_turn_model_failure', occurredAt: turn.acceptedAt,
      payload: { turnIdHash: 'c'.repeat(64), attemptCount: 1 }
    } as const
    const harness = workerHarness({ streamEvent: audit, failInsert: true })

    await expect(harness.worker.processOnce()).rejects.toThrow('database unavailable')

    expect(harness.order).toEqual(['begin', 'rollback'])
    expect(harness.redis.sendCommand).not.toHaveBeenCalledWith([
      'XACK', 'gptmd:session-events', 'gptmd-session-history', '1-0'
    ])
  })
})
