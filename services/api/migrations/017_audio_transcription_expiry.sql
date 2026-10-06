ALTER TABLE app_audio_transcription_sessions
  ADD COLUMN provider_call_id text,
  ADD COLUMN disconnect_after timestamptz,
  ADD COLUMN disconnect_claimed_at timestamptz,
  ADD COLUMN disconnect_attempts integer NOT NULL DEFAULT 0 CHECK (disconnect_attempts >= 0),
  ADD COLUMN disconnect_next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN disconnected_at timestamptz;

CREATE UNIQUE INDEX app_audio_transcription_provider_call_unique
  ON app_audio_transcription_sessions (provider_call_id)
  WHERE provider_call_id IS NOT NULL;

CREATE INDEX app_audio_transcription_expiry_due
  ON app_audio_transcription_sessions (disconnect_after, disconnect_next_attempt_at)
  WHERE provider_call_id IS NOT NULL AND disconnected_at IS NULL;
