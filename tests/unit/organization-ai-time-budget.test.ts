import { describe, expect, it, vi } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import {
  createPostgresOrganizationAiTimeBudgetStore,
  getProratedMonthlyDepartmentTokens,
  getOrganizationAiTimePeriodBounds,
  OrganizationAiMemberAssignmentInputSchema,
  OrganizationAiMemberRosterInvitationSchema,
  OrganizationAiTimeBudgetSettingsSchema,
  type OrganizationAiTimeBudgetSettings
} from '../../services/api/src/organization-ai-time-budget.ts'

const settings: OrganizationAiTimeBudgetSettings = {
  schemaVersion: 1,
  revision: 0,
  status: 'draft',
  organizationPeriod: { months: 3, anchorDate: '2026-01-01' },
  organizationPool: { tokens: 100_000, estimatedMinutes: 600 },
  groups: [{
    code: 'gptnursing',
    name: 'GPT Nursing',
    tokenBudget: 70_000,
    estimatedMinuteBudget: 400,
    monthlyTokensPerUser: 20_000,
    monthlyEstimatedMinutesPerUser: 120
  }],
  departments: [{ code: 'obgyn', name: 'OBGYN' }]
}

describe('organization AI-time budget settings', () => {
  it('prorates department tokens at transfer time and resets to the full monthly amount next month', () => {
    expect(getProratedMonthlyDepartmentTokens(
      10_000,
      new Date('2026-04-16T00:00:00.000Z'),
      new Date('2026-04-16T00:00:00.000Z')
    )).toEqual({
      periodStart: '2026-04-01T00:00:00.000Z',
      periodEnd: '2026-05-01T00:00:00.000Z',
      fraction: 0.5,
      tokens: 5_000
    })
    expect(getProratedMonthlyDepartmentTokens(
      10_000,
      new Date('2026-04-15T00:00:00.000Z'),
      new Date('2026-05-01T00:00:00.000Z')
    ).tokens).toBe(10_000)
  })

  it('computes UTC organization periods from the configured anchor without month-end drift', () => {
    expect(getOrganizationAiTimePeriodBounds(
      '2026-01-31', 1, new Date('2026-03-15T12:00:00.000Z')
    )).toEqual({
      startAt: new Date('2026-02-28T00:00:00.000Z'),
      endAt: new Date('2026-03-31T00:00:00.000Z')
    })
    expect(getOrganizationAiTimePeriodBounds(
      '2026-10-01', 3, new Date('2026-10-14T12:00:00.000Z')
    )).toEqual({
      startAt: new Date('2026-10-01T00:00:00.000Z'),
      endAt: new Date('2027-01-01T00:00:00.000Z')
    })
  })

  it('reports provider total tokens only inside the tenant period', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ total_tokens: '3210', response_count: '7' }] })
    const store = createPostgresOrganizationAiTimeBudgetStore({ query } as never)
    const startAt = new Date('2026-10-01T00:00:00.000Z')
    const endAt = new Date('2027-01-01T00:00:00.000Z')

    await expect(store.getUsageSummary('tenant-a', startAt, endAt)).resolves.toEqual({
      totalTokens: '3210', responseCount: 7
    })
    expect(query).toHaveBeenCalledWith(expect.stringContaining('sum(total_tokens)'), [
      'tenant-a', startAt, endAt
    ])
    expect(query.mock.calls[0]?.[0]).toContain('occurred_at >= $2 AND occurred_at < $3')
  })

  it('scopes learner usage to both authenticated tenant and subject within the requested period', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ total_tokens: '480', response_count: '3' }] })
    const store = createPostgresOrganizationAiTimeBudgetStore({ query } as never)
    const startAt = new Date('2026-10-01T00:00:00.000Z')
    const endAt = new Date('2026-11-01T00:00:00.000Z')

    await expect(store.getSubjectUsageSummary('tenant-a', 'learner-1', startAt, endAt)).resolves.toEqual({
      totalTokens: '480', responseCount: 3
    })
    expect(query).toHaveBeenCalledWith(expect.stringContaining('tenant_id = $1 AND subject_id = $2'), [
      'tenant-a', 'learner-1', startAt, endAt
    ])
    expect(query.mock.calls[0]?.[0]).toContain('occurred_at >= $3 AND occurred_at < $4')
  })

  it('lists recent provider usage as a tenant-and-subject-scoped ledger', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      occurred_at: new Date('2026-10-08T12:00:00.000Z'), session_id: 'session-1',
      provider: 'openai', operation: 'patient_turn', input_tokens: 100,
      output_tokens: 20, total_tokens: '120'
    }] })
    const store = createPostgresOrganizationAiTimeBudgetStore({ query } as never)

    await expect(store.getSubjectUsageLedger?.('tenant-a', 'learner-1', 100)).resolves.toEqual([{
      occurredAt: '2026-10-08T12:00:00.000Z', sessionId: 'session-1',
      provider: 'openai', operation: 'patient_turn', inputTokens: 100,
      outputTokens: 20, totalTokens: '120'
    }])
    expect(query).toHaveBeenCalledWith(expect.stringContaining('tenant_id = $1 AND subject_id = $2'), [
      'tenant-a', 'learner-1', 100
    ])
    expect(query.mock.calls[0]?.[0]).toContain('LIMIT $3')
  })

  it('reports active tenant member usage and sessions only inside the selected period', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      subject_id: 'learner-1', role: 'learner', sessions_started: '4', sessions_completed: '2',
      provider_response_count: '9', total_tokens: '4800', last_ai_activity_at: new Date('2026-10-14T12:00:00.000Z'),
      estimated_engagement_seconds: '930', last_engagement_at: new Date('2026-10-14T12:15:00.000Z')
    }] })
    const store = createPostgresOrganizationAiTimeBudgetStore({ query } as never)
    const startAt = new Date('2026-10-01T00:00:00.000Z')
    const endAt = new Date('2026-11-01T00:00:00.000Z')

    await expect(store.getMemberUsageSummary('tenant-a', startAt, endAt)).resolves.toEqual([{
      subjectId: 'learner-1', role: 'learner', sessionsStarted: 4, sessionsCompleted: 2,
      providerResponseCount: 9, totalTokens: '4800', lastAiActivityAt: '2026-10-14T12:00:00.000Z',
      estimatedEngagementSeconds: 930, lastEngagementAt: '2026-10-14T12:15:00.000Z'
    }])
    expect(query).toHaveBeenCalledWith(expect.stringContaining("membership.status = 'active'"), [
      'tenant-a', startAt, endAt
    ])
    expect(query.mock.calls[0]?.[0]).toContain('membership.tenant_id = $1')
    expect(query.mock.calls[0]?.[0]).toContain('created_at >= $2 AND created_at < $3')
    expect(query.mock.calls[0]?.[0]).toContain('occurred_at >= $2 AND occurred_at < $3')
    expect(query.mock.calls[0]?.[0]).toContain('FROM session_engagement_pulses')
    expect(query.mock.calls[0]?.[0]).toContain('recorded_at >= $2 AND recorded_at < $3')
  })

  it('returns only tenant-scoped completed sessions with measured estimate totals and explicit truncation', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      session_id: 'completed-session', subject_id: 'learner-1',
      started_at: new Date('2026-10-14T12:00:00.000Z'),
      completed_at: new Date('2026-10-14T12:20:00.000Z'),
      estimated_engagement_seconds: '930'
    }] })
    const store = createPostgresOrganizationAiTimeBudgetStore({ query } as never)
    const startAt = new Date('2026-10-01T00:00:00.000Z')
    const endAt = new Date('2026-11-01T00:00:00.000Z')

    await expect(store.getCompletedSessionRecords('tenant-a', startAt, endAt)).resolves.toEqual({
      records: [{
        sessionId: 'completed-session', subjectId: 'learner-1',
        startedAt: '2026-10-14T12:00:00.000Z', completedAt: '2026-10-14T12:20:00.000Z',
        estimatedEngagementSeconds: 930
      }],
      hasMore: false
    })
    expect(query).toHaveBeenCalledWith(expect.stringContaining("outcome.outcome = 'completed'"), [
      'tenant-a', startAt, endAt
    ])
    expect(query.mock.calls[0]?.[0]).toContain('session.tenant_id = $1')
    expect(query.mock.calls[0]?.[0]).toContain('LIMIT 501')
  })

  it('reports reserved and held token ceilings within the tenant organization period', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{
      reserved_tokens: '9216', reserved_count: '2', held_tokens: '4096', held_count: '1'
    }] })
    const store = createPostgresOrganizationAiTimeBudgetStore({ query } as never)
    const startAt = new Date('2026-10-01T00:00:00.000Z')
    const endAt = new Date('2027-01-01T00:00:00.000Z')

    await expect(store.getReservationSummary('tenant-a', startAt, endAt)).resolves.toEqual({
      reservedTokens: '9216', reservedCount: 2, heldTokens: '4096', heldCount: 1
    })
    expect(query).toHaveBeenCalledWith(expect.stringContaining("FILTER (WHERE status = 'held')"), [
      'tenant-a', startAt, endAt
    ])
    expect(query.mock.calls[0]?.[0]).toContain("status IN ('reserved', 'held')")
  })

  it('keeps organization pool, group budgets, monthly individual caps, and departments distinct', () => {
    expect(OrganizationAiTimeBudgetSettingsSchema.parse(settings)).toEqual(settings)
    expect(OrganizationAiTimeBudgetSettingsSchema.safeParse({
      ...settings,
      groups: [...settings.groups, { ...settings.groups[0]!, code: 'gptnursing', tokenBudget: 1, estimatedMinuteBudget: 1 }]
    }).success).toBe(false)
    expect(OrganizationAiTimeBudgetSettingsSchema.safeParse({
      ...settings,
      groups: [{ ...settings.groups[0]!, tokenBudget: 100_001 }]
    }).success).toBe(false)
    expect(OrganizationAiTimeBudgetSettingsSchema.safeParse({
      ...settings,
      departments: [...settings.departments, { code: 'obgyn', name: 'Duplicate' }]
    }).success).toBe(false)
    expect(OrganizationAiTimeBudgetSettingsSchema.safeParse({
      ...settings,
      organizationPeriod: { months: 0, anchorDate: '2026-02-31' }
    }).success).toBe(false)
    expect(OrganizationAiTimeBudgetSettingsSchema.safeParse({
      ...settings, status: 'active', groups: []
    }).success).toBe(false)
    expect(OrganizationAiTimeBudgetSettingsSchema.safeParse({ ...settings, status: 'active' }).success).toBe(true)
  })

  it('saves a revision and append-only before/after audit atomically', async () => {
    const nextSettings = { ...settings, organizationPool: { tokens: 120_000, estimatedMinutes: 720 } }
    const statements: Array<{ sql: string; values?: unknown[] }> = []
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values })
        if (sql.includes('SELECT tenant_id FROM tenants')) return { rows: [{ tenant_id: 'tenant-a' }], rowCount: 1 }
        if (sql.includes('FROM tenant_ai_time_budget_settings') && sql.includes('FOR UPDATE')) return { rows: [] }
        if (sql.includes('RETURNING revision, settings')) return {
          rows: [{ revision: 1, settings: {
            schemaVersion: nextSettings.schemaVersion,
            status: nextSettings.status,
            organizationPeriod: nextSettings.organizationPeriod,
            organizationPool: nextSettings.organizationPool,
            groups: nextSettings.groups,
            departments: nextSettings.departments
          } }]
        }
        return { rows: [] }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool

    const saved = await createPostgresOrganizationAiTimeBudgetStore(pool)
      .saveSettings('tenant-a', 'admin-1', nextSettings)

    expect(saved).toEqual({ ...nextSettings, revision: 1 })
    expect(statements.map(({ sql }) => sql)).toEqual(expect.arrayContaining([
      'BEGIN', expect.stringContaining('INSERT INTO tenant_ai_time_budget_settings'),
      expect.stringContaining('INSERT INTO tenant_ai_time_budget_audit'), 'COMMIT'
    ]))
    const audit = statements.find(({ sql }) => sql.includes('INSERT INTO tenant_ai_time_budget_audit'))
    expect(audit?.values?.[0]).toBe('tenant-a')
    expect(audit?.values?.[1]).toBe('admin-1')
    expect(JSON.parse(String(audit?.values?.[3]))).toEqual({ ...nextSettings, revision: 1 })
    expect(client.release).toHaveBeenCalledOnce()
    expect(statements.some(({ sql }) => sql.includes('INSERT INTO gptmd_token_entitlement_grants'))).toBe(false)
  })

  it('issues organization group grants atomically when active settings are saved', async () => {
    const nextSettings = { ...settings, status: 'active' as const }
    const statements: Array<{ sql: string; values?: unknown[] }> = []
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values })
        if (sql.includes('SELECT tenant_id FROM tenants')) return { rows: [{ tenant_id: 'tenant-a' }], rowCount: 1 }
        if (sql.includes('FROM tenant_ai_time_budget_settings') && sql.includes('FOR UPDATE')) return { rows: [] }
        if (sql.includes('SELECT DISTINCT group_code')) return { rows: [] }
        if (sql.includes('SELECT DISTINCT department_code')) return { rows: [] }
        if (sql.includes('FROM gptmd_token_entitlement_grants grant_row')) return { rows: [] }
        if (sql.includes('RETURNING revision, settings')) return {
          rows: [{ revision: 1, settings: { ...nextSettings, revision: undefined } }]
        }
        return { rows: [] }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const store = createPostgresOrganizationAiTimeBudgetStore({
      connect: vi.fn().mockResolvedValue(client)
    } as unknown as Pool)

    const saved = await store.saveSettings('tenant-a', 'admin-1', nextSettings)

    expect(saved).toEqual({ ...nextSettings, revision: 1 })
    const grant = statements.find(({ sql }) => sql.includes('INSERT INTO gptmd_token_entitlement_grants'))
    expect(grant?.values).toMatchObject([
      expect.any(String), 'tenant-a', 'gptnursing', expect.stringMatching(/^organization-allocation:/),
      '70000', expect.any(Date), expect.any(Date), expect.any(Date), expect.any(Date), 'admin-1'
    ])
    expect(statements.at(-1)?.sql).toBe('COMMIT')
  })

  it('rejects group reductions below settled and reserved usage without saving the settings', async () => {
    const active = { ...settings, status: 'active' as const, revision: 1 }
    const reduced = {
      ...active,
      groups: [{ ...active.groups[0]!, tokenBudget: 8_000 }],
      organizationPool: { ...active.organizationPool, tokens: 8_000 }
    }
    const statements: string[] = []
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql)
        if (sql.includes('SELECT tenant_id FROM tenants')) return { rows: [{ tenant_id: 'tenant-a' }], rowCount: 1 }
        if (sql.includes('FROM tenant_ai_time_budget_settings') && sql.includes('FOR UPDATE')) return {
          rows: [{ revision: 1, settings: active }]
        }
        if (sql.includes('SELECT DISTINCT group_code') || sql.includes('SELECT DISTINCT department_code')) return { rows: [] }
        if (sql.includes('FROM gptmd_token_entitlement_grants grant_row')) return { rows: [{
          grant_id: 'grant-a', granted_tokens: '12000', allocation_adjustments: '0',
          usage_delta: '-9000', held_tokens: '3000'
        }] }
        return { rows: [] }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const store = createPostgresOrganizationAiTimeBudgetStore({
      connect: vi.fn().mockResolvedValue(client)
    } as unknown as Pool)

    await expect(store.saveSettings('tenant-a', 'admin-1', reduced)).resolves.toBe('allocation_below_usage')
    expect(statements).toContain('ROLLBACK')
    expect(statements.some((sql) => sql.includes('INSERT INTO tenant_ai_time_budget_settings'))).toBe(false)
    expect(statements.some((sql) => sql.includes('INSERT INTO gptmd_token_entitlement_entries'))).toBe(false)
  })

  it('locks the renewal schedule while organization included grants remain valid', async () => {
    const active = { ...settings, status: 'active' as const, revision: 1 }
    const changed = {
      ...active,
      organizationPeriod: { months: 1, anchorDate: '2026-02-01' }
    }
    const statements: string[] = []
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql)
        if (sql.includes('SELECT tenant_id FROM tenants')) return { rows: [{ tenant_id: 'tenant-a' }], rowCount: 1 }
        if (sql.includes('FROM tenant_ai_time_budget_settings') && sql.includes('FOR UPDATE')) {
          return { rows: [{ revision: 1, settings: active }] }
        }
        if (sql.includes('SELECT DISTINCT group_code') || sql.includes('SELECT DISTINCT department_code')) return { rows: [] }
        if (sql.includes('SELECT 1 FROM gptmd_token_entitlement_grants')) return { rows: [{ '?column?': 1 }], rowCount: 1 }
        return { rows: [] }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const store = createPostgresOrganizationAiTimeBudgetStore({
      connect: vi.fn().mockResolvedValue(client)
    } as unknown as Pool)

    await expect(store.saveSettings('tenant-a', 'admin-1', changed)).resolves.toBe('period_locked')
    expect(statements).toContain('ROLLBACK')
    expect(statements.some((sql) => sql.includes('INSERT INTO tenant_ai_time_budget_settings'))).toBe(false)
  })

  it('validates member assignments against the tenant catalog and audits the snapshot atomically', async () => {
    const statements: Array<{ sql: string; values?: unknown[] }> = []
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values })
        if (sql.includes('SELECT tenant_id FROM tenants')) return { rows: [{ tenant_id: 'tenant-a' }], rowCount: 1 }
        if (sql.includes('SELECT role FROM tenant_memberships')) return { rows: [{ role: 'learner' }], rowCount: 1 }
        if (sql.includes('FROM tenant_ai_time_budget_settings')) return { rows: [{ revision: 1, settings }], rowCount: 1 }
        if (sql.includes('SELECT group_code FROM tenant_member_ai_group_assignments')) return { rows: [{ group_code: 'gptnursing' }], rowCount: 1 }
        if (sql.includes('SELECT department_code FROM tenant_member_ai_department_assignments')) return { rows: [], rowCount: 0 }
        return { rows: [], rowCount: 1 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const store = createPostgresOrganizationAiTimeBudgetStore(pool)
    const assignment = OrganizationAiMemberAssignmentInputSchema.parse({
      subjectId: 'learner-subject', groupCodes: [], departmentCode: 'obgyn'
    })

    await expect(store.saveMemberAssignment('tenant-a', 'admin-subject', assignment)).resolves.toEqual({
      ...assignment, role: 'learner', departmentAssignedAt: null
    })
    expect(statements.map(({ sql }) => sql)).toContain('BEGIN')
    expect(statements.some(({ sql }) => sql.includes('DELETE FROM tenant_member_ai_group_assignments'))).toBe(true)
    const audit = statements.find(({ sql }) => sql.includes('INSERT INTO tenant_member_ai_assignment_audit'))
    expect(audit?.values?.slice(0, 5)).toEqual(['tenant-a', 'learner-subject', 'admin-subject', ['gptnursing'], []])
    expect(statements.map(({ sql }) => sql)).toContain('COMMIT')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('imports pending email rosters only after tenant catalog validation and audits the rows', async () => {
    const statements: Array<{ sql: string; values?: unknown[] }> = []
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values })
        if (sql.includes('SELECT tenant_id FROM tenants')) return { rows: [{ tenant_id: 'tenant-a' }], rowCount: 1 }
        if (sql.includes('FROM tenant_ai_time_budget_settings')) return { rows: [{ revision: 1, settings }], rowCount: 1 }
        if (sql.includes('FROM tenant_member_roster_invitations')) return { rows: [], rowCount: 0 }
        return { rows: [], rowCount: 1 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const store = createPostgresOrganizationAiTimeBudgetStore(pool)
    const invitations = [OrganizationAiMemberRosterInvitationSchema.parse({
      email: 'Employee@Example.test', groupCodes: ['gptnursing'], departmentCode: 'obgyn'
    })]

    await expect(store.importMemberRosterInvitations('tenant-a', 'admin-1', invitations)).resolves.toEqual({
      imported: 1, alreadyAccepted: 0
    })
    const insert = statements.find(({ sql }) => sql.includes('INSERT INTO tenant_member_roster_invitations'))
    expect(insert?.values).toEqual(['tenant-a', 'employee@example.test', ['gptnursing'], 'obgyn', 'admin-1'])
    expect(statements.some(({ sql }) => sql.includes('INSERT INTO tenant_member_roster_invitation_audit'))).toBe(true)
    expect(statements.at(-1)?.sql).toBe('COMMIT')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('claims only learner invitations and atomically provisions admin-assigned groups and departments', async () => {
    const statements: Array<{ sql: string; values?: unknown[] }> = []
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values })
        if (sql.includes('FROM tenant_member_roster_invitations') && sql.includes("status = 'pending'")) {
          return { rows: [{ tenant_id: 'tenant-a', email: 'employee@example.test', group_codes: ['gptnursing'], department_code: 'obgyn', assigned_by: 'admin-1' }], rowCount: 1 }
        }
        if (sql.includes('SELECT tenant_id FROM tenants')) return { rows: [{ tenant_id: 'tenant-a' }], rowCount: 1 }
        if (sql.includes('FROM tenant_ai_time_budget_settings')) return { rows: [{ revision: 1, settings }], rowCount: 1 }
        if (sql.includes('SELECT role, status FROM tenant_memberships')) return { rows: [], rowCount: 0 }
        if (sql.includes('SELECT group_code FROM tenant_member_ai_group_assignments')) return { rows: [], rowCount: 0 }
        if (sql.includes('SELECT department_code FROM tenant_member_ai_department_assignments')) return { rows: [], rowCount: 0 }
        return { rows: [], rowCount: 1 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const store = createPostgresOrganizationAiTimeBudgetStore(pool)

    await store.claimPendingMemberRosterInvitations('employee-subject', 'Employee@Example.test')
    expect(statements.find(({ sql }) => sql.includes('INSERT INTO tenant_memberships'))?.values)
      .toEqual(['tenant-a', 'employee-subject'])
    expect(statements.some(({ sql, values }) =>
      sql.includes('INSERT INTO tenant_member_ai_group_assignments') && values?.[2] === 'gptnursing'
    )).toBe(true)
    expect(statements.some(({ sql, values }) =>
      sql.includes('INSERT INTO tenant_member_ai_department_assignments') && values?.[2] === 'obgyn'
    )).toBe(true)
    expect(statements.some(({ sql }) => sql.includes("SET status = 'accepted'"))).toBe(true)
    expect(statements.some(({ sql }) => sql.includes('INSERT INTO tenant_member_roster_invitation_audit'))).toBe(true)
    expect(statements.at(-1)?.sql).toBe('COMMIT')
  })

  it('does not change an existing instructor or customer-admin role when an email invitation matches', async () => {
    const statements: string[] = []
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql)
        if (sql.includes('FROM tenant_member_roster_invitations') && sql.includes("status = 'pending'")) {
          return { rows: [{ tenant_id: 'tenant-a', email: 'admin@example.test', group_codes: [], department_code: null, assigned_by: 'admin-1' }], rowCount: 1 }
        }
        if (sql.includes('SELECT tenant_id FROM tenants')) return { rows: [{ tenant_id: 'tenant-a' }], rowCount: 1 }
        if (sql.includes('FROM tenant_ai_time_budget_settings')) return { rows: [{ revision: 1, settings }], rowCount: 1 }
        if (sql.includes('SELECT role, status FROM tenant_memberships')) return { rows: [{ role: 'customer_admin', status: 'active' }], rowCount: 1 }
        return { rows: [], rowCount: 1 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    await createPostgresOrganizationAiTimeBudgetStore(pool)
      .claimPendingMemberRosterInvitations('admin-subject', 'admin@example.test')
    expect(statements.some((sql) => sql.includes('INSERT INTO tenant_memberships'))).toBe(false)
    expect(statements.some((sql) => sql.includes("SET status = 'accepted'"))).toBe(false)
    expect(statements.at(-1)).toBe('COMMIT')
  })

  it('does not write settings for an unknown tenant or stale revision', async () => {
    const unknownClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn()
    } as unknown as PoolClient
    const unknownPool = { connect: vi.fn().mockResolvedValue(unknownClient) } as unknown as Pool
    await expect(createPostgresOrganizationAiTimeBudgetStore(unknownPool)
      .saveSettings('missing', 'admin-1', settings)).resolves.toBeNull()
    expect(unknownClient.query).toHaveBeenCalledWith('ROLLBACK')

    const staleClient = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT tenant_id FROM tenants')) return { rows: [{ tenant_id: 'tenant-a' }], rowCount: 1 }
        if (sql.includes('FROM tenant_ai_time_budget_settings') && sql.includes('FOR UPDATE')) {
          return { rows: [{ revision: 2, settings: {
            schemaVersion: settings.schemaVersion,
            status: settings.status,
            organizationPeriod: settings.organizationPeriod,
            organizationPool: settings.organizationPool,
            groups: settings.groups,
            departments: settings.departments
          } }] }
        }
        return { rows: [] }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const stalePool = { connect: vi.fn().mockResolvedValue(staleClient) } as unknown as Pool
    await expect(createPostgresOrganizationAiTimeBudgetStore(stalePool)
      .saveSettings('tenant-a', 'admin-1', settings)).resolves.toBe('conflict')
    expect(staleClient.query).toHaveBeenCalledWith('ROLLBACK')
  })
})
