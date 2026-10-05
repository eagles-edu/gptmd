ALTER TABLE app_session_usage
  ADD COLUMN tenant_id text,
  ADD COLUMN subject_id text;

UPDATE app_session_usage u
SET tenant_id = s.tenant_id,
    subject_id = s.subject_id
FROM app_sessions s
WHERE s.session_id = u.session_id;

ALTER TABLE app_session_usage
  ALTER COLUMN tenant_id SET NOT NULL,
  ALTER COLUMN subject_id SET NOT NULL,
  DROP CONSTRAINT app_session_usage_session_id_fkey,
  ADD CONSTRAINT app_session_usage_owner_fkey
    FOREIGN KEY (session_id, tenant_id, subject_id)
    REFERENCES app_sessions (session_id, tenant_id, subject_id) ON DELETE CASCADE;
