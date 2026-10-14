-- Creates an isolated, disabled-by-default control workspace for the named
-- test client. Resolve its UUID in Supabase Auth first, then run only against
-- the intended GPTMD application database with -v test_subject_id=<UUID>.
BEGIN;

CREATE TEMP TABLE gptmd_test_subject (
  subject_id text NOT NULL CHECK (
    subject_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
) ON COMMIT DROP;
INSERT INTO gptmd_test_subject (subject_id) VALUES (:'test_subject_id');

DO $provision$
DECLARE
  resolved_subject_id text;
  workspace_id constant text := 'gptmd-entitlement-test-scsstx';
BEGIN
  SELECT subject_id
    INTO STRICT resolved_subject_id
    FROM pg_temp.gptmd_test_subject;

  INSERT INTO tenants (tenant_id) VALUES (workspace_id)
  ON CONFLICT (tenant_id) DO NOTHING;

  INSERT INTO tenant_memberships (tenant_id, subject_id, status, role)
  VALUES (workspace_id, resolved_subject_id, 'active', 'customer_admin')
  ON CONFLICT (tenant_id, subject_id) DO UPDATE
    SET status = 'active', role = 'customer_admin';

  INSERT INTO tenant_entitlements (
    tenant_id, sessions_enabled, responses_enabled,
    monthly_session_quota, monthly_session_quota_per_user,
    monthly_response_quota, monthly_response_quota_per_user,
    response_quota_per_session, max_active_sessions,
    audio_transcription_enabled, audio_transcription_privacy_approved,
    monthly_audio_transcription_session_quota
  ) VALUES (
    workspace_id, false, false, 5, 5, 50, 50, 12, 1, false, false, 0
  )
  ON CONFLICT (tenant_id) DO NOTHING;
END
$provision$;

COMMIT;
