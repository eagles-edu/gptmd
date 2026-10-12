ALTER TABLE app_audio_transcription_sessions
  ADD COLUMN usage_observer_status text NOT NULL DEFAULT 'pending'
    CHECK (usage_observer_status IN ('pending', 'connected', 'interrupted')),
  ADD COLUMN provider_audio_seconds numeric(14, 3) NOT NULL DEFAULT 0
    CHECK (provider_audio_seconds >= 0);

CREATE TABLE app_audio_transcription_usage_events (
  grant_id text NOT NULL REFERENCES app_audio_transcription_sessions (grant_id) ON DELETE CASCADE,
  provider_call_id text NOT NULL,
  provider_event_id text NOT NULL CHECK (length(provider_event_id) BETWEEN 1 AND 128),
  audio_seconds numeric(14, 3) NOT NULL CHECK (audio_seconds BETWEEN 0 AND 900),
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider_call_id, provider_event_id)
);

CREATE INDEX app_audio_transcription_usage_events_grant
  ON app_audio_transcription_usage_events (grant_id, received_at);
