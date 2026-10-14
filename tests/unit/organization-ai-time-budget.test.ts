import { describe, expect, it, vi } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import {
  createPostgresOrganizationAiTimeBudgetStore,
  getProratedMonthlyDepartmentTokens,
  getOrganizationAiTimePeriodBounds,
  OrganizationAiMemberAssignmentInputSchema,
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
