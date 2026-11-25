ALTER TABLE patient_scenarios
  ADD COLUMN scenario_provider text NOT NULL DEFAULT 'openai'
    CHECK (scenario_provider IN ('openai', 'anthropic')),
  ALTER COLUMN provider_conversation_id DROP NOT NULL;

ALTER TABLE session_identity_binding
  ADD COLUMN scenario_provider text NOT NULL DEFAULT 'openai'
    CHECK (scenario_provider IN ('openai', 'anthropic')),
  ALTER COLUMN provider_conversation_id DROP NOT NULL;

DO $migration$
DECLARE
  existing_identity_foreign_key text;
BEGIN
  SELECT conname INTO existing_identity_foreign_key
  FROM pg_constraint
  WHERE conrelid = 'session_identity_binding'::regclass
    AND contype = 'f'
    AND pg_get_constraintdef(oid) LIKE
      'FOREIGN KEY (session_id, patient_profile_id, provider_conversation_id, scenario_fingerprint, schema_version)%';

  IF existing_identity_foreign_key IS NULL THEN
    RAISE EXCEPTION 'The existing session identity foreign key was not found';
  END IF;

  EXECUTE format('ALTER TABLE session_identity_binding DROP CONSTRAINT %I', existing_identity_foreign_key);
END;
$migration$;

ALTER TABLE patient_scenarios
  DROP CONSTRAINT patient_scenarios_identity_tuple_unique,
  ADD CONSTRAINT patient_scenarios_provider_identity_tuple_unique
    UNIQUE (session_id, scenario_id, scenario_provider, profile_digest, schema_version);

ALTER TABLE session_identity_binding
  ADD CONSTRAINT session_identity_binding_scenario_identity_fk
    FOREIGN KEY (session_id, patient_profile_id, scenario_provider, scenario_fingerprint, schema_version)
    REFERENCES patient_scenarios (session_id, scenario_id, scenario_provider, profile_digest, schema_version)
    ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION reject_session_identity_binding_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.session_id, NEW.tenant_id, NEW.subject_id, NEW.patient_profile_id,
    NEW.provider_conversation_id, NEW.scenario_provider, NEW.scenario_fingerprint,
    NEW.schema_version, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.session_id, OLD.tenant_id, OLD.subject_id, OLD.patient_profile_id,
    OLD.provider_conversation_id, OLD.scenario_provider, OLD.scenario_fingerprint,
    OLD.schema_version, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Session identity bindings are immutable';
  END IF;
  RETURN NEW;
END;
$$;
