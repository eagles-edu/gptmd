import { describe, expect, it, vi } from 'vitest'
import { provisionBudgetTestMembership } from '../../scripts/provision-ai-budget-test-learner.mjs'

const adminTenant = 'gptmd-entitlement-test-onlineadmin'
const learnerTenant = 'gptmd-learner-test-scsstx'
const migrations = [
  '024_session_archive_jobs.sql', '025_tenant_entitlement_audit.sql',
  '027_organization_ai_time_budgets.sql', '029_ai_budget_group_assignments.sql',
  '030_provider_token_reservations.sql', '031_ai_budget_enforcement.sql'
]
const baseline = {
  monthly_session_quota: 5,
  monthly_session_quota_per_user: 5,
  monthly_response_quota: 50,
  monthly_response_quota_per_user: 50,
  response_quota_per_session: 12,
  max_active_sessions: 1,
  monthly_audio_transcription_session_quota: 0
}

function makeDatabase(options: {
  migrations?: string[]
  targetSessionsEnabled?: boolean
  existingBudgetSettings?: number
} = {}) {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: null }
    if (sql.includes('current_database()')) return {
      rows: [{ database_name: 'gptmd_live', database_role: 'gptmd_live_app', migrations: options.migrations ?? migrations }],
      rowCount: 1
    }
    if (sql.includes('FROM tenants')) return { rows: [{ tenant_id: adminTenant }], rowCount: 1 }
    if (sql.includes('FROM tenant_memberships') && values?.[0] === adminTenant && values[1] === 'admin-subject') {
      return { rows: [{ role: 'customer_admin', status: 'active' }], rowCount: 1 }
    }
    if (sql.includes('FROM tenant_entitlements')) return {
      rows: [{
        sessions_enabled: options.targetSessionsEnabled ?? false,
        responses_enabled: false,
        audio_transcription_enabled: false,
        audio_transcription_privacy_approved: false,
        ...baseline
      }], rowCount: 1
    }
    if (sql.includes('FROM tenant_ai_time_budget_settings')) return {
      rows: [{
        settings: options.existingBudgetSettings ?? 0,
        groups: 0,
        departments: 0,
        reservations: 0
      }], rowCount: 1
    }
    if (sql.includes('FROM tenant_memberships') && values?.[0] === adminTenant) {
      return { rows: [], rowCount: 0 }
    }
    if (sql.includes('FROM tenant_memberships') && values?.[0] === learnerTenant) return {
      rows: [{ role: 'learner', status: 'active', sessions_enabled: true, responses_enabled: true,
        audio_transcription_enabled: false, audio_transcription_privacy_approved: false, ...baseline }],
      rowCount: 1
    }
    if (sql.includes('INSERT INTO tenant_memberships')) return {
      rows: [{ role: 'learner', status: 'active' }], rowCount: 1
    }
    throw new Error(`Unexpected query in provisioner test: ${sql}`)
  })
  return { query }
}

describe('AI-budget test learner provisioning', () => {
  it('adds only the learner membership after validating the live identities and off policy', async () => {
    const database = makeDatabase()

    await provisionBudgetTestMembership(database, 'admin-subject', 'learner-subject')

    expect(database.query.mock.calls[0]?.[0]).toBe('BEGIN')
    expect(database.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO tenant_memberships'))).toBe(true)
    expect(database.query.mock.calls.at(-1)?.[0]).toBe('COMMIT')
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO tenant_memberships'), [
      adminTenant, 'learner-subject'
    ])
  })

  it('rolls back without adding the learner when the admin workspace policy changed', async () => {
    const database = makeDatabase({ targetSessionsEnabled: true })

    await expect(provisionBudgetTestMembership(database, 'admin-subject', 'learner-subject'))
      .rejects.toThrow('all-off baseline policy')

    expect(database.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO tenant_memberships'))).toBe(false)
    expect(database.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
  })

  it('refuses provisioning when an AI-budget migration is missing', async () => {
    const database = makeDatabase({ migrations: migrations.slice(0, -1) })

    await expect(provisionBudgetTestMembership(database, 'admin-subject', 'learner-subject'))
      .rejects.toThrow('migrations are missing')

    expect(database.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO tenant_memberships'))).toBe(false)
    expect(database.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
  })

  it('refuses to attach the learner after any budget data has been configured', async () => {
    const database = makeDatabase({ existingBudgetSettings: 1 })

    await expect(provisionBudgetTestMembership(database, 'admin-subject', 'learner-subject'))
      .rejects.toThrow('already contains AI-budget data')

    expect(database.query.mock.calls.some(([sql]) => sql.includes('INSERT INTO tenant_memberships'))).toBe(false)
    expect(database.query.mock.calls.at(-1)?.[0]).toBe('ROLLBACK')
  })
})
