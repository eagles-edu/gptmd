import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import {
  createPostgresProviderTokenReservationStore,
  ProviderTokenBudgetExceeded
} from '../../services/api/src/provider-token-reservations.ts'
import { getProratedMonthlyDepartmentTokens } from '../../services/api/src/organization-ai-time-budget.ts'

const activeSettings = {
  schemaVersion: 1,
  revision: 1,
  status: 'active',
  organizationPeriod: { months: 1, anchorDate: '2026-01-01' },
  organizationPool: { tokens: 100_000, estimatedMinutes: 100_000 },
  groups: [{
    code: 'gptnursing', name: 'Nursing', tokenBudget: 100_000, estimatedMinuteBudget: 100_000,
    monthlyTokensPerUser: 80_000, monthlyEstimatedMinutesPerUser: null
  }],
  departments: []
}

function makeClient(
  usedTokens: string | string[] = '0',
  status = 'active',
  departmentTokens?: number,
  departmentAssignedAt?: Date,
  grants: Array<{
    grant_id: string
    account_scope: 'consumer' | 'organization'
    bucket_kind: 'included' | 'addon'
    remaining_tokens: string
  }> = [
    { grant_id: 'org-included', account_scope: 'organization', bucket_kind: 'included', remaining_tokens: '1000000' }
  ]
) {
  let usageIndex = 0
  const allocations: Array<{ grant_id: string; reserved_tokens: string; bucket_kind: 'included' | 'addon' }> = []
  let reservationStatus = 'reserved'
  const query = vi.fn(async (sql: string, params?: unknown[]) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rowCount: null, rows: [] }
    if (sql.includes('FROM tenants')) return { rowCount: 1, rows: [{ tenant_id: 'tenant-a' }] }
    if (sql.includes('FROM app_sessions s')) return {
      rowCount: 1,
      rows: [{
        tenant_id: 'tenant-a', subject_id: 'learner-a', group_code: 'gptnursing',
        department_code: departmentTokens === undefined ? null : 'obgyn',
        department_assigned_at: departmentAssignedAt ?? null
      }]
    }
    if (sql.includes('FROM tenant_ai_time_budget_settings')) return {
      rowCount: 1,
      rows: [{ revision: activeSettings.revision, settings: {
        ...activeSettings,
        status,
        departments: departmentTokens === undefined ? [] : [{
          code: 'obgyn', name: 'OBGYN', monthlyTokensPerUser: departmentTokens
        }]
      } }]
    }
    if (sql.includes('FROM provider_token_reservations')) {
      if (sql.includes('SELECT status, subject_id, session_id')) {
        return { rowCount: 1, rows: [{ status: reservationStatus, subject_id: 'learner-a', session_id: 'session-a', tenant_id: 'tenant-a', provider_response_id: null, actual_total_tokens: null }] }
      }
      const usage = Array.isArray(usedTokens) ? usedTokens[usageIndex++] ?? '0' : usedTokens
      return { rowCount: 1, rows: [{ used_tokens: usage }] }
    }
    if (sql.includes('FROM gptmd_token_entitlement_grants grant_row')) {
      return { rowCount: 0, rows: [] }
    }
    if (sql.includes('FROM gptmd_token_entitlement_grants')) {
      return { rowCount: grants.length, rows: grants }
    }
    if (sql.includes('FROM gptmd_token_reservation_allocations')) {
      if (sql.includes('SELECT EXISTS')) return { rowCount: 1, rows: [{ used_addon: false }] }
      return { rowCount: allocations.length, rows: allocations }
    }
    if (sql.includes('INSERT INTO gptmd_token_entitlement_grants')) return { rowCount: 1, rows: [] }
    if (sql.includes('INSERT INTO gptmd_token_reservation_allocations')) {
      const grant = grants.find(({ grant_id }) => grant_id === params?.[1])
      allocations.push({ grant_id: String(params?.[1]), reserved_tokens: String(params?.[2]), bucket_kind: grant?.bucket_kind ?? 'included' })
      return { rowCount: 1, rows: [] }
    }
    if (sql.includes('INSERT INTO gptmd_token_entitlement_entries')) return { rowCount: 1, rows: [] }
    if (sql.includes("SET status = 'settled'")) {
      reservationStatus = 'settled'
      return { rowCount: 1, rows: [] }
    }
    if (sql.includes("SET status = 'held'")) {
      reservationStatus = 'held'
      return { rowCount: 1, rows: [] }
    }
    if (sql.includes('INSERT INTO provider_token_reservations')) return { rowCount: 1, rows: [] }
    return { rowCount: null, rows: [] }
  })
  const client = { query, release: vi.fn() }
  return { client, query }
}

describe('provider token reservation enforcement', () => {
  it('serializes active allowance checks and inserts the bounded reservation in one transaction', async () => {
    const { client, query } = makeClient()
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
    } as unknown as Pool
    const store = createPostgresProviderTokenReservationStore(pool)

    const reservation = await store.reserve({
      tenantId: 'tenant-a', subjectId: 'learner-a', sessionId: 'session-a',
      operation: 'patient_turn', inputTokens: 4_321, outputTokenCap: 1_024
    })
    await expect(reservation.settle('resp-1', 4_500)).resolves.toBe(false)

    expect(query.mock.calls[0]?.[0]).toBe('BEGIN')
    expect(query.mock.calls[1]?.[0]).toContain('FROM tenants WHERE tenant_id = $1 FOR UPDATE')
    const sessionRead = query.mock.calls.find(([sql]) => sql.includes('FROM app_sessions s'))?.[0]
    expect(sessionRead).not.toContain('FOR SHARE')
    expect(query.mock.calls.filter(([sql]) => sql.includes('SELECT COALESCE(sum(') &&
      sql.includes('FROM provider_token_reservations'))).toHaveLength(3)
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO provider_token_reservations'))).toBe(true)
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO gptmd_token_reservation_allocations'))).toBe(true)
    expect(query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
    expect(client.release).toHaveBeenCalledTimes(2)
    expect(query.mock.calls.some(([sql, params]) => sql.includes('INSERT INTO gptmd_token_entitlement_entries') &&
      params?.[3] === '-4500')).toBe(true)
    expect(query.mock.calls.some(([sql]) => sql.includes("SET status = 'settled'"))).toBe(true)
  })

  it('rejects before ledger insertion when a scoped allowance is already exhausted', async () => {
    const { client, query } = makeClient('100000')
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const store = createPostgresProviderTokenReservationStore(pool)

    await expect(store.reserve({
      tenantId: 'tenant-a', subjectId: 'learner-a', sessionId: 'session-a',
      operation: 'patient_turn', inputTokens: 1, outputTokenCap: 1
    })).rejects.toBeInstanceOf(ProviderTokenBudgetExceeded)

    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO provider_token_reservations'))).toBe(false)
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
  })

  it('enforces the shared group pool and per-user group-month cap independently', async () => {
    for (const usedTokens of [
      ['0', '100000'],
      ['0', '0', '80000']
    ]) {
      const { client, query } = makeClient(usedTokens)
      const store = createPostgresProviderTokenReservationStore({
        connect: vi.fn().mockResolvedValue(client)
      } as unknown as Pool)
      await expect(store.reserve({
        tenantId: 'tenant-a', subjectId: 'learner-a', sessionId: 'session-a',
        operation: 'patient_turn', inputTokens: 1, outputTokenCap: 1
      })).rejects.toBeInstanceOf(ProviderTokenBudgetExceeded)
      expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO provider_token_reservations'))).toBe(false)
    }
  })

  it('enforces the department allowance prorated from its pinned assignment time', async () => {
    const now = new Date()
    const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    const assignedAt = new Date((periodStart.getTime() + now.getTime()) / 2)
    const departmentCap = getProratedMonthlyDepartmentTokens(10_000, assignedAt, now).tokens!
    const { client, query } = makeClient(['0', '0', '0', '0'], 'active', 10_000, assignedAt)
    const store = createPostgresProviderTokenReservationStore({
      connect: vi.fn().mockResolvedValue(client)
    } as unknown as Pool)

    await expect(store.reserve({
      tenantId: 'tenant-a', subjectId: 'learner-a', sessionId: 'session-a',
      operation: 'patient_turn', inputTokens: departmentCap, outputTokenCap: 1
    })).rejects.toBeInstanceOf(ProviderTokenBudgetExceeded)
    expect(query.mock.calls.filter(([sql]) => sql.includes('FROM provider_token_reservations'))).toHaveLength(4)
    expect(query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
  })

  it('keeps draft settings non-enforcing while retaining ambiguous provider reservations', async () => {
    const { client, query } = makeClient('100', 'draft')
    const holdQuery = vi.fn().mockResolvedValue({ rowCount: 1, rows: [] })
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
      query: holdQuery
    } as unknown as Pool
    const store = createPostgresProviderTokenReservationStore(pool)
    const reservation = await store.reserve({
      tenantId: 'tenant-a', subjectId: 'learner-a', sessionId: 'session-a',
      operation: 'scenario_setup', inputTokens: 12_000, outputTokenCap: 8_192
    })

    await reservation.hold()

    expect(query.mock.calls.filter(([sql]) => sql.includes('SELECT COALESCE(sum(') &&
      sql.includes('FROM provider_token_reservations'))).toHaveLength(0)
    expect(holdQuery).toHaveBeenCalledWith(expect.stringContaining("SET status = 'held'"), [reservation.reservationId])
  })

  it('allocates included grants before personal add-ons and rejects insufficient grants atomically', async () => {
    const { client, query } = makeClient('0', 'draft', undefined, undefined, [
      { grant_id: 'included', account_scope: 'consumer', bucket_kind: 'included', remaining_tokens: '1000' },
      { grant_id: 'addon', account_scope: 'consumer', bucket_kind: 'addon', remaining_tokens: '10000' }
    ])
    const store = createPostgresProviderTokenReservationStore({
      connect: vi.fn().mockResolvedValue(client)
    } as unknown as Pool)

    const reservation = await store.reserve({
      tenantId: 'tenant-a', subjectId: 'learner-a', sessionId: 'session-a',
      operation: 'patient_turn', inputTokens: 1_500, outputTokenCap: 1_024
    })
    const allocated = query.mock.calls
      .filter(([sql]) => sql.includes('INSERT INTO gptmd_token_reservation_allocations'))
      .map(([, params]) => [params?.[1], params?.[2]])
    expect(allocated).toEqual([['included', '1000'], ['addon', '1524']])
    await expect(reservation.settle('resp-split', 1_200)).resolves.toBe(true)
    expect(query.mock.calls.filter(([sql]) => sql.includes('INSERT INTO gptmd_token_entitlement_entries'))
      .map(([, params]) => [params?.[1], params?.[3]])).toEqual([['included', '-1000'], ['addon', '-200']])
    expect(query.mock.calls.some(([sql]) => sql.includes('UPDATE app_sessions SET addon_tokens_used = true'))).toBe(true)

    const empty = makeClient('0', 'draft', undefined, undefined, [
      { grant_id: 'empty', account_scope: 'consumer', bucket_kind: 'addon', remaining_tokens: '1' }
    ])
    const emptyStore = createPostgresProviderTokenReservationStore({
      connect: vi.fn().mockResolvedValue(empty.client)
    } as unknown as Pool)
    await expect(emptyStore.reserve({
      tenantId: 'tenant-a', subjectId: 'learner-a', sessionId: 'session-a',
      operation: 'patient_turn', inputTokens: 1, outputTokenCap: 1
    })).rejects.toBeInstanceOf(ProviderTokenBudgetExceeded)
    expect(empty.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO provider_token_reservations'))).toBe(false)
    expect(empty.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
  })

  it('allows personal add-on funding after organization-included caps are exhausted', async () => {
    const { client, query } = makeClient(['100000', '100000', '80000'], 'active', undefined, undefined, [
      { grant_id: 'personal-addon', account_scope: 'consumer', bucket_kind: 'addon', remaining_tokens: '10000' }
    ])
    const store = createPostgresProviderTokenReservationStore({
      connect: vi.fn().mockResolvedValue(client)
    } as unknown as Pool)

    const reservation = await store.reserve({
      tenantId: 'tenant-a', subjectId: 'learner-a', sessionId: 'session-a',
      operation: 'patient_turn', inputTokens: 1, outputTokenCap: 1
    })

    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO provider_token_reservations'))).toBe(true)
    expect(query.mock.calls.filter(([sql]) => sql.includes('SELECT COALESCE(sum(') &&
      sql.includes('FROM provider_token_reservations'))).toHaveLength(0)
    expect(query.mock.calls.some(([sql, params]) => sql.includes('INSERT INTO gptmd_token_reservation_allocations') &&
      params?.[1] === 'personal-addon')).toBe(true)
    expect(query.mock.calls.some(([sql]) => sql.includes('FROM gptmd_token_entitlement_grants g') &&
      sql.includes("g.account_scope = 'organization' AND g.bucket_kind = 'included'"))).toBe(true)
    expect(reservation.reservationId).toBeTruthy()
  })

  it('snapshots the department assignment timestamp and protects the ledger in migrations', async () => {
    const reservationSql = await readFile(new URL('../../services/api/migrations/030_provider_token_reservations.sql', import.meta.url), 'utf8')
    const enforcementSql = await readFile(new URL('../../services/api/migrations/031_ai_budget_enforcement.sql', import.meta.url), 'utf8')
    const lockRepairSql = await readFile(new URL('../../services/api/migrations/036_provider_reservation_session_lock.sql', import.meta.url), 'utf8')
    expect(reservationSql).toContain("'reserved', 'settled', 'held', 'released'")
    expect(reservationSql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(reservationSql).toContain('REVOKE ALL ON provider_token_reservations FROM PUBLIC')
    expect(reservationSql).toContain('provider_response_id text UNIQUE')
    expect(enforcementSql).toContain('ai_budget_department_assigned_at timestamptz')
    expect(enforcementSql).toContain('SET ai_budget_department_assigned_at = s.created_at')
    expect(lockRepairSql).toContain("confrelid = 'app_sessions'::regclass")
    expect(lockRepairSql).toContain('provider_token_reservations_session_identity_snapshot_check')
  })
})
