ALTER TABLE app_sessions
  ADD COLUMN prompt_version text NOT NULL DEFAULT 'patient-scenario-prompt-v1'
    CHECK (length(trim(prompt_version)) > 0),
  ADD COLUMN model_version text NOT NULL DEFAULT 'gpt-6-luna'
    CHECK (length(trim(model_version)) > 0),
  ADD COLUMN schema_version integer NOT NULL DEFAULT 1
    CHECK (schema_version > 0),
  ADD COLUMN policy_version text NOT NULL DEFAULT 'patient-scenario-policy-v1'
    CHECK (length(trim(policy_version)) > 0),
  ADD COLUMN setup_idempotency_key_hash text
    CHECK (setup_idempotency_key_hash IS NULL OR setup_idempotency_key_hash ~ '^[a-f0-9]{64}$');

CREATE TABLE patient_scenarios (
  scenario_id text PRIMARY KEY CHECK (scenario_id ~ '^[A-Za-z0-9_-]{43}$'),
  session_id text NOT NULL UNIQUE REFERENCES app_sessions (session_id) ON DELETE CASCADE,
  schema_version integer NOT NULL CHECK (schema_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  profile_digest text NOT NULL CHECK (profile_digest ~ '^[a-f0-9]{64}$'),
  profile_json jsonb NOT NULL CHECK (jsonb_typeof(profile_json) = 'object'),
  provider_conversation_id text NOT NULL CHECK (length(trim(provider_conversation_id)) > 0),
  prompt_version text NOT NULL CHECK (length(trim(prompt_version)) > 0),
  model_version text NOT NULL CHECK (length(trim(model_version)) > 0),
  policy_version text NOT NULL CHECK (length(trim(policy_version)) > 0)
);

CREATE FUNCTION reject_patient_scenario_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'patient scenarios are immutable';
END;
$$;

CREATE TRIGGER patient_scenarios_are_immutable
  BEFORE UPDATE ON patient_scenarios
  FOR EACH ROW EXECUTE FUNCTION reject_patient_scenario_update();
