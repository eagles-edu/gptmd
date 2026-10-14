-- Adds an isolated, all-off customer-admin workspace without changing the
-- existing onlineadmin learner workspace. This single statement is atomic.

WITH admin_tenant AS (
  INSERT INTO tenants (tenant_id)
  VALUES ('gptmd-entitlement-test-onlineadmin')
  RETURNING tenant_id
), admin_membership AS (
  INSERT INTO tenant_memberships (tenant_id, subject_id, status, role)
  SELECT tenant_id, $1, 'active', 'customer_admin' FROM admin_tenant
  RETURNING tenant_id, subject_id
), admin_policy AS (
  INSERT INTO tenant_entitlements (
    tenant_id, sessions_enabled, responses_enabled,
    monthly_session_quota, monthly_session_quota_per_user,
    monthly_response_quota, monthly_response_quota_per_user,
    response_quota_per_session, max_active_sessions,
    audio_transcription_enabled, audio_transcription_privacy_approved,
    monthly_audio_transcription_session_quota
  )
  SELECT tenant_id, false, false, 5, 5, 50, 50, 12, 1, false, false, 0
  FROM admin_membership
  RETURNING tenant_id
), admin_audit AS (
  INSERT INTO tenant_entitlement_audit (tenant_id, changed_by, before_policy, after_policy)
  SELECT tenant_id, $1,
    '{"sessionsEnabled":false,"responsesEnabled":false,"monthlySessionQuota":null,"monthlySessionQuotaPerUser":null,"monthlyResponseQuota":null,"monthlyResponseQuotaPerUser":null,"responseQuotaPerSession":null,"maxActiveSessions":null,"audioTranscriptionEnabled":false,"audioTranscriptionPrivacyApproved":false,"monthlyAudioTranscriptionSessionQuota":null}'::jsonb,
    '{"sessionsEnabled":false,"responsesEnabled":false,"monthlySessionQuota":5,"monthlySessionQuotaPerUser":5,"monthlyResponseQuota":50,"monthlyResponseQuotaPerUser":50,"responseQuotaPerSession":12,"maxActiveSessions":1,"audioTranscriptionEnabled":false,"audioTranscriptionPrivacyApproved":false,"monthlyAudioTranscriptionSessionQuota":0}'::jsonb
  FROM admin_policy
  RETURNING tenant_id
)
SELECT tenant_id FROM admin_audit;
