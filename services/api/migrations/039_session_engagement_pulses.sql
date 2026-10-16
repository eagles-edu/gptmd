-- Store low-resolution active-session estimates without capturing interaction content.
CREATE TABLE session_engagement_pulses (
  session_id text NOT NULL,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  pulse_id uuid NOT NULL,
  activity_seconds smallint NOT NULL DEFAULT 30 CHECK (activity_seconds = 30),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, pulse_id),
  FOREIGN KEY (session_id, tenant_id, subject_id)
    REFERENCES app_sessions (session_id, tenant_id, subject_id) ON DELETE RESTRICT
);

CREATE INDEX session_engagement_pulses_by_tenant_time
  ON session_engagement_pulses (tenant_id, recorded_at, subject_id);

CREATE TRIGGER session_engagement_pulses_are_append_only
  BEFORE UPDATE OR DELETE ON session_engagement_pulses
  FOR EACH ROW EXECUTE FUNCTION reject_durable_history_mutation();
