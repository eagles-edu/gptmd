CREATE TABLE session_audio_recording_consents (
  session_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  consent_version text NOT NULL CHECK (consent_version = 'gptmd-two-sided-audio-v1'),
  consented_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  UNIQUE (session_id, tenant_id, subject_id),
  FOREIGN KEY (session_id, tenant_id, subject_id)
    REFERENCES app_sessions (session_id, tenant_id, subject_id) ON DELETE CASCADE
);

CREATE TABLE session_audio_segments (
  session_id text NOT NULL,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  speaker text NOT NULL CHECK (speaker IN ('learner', 'patient')),
  recording_part integer NOT NULL CHECK (recording_part >= 0),
  sequence integer NOT NULL CHECK (sequence >= 0),
  turn_id text,
  content_type text NOT NULL CHECK (content_type IN ('audio/webm', 'audio/mp4', 'audio/mpeg')),
  content bytea NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 5242880),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, speaker, recording_part, sequence),
  FOREIGN KEY (session_id, tenant_id, subject_id)
    REFERENCES session_audio_recording_consents (session_id, tenant_id, subject_id) ON DELETE CASCADE,
  CHECK ((speaker = 'patient' AND turn_id IS NOT NULL AND content_type = 'audio/mpeg')
      OR (speaker = 'learner' AND turn_id IS NULL AND content_type IN ('audio/webm', 'audio/mp4')))
);

CREATE UNIQUE INDEX session_audio_segments_patient_turn
  ON session_audio_segments (session_id, turn_id) WHERE speaker = 'patient';
CREATE INDEX session_audio_segments_archive_order
  ON session_audio_segments (session_id, speaker, recording_part, sequence);

ALTER TABLE session_archive_artifacts
  DROP CONSTRAINT session_archive_artifacts_content_type_check,
  ADD CONSTRAINT session_archive_artifacts_content_type_check
    CHECK (content_type IN ('text/plain; charset=utf-8', 'application/zip'));

ALTER TABLE session_audio_recording_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_audio_segments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON session_audio_recording_consents, session_audio_segments FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON session_audio_recording_consents, session_audio_segments FROM %I', role_name);
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION set_session_audio_terminal_expiry() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE session_audio_recording_consents
  SET expires_at = NEW.occurred_at + interval '72 hours'
  WHERE session_id = NEW.session_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER session_audio_terminal_expiry
  AFTER INSERT ON session_outcomes
  FOR EACH ROW EXECUTE FUNCTION set_session_audio_terminal_expiry();
