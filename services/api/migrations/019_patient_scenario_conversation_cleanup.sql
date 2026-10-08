CREATE TABLE app_patient_scenario_conversation_cleanup (
  provider_conversation_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  cleanup_claimed_at timestamptz,
  cleanup_attempts integer NOT NULL DEFAULT 0 CHECK (cleanup_attempts >= 0),
  cleanup_next_attempt_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX app_patient_scenario_conversation_cleanup_due
  ON app_patient_scenario_conversation_cleanup (cleanup_next_attempt_at, created_at);
