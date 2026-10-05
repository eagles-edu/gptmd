ALTER TABLE tenant_entitlements
  ADD COLUMN audio_transcription_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN audio_transcription_privacy_approved boolean NOT NULL DEFAULT false,
  ADD COLUMN monthly_audio_transcription_session_quota integer
    CHECK (monthly_audio_transcription_session_quota IS NULL OR monthly_audio_transcription_session_quota >= 0);

CREATE TABLE app_audio_transcription_sessions (
  grant_id text PRIMARY KEY,
  session_id text NOT NULL,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  consent_version text NOT NULL CHECK (length(trim(consent_version)) > 0),
  consented_at timestamptz NOT NULL DEFAULT now(),
  provider_session_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (session_id, tenant_id, subject_id)
    REFERENCES app_sessions (session_id, tenant_id, subject_id) ON DELETE CASCADE
);

CREATE INDEX app_audio_transcription_usage_monthly
  ON app_audio_transcription_sessions (tenant_id, subject_id, created_at);
