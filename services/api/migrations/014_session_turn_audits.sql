CREATE TABLE session_turn_audits (
  audit_id uuid PRIMARY KEY,
  session_id text NOT NULL REFERENCES app_sessions (session_id) ON DELETE RESTRICT,
  turn_id_hash char(64) NOT NULL CHECK (turn_id_hash ~ '^[a-f0-9]{64}$'),
  event_type text NOT NULL CHECK (event_type IN (
    'patient_turn_model_failure',
    'patient_turn_validation_failure',
    'patient_turn_recovered_after_validation_retry',
    'patient_turn_lock_release_failure'
  )),
  attempt_count smallint NOT NULL CHECK (attempt_count BETWEEN 1 AND 2),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX session_turn_audits_by_session_time
  ON session_turn_audits (session_id, occurred_at);

CREATE TRIGGER session_turn_audits_are_append_only
  BEFORE UPDATE OR DELETE ON session_turn_audits
  FOR EACH ROW EXECUTE FUNCTION reject_durable_history_mutation();
