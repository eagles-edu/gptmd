CREATE TABLE session_archive_artifacts (
  artifact_id text PRIMARY KEY CHECK (length(trim(artifact_id)) BETWEEN 1 AND 200),
  session_id text NOT NULL UNIQUE,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  content_type text NOT NULL CHECK (content_type = 'text/plain; charset=utf-8'),
  filename text NOT NULL CHECK (length(trim(filename)) BETWEEN 1 AND 200),
  content bytea NOT NULL CHECK (octet_length(content) > 0),
  terminal_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  CHECK (expires_at = terminal_at + interval '72 hours'),
  FOREIGN KEY (session_id, tenant_id, subject_id)
    REFERENCES app_sessions (session_id, tenant_id, subject_id) ON DELETE RESTRICT
);

CREATE INDEX session_archive_artifacts_expiry
  ON session_archive_artifacts (expires_at);

ALTER TABLE session_archive_jobs
  ADD COLUMN artifact_id text,
  ADD COLUMN download_expires_at timestamptz,
  ADD CONSTRAINT session_archive_jobs_artifact_fk
    FOREIGN KEY (artifact_id) REFERENCES session_archive_artifacts (artifact_id) ON DELETE SET NULL,
  ADD CONSTRAINT session_archive_jobs_artifact_id_unique UNIQUE (artifact_id),
  ADD CONSTRAINT session_archive_jobs_expiry_state CHECK (
    (status = 'completed' AND download_expires_at IS NOT NULL)
    OR (status <> 'completed' AND download_expires_at IS NULL)
  );

CREATE INDEX session_archive_jobs_processing_claim
  ON session_archive_jobs (claimed_at)
  WHERE status = 'processing';

ALTER TABLE download_engagement
  ADD COLUMN download_id text;

DROP TRIGGER download_engagement_is_append_only ON download_engagement;
UPDATE download_engagement SET download_id = engagement_id;

ALTER TABLE download_engagement
  ALTER COLUMN download_id SET NOT NULL,
  DROP CONSTRAINT download_engagement_result_check,
  ADD CONSTRAINT download_engagement_result_check
    CHECK (result IN ('authorized', 'completed', 'denied', 'expired', 'failed')),
  ADD CONSTRAINT download_engagement_download_id_length
    CHECK (length(trim(download_id)) BETWEEN 1 AND 200),
  ADD CONSTRAINT download_engagement_completion_state CHECK (
    (result = 'authorized' AND artifact_id IS NOT NULL AND completed_at IS NULL)
    OR (result = 'completed' AND artifact_id IS NOT NULL AND completed_at IS NOT NULL
        AND bytes_downloaded IS NOT NULL AND bytes_downloaded > 0)
    OR (result IN ('denied', 'expired', 'failed') AND completed_at IS NOT NULL)
  );

CREATE TRIGGER download_engagement_is_append_only
  BEFORE UPDATE OR DELETE ON download_engagement
  FOR EACH ROW EXECUTE FUNCTION reject_durable_history_mutation();

CREATE INDEX download_engagement_by_download
  ON download_engagement (download_id, requested_at);

ALTER TABLE session_archive_artifacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON session_archive_artifacts FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON session_archive_artifacts FROM %I', role_name);
    END IF;
  END LOOP;
END;
$$;
