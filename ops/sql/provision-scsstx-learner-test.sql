-- Creates a separate, bounded learner workspace while retaining the all-off
-- customer-admin control workspace. The caller validates the subject and target.
WITH learner_tenant AS (
  INSERT INTO tenants (tenant_id)
  VALUES ('gptmd-learner-test-scsstx')
  RETURNING tenant_id
), learner_membership AS (
  INSERT INTO tenant_memberships (tenant_id, subject_id, status, role)
  SELECT tenant_id, $1, 'active', 'learner' FROM learner_tenant
  RETURNING tenant_id, subject_id
), learner_policy AS (
  INSERT INTO tenant_entitlements (
    tenant_id, sessions_enabled, responses_enabled,
    monthly_session_quota, monthly_session_quota_per_user,
    monthly_response_quota, monthly_response_quota_per_user,
    response_quota_per_session, max_active_sessions,
    audio_transcription_enabled, audio_transcription_privacy_approved,
    monthly_audio_transcription_session_quota
  )
  SELECT tenant_id, true, true, 5, 5, 50, 50, 12, 1, false, false, 0
  FROM learner_membership
  RETURNING tenant_id
), learner_audit AS (
  INSERT INTO tenant_entitlement_audit (tenant_id, changed_by, before_policy, after_policy)
  SELECT tenant_id, $1,
    '{"sessionsEnabled":false,"responsesEnabled":false,"monthlySessionQuota":null,"monthlySessionQuotaPerUser":null,"monthlyResponseQuota":null,"monthlyResponseQuotaPerUser":null,"responseQuotaPerSession":null,"maxActiveSessions":null,"audioTranscriptionEnabled":false,"audioTranscriptionPrivacyApproved":false,"monthlyAudioTranscriptionSessionQuota":null}'::jsonb,
    '{"sessionsEnabled":true,"responsesEnabled":true,"monthlySessionQuota":5,"monthlySessionQuotaPerUser":5,"monthlyResponseQuota":50,"monthlyResponseQuotaPerUser":50,"responseQuotaPerSession":12,"maxActiveSessions":1,"audioTranscriptionEnabled":false,"audioTranscriptionPrivacyApproved":false,"monthlyAudioTranscriptionSessionQuota":0}'::jsonb
  FROM learner_policy
  RETURNING tenant_id
)
SELECT tenant_id FROM learner_audit;
