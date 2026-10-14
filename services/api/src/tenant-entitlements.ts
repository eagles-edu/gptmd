import type { Pool } from 'pg'

export interface TenantEntitlementPolicy {
  sessionsEnabled: boolean
  responsesEnabled: boolean
  monthlySessionQuota: number | null
  monthlySessionQuotaPerUser: number | null
  monthlyResponseQuota: number | null
  monthlyResponseQuotaPerUser: number | null
  responseQuotaPerSession: number | null
  maxActiveSessions: number | null
  audioTranscriptionEnabled: boolean
  audioTranscriptionPrivacyApproved: boolean
  monthlyAudioTranscriptionSessionQuota: number | null
}

export interface TenantEntitlementAdminStore {
  getPolicy(tenantId: string): Promise<TenantEntitlementPolicy | null>
  updatePolicy(tenantId: string, changedBy: string, policy: TenantEntitlementPolicy): Promise<TenantEntitlementPolicy | null>
}

type PolicyRow = {
  sessions_enabled: boolean
  responses_enabled: boolean
  monthly_session_quota: number | null
  monthly_session_quota_per_user: number | null
  monthly_response_quota: number | null
  monthly_response_quota_per_user: number | null
  response_quota_per_session: number | null
  max_active_sessions: number | null
  audio_transcription_enabled: boolean
  audio_transcription_privacy_approved: boolean
  monthly_audio_transcription_session_quota: number | null
}

const policyColumns = `sessions_enabled, responses_enabled, monthly_session_quota,
  monthly_session_quota_per_user, monthly_response_quota, monthly_response_quota_per_user,
  response_quota_per_session, max_active_sessions, audio_transcription_enabled,
  audio_transcription_privacy_approved, monthly_audio_transcription_session_quota`

const toPolicy = (row: PolicyRow): TenantEntitlementPolicy => ({
  sessionsEnabled: row.sessions_enabled,
  responsesEnabled: row.responses_enabled,
  monthlySessionQuota: row.monthly_session_quota,
  monthlySessionQuotaPerUser: row.monthly_session_quota_per_user,
  monthlyResponseQuota: row.monthly_response_quota,
  monthlyResponseQuotaPerUser: row.monthly_response_quota_per_user,
  responseQuotaPerSession: row.response_quota_per_session,
  maxActiveSessions: row.max_active_sessions,
  audioTranscriptionEnabled: row.audio_transcription_enabled,
  audioTranscriptionPrivacyApproved: row.audio_transcription_privacy_approved,
  monthlyAudioTranscriptionSessionQuota: row.monthly_audio_transcription_session_quota
})

const defaults: TenantEntitlementPolicy = {
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

export function createPostgresTenantEntitlementAdminStore(pool: Pool): TenantEntitlementAdminStore {
  return {
    async getPolicy(tenantId) {
      const result = await pool.query<PolicyRow>(
        `SELECT COALESCE(e.sessions_enabled, false) AS sessions_enabled,
                COALESCE(e.responses_enabled, false) AS responses_enabled,
                e.monthly_session_quota, e.monthly_session_quota_per_user,
                e.monthly_response_quota, e.monthly_response_quota_per_user,
                e.response_quota_per_session, e.max_active_sessions,
                COALESCE(e.audio_transcription_enabled, false) AS audio_transcription_enabled,
                COALESCE(e.audio_transcription_privacy_approved, false) AS audio_transcription_privacy_approved,
                e.monthly_audio_transcription_session_quota
         FROM tenants t
         LEFT JOIN tenant_entitlements e USING (tenant_id)
         WHERE t.tenant_id = $1`,
        [tenantId]
      )
      const row = result.rows[0]
      return row ? toPolicy({ ...defaults, ...row }) : null
    },

    async updatePolicy(tenantId, changedBy, policy) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const previousResult = await client.query<PolicyRow>(
          `SELECT COALESCE(e.sessions_enabled, false) AS sessions_enabled,
                  COALESCE(e.responses_enabled, false) AS responses_enabled,
                  e.monthly_session_quota, e.monthly_session_quota_per_user,
                  e.monthly_response_quota, e.monthly_response_quota_per_user,
                  e.response_quota_per_session, e.max_active_sessions,
                  COALESCE(e.audio_transcription_enabled, false) AS audio_transcription_enabled,
                  COALESCE(e.audio_transcription_privacy_approved, false) AS audio_transcription_privacy_approved,
                  e.monthly_audio_transcription_session_quota
           FROM tenants t
           LEFT JOIN tenant_entitlements e USING (tenant_id)
           WHERE t.tenant_id = $1 FOR UPDATE OF t`,
          [tenantId]
        )
        const previousRow = previousResult.rows[0]
        if (!previousRow) {
          await client.query('ROLLBACK')
          return null
        }
        const before = toPolicy({ ...defaults, ...previousRow })
        const values = [
          tenantId, policy.sessionsEnabled, policy.responsesEnabled,
          policy.monthlySessionQuota, policy.monthlySessionQuotaPerUser,
          policy.monthlyResponseQuota, policy.monthlyResponseQuotaPerUser,
          policy.responseQuotaPerSession, policy.maxActiveSessions,
          policy.audioTranscriptionEnabled, policy.audioTranscriptionPrivacyApproved,
          policy.monthlyAudioTranscriptionSessionQuota
        ]
        const updatedResult = await client.query<PolicyRow>(
          `INSERT INTO tenant_entitlements (
             tenant_id, sessions_enabled, responses_enabled, monthly_session_quota,
             monthly_session_quota_per_user, monthly_response_quota,
             monthly_response_quota_per_user, response_quota_per_session,
             max_active_sessions, audio_transcription_enabled,
             audio_transcription_privacy_approved, monthly_audio_transcription_session_quota
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           ON CONFLICT (tenant_id) DO UPDATE SET
             sessions_enabled = EXCLUDED.sessions_enabled,
             responses_enabled = EXCLUDED.responses_enabled,
             monthly_session_quota = EXCLUDED.monthly_session_quota,
             monthly_session_quota_per_user = EXCLUDED.monthly_session_quota_per_user,
             monthly_response_quota = EXCLUDED.monthly_response_quota,
             monthly_response_quota_per_user = EXCLUDED.monthly_response_quota_per_user,
             response_quota_per_session = EXCLUDED.response_quota_per_session,
             max_active_sessions = EXCLUDED.max_active_sessions,
             audio_transcription_enabled = EXCLUDED.audio_transcription_enabled,
             audio_transcription_privacy_approved = EXCLUDED.audio_transcription_privacy_approved,
             monthly_audio_transcription_session_quota = EXCLUDED.monthly_audio_transcription_session_quota,
             updated_at = now()
           RETURNING ${policyColumns}`,
          values
        )
        const after = toPolicy(updatedResult.rows[0]!)
        await client.query(
          `INSERT INTO tenant_entitlement_audit (tenant_id, changed_by, before_policy, after_policy)
           VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
          [tenantId, changedBy, JSON.stringify(before), JSON.stringify(after)]
        )
        await client.query('COMMIT')
        return after
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    }
  }
}
