import { describe, expect, it, vi } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import { createPostgresTenantEntitlementAdminStore, type TenantEntitlementPolicy } from '../../services/api/src/tenant-entitlements.ts'

const emptyPolicy: TenantEntitlementPolicy = {
  sessionsEnabled: false,
  responsesEnabled: false,
  monthlySessionQuota: null,
  monthlySessionQuotaPerUser: null,
  monthlyResponseQuota: null,
  monthlyResponseQuotaPerUser: null,
  responseQuotaPerSession: null,
  maxActiveSessions: null,
  audioTranscriptionEnabled: false,
  audioTranscriptionPrivacyApproved: false,
  monthlyAudioTranscriptionSessionQuota: null
}

const row = (policy: TenantEntitlementPolicy) => ({
  sessions_enabled: policy.sessionsEnabled,
  responses_enabled: policy.responsesEnabled,
  monthly_session_quota: policy.monthlySessionQuota,
  monthly_session_quota_per_user: policy.monthlySessionQuotaPerUser,
  monthly_response_quota: policy.monthlyResponseQuota,
  monthly_response_quota_per_user: policy.monthlyResponseQuotaPerUser,
  response_quota_per_session: policy.responseQuotaPerSession,
  max_active_sessions: policy.maxActiveSessions,
  audio_transcription_enabled: policy.audioTranscriptionEnabled,
  audio_transcription_privacy_approved: policy.audioTranscriptionPrivacyApproved,
  monthly_audio_transcription_session_quota: policy.monthlyAudioTranscriptionSessionQuota
})

describe('tenant entitlement administration store', () => {
  it('writes policy and immutable before/after audit in one transaction', async () => {
    const nextPolicy = { ...emptyPolicy, sessionsEnabled: true, responsesEnabled: true, monthlySessionQuota: 12 }
    const statements: Array<{ sql: string; values?: unknown[] }> = []
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values })
        if (sql.includes('FROM tenants t')) return { rows: [row(emptyPolicy)] }
        if (sql.includes('RETURNING sessions_enabled')) return { rows: [row(nextPolicy)] }
        return { rows: [] }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool

    const updated = await createPostgresTenantEntitlementAdminStore(pool)
      .updatePolicy('test-workspace', 'test-subject', nextPolicy)

    expect(updated).toEqual(nextPolicy)
    expect(statements.map(({ sql }) => sql)).toEqual(expect.arrayContaining([
      'BEGIN', expect.stringContaining('INSERT INTO tenant_entitlements'),
      expect.stringContaining('INSERT INTO tenant_entitlement_audit'), 'COMMIT'
    ]))
    const audit = statements.find(({ sql }) => sql.includes('INSERT INTO tenant_entitlement_audit'))
    expect(audit?.values).toEqual([
      'test-workspace', 'test-subject', JSON.stringify(emptyPolicy), JSON.stringify(nextPolicy)
    ])
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('does not create an entitlement row for an unknown tenant', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool

    await expect(createPostgresTenantEntitlementAdminStore(pool)
      .updatePolicy('missing', 'test-subject', emptyPolicy)).resolves.toBeNull()

    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledOnce()
  })
})
