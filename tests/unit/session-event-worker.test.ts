import type { Pool, PoolClient } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { createSessionEventWorker } from '../../services/api/src/session-event-worker.ts'

const sessionId = 's'.repeat(43)
const turn = {
  turnId: 'turn-1', sessionId, sequence: 1,
  acceptedAt: '2026-10-01T00:01:00.000Z', phase: 'history', learnerMessage: 'What brings you in?',
  patientResponse: 'I have pelvic pain.', patientReportedFacts: [], historyCoverage: [],
  disclosedHistoryFields: [], disclosedFactIds: [], clinicalActions: []
}
const event = {
  eventId: turn.turnId, sessionId, sequence: turn.sequence, eventType: 'accepted_turn',
  occurredAt: turn.acceptedAt, payload: turn
} as const

function workerHarness(options: { existing?: boolean; failInsert?: boolean } = {}) {
  const order: string[] = []
  const streamEvent = JSON.stringify(event)
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
      throw new Error(`Unexpected Redis command: ${command[0]}`)
    })
  }
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      order.push(sql.toLowerCase())
      return { rows: [], rowCount: 0 }
    }
    if (sql.includes('SELECT status FROM app_sessions')) return { rows: [{ status: 'ready' }], rowCount: 1 }
    if (sql.includes('SELECT sequence, event_type, occurred_at')) {
      return options.existing
        ? { rows: [{ sequence: 1, event_type: 'accepted_turn', occurred_at: new Date(turn.acceptedAt), payload_matches: true }], rowCount: 1 }
        : { rows: [], rowCount: 0 }
    }
    if (sql.includes('SELECT sequence FROM session_events')) return { rows: [], rowCount: 0 }
    if (sql.includes('INSERT INTO session_events')) {
      if (options.failInsert) throw new Error('database unavailable')
      order.push('insert')
      expect(values?.[1]).toBe(sessionId)
      return { rows: [], rowCount: 1 }
    }
    if (sql.includes('UPDATE app_sessions')) return { rows: [], rowCount: 1 }
    throw new Error(`Unexpected PostgreSQL query: ${sql}`)
  })
  const client = { query, release: vi.fn() } as unknown as PoolClient
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool
  const worker = createSessionEventWorker(redis, pool, { consumerName: 'test-worker', blockMs: 1 })
  return { worker, order, redis, query, client }
}

describe('PostgreSQL session event worker', () => {
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

  it('leaves a stream entry pending when the database commit path fails', async () => {
    const harness = workerHarness({ failInsert: true })

    await expect(harness.worker.processOnce()).rejects.toThrow('database unavailable')

    expect(harness.order).toEqual(['begin', 'rollback'])
    expect(harness.redis.sendCommand).not.toHaveBeenCalledWith(['XACK', 'gptmd:session-events', 'gptmd-session-history', '1-0'])
  })
})
