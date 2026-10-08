-- One immutable, owner-scoped record binds every identifier that defines a scenario session.
ALTER TABLE patient_scenarios
  ADD CONSTRAINT patient_scenarios_identity_tuple_unique
  UNIQUE (session_id, scenario_id, provider_conversation_id, profile_digest, schema_version);

CREATE TABLE session_identity_binding (
  session_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  patient_profile_id text NOT NULL,
  provider_conversation_id text NOT NULL,
  scenario_fingerprint text NOT NULL CHECK (scenario_fingerprint ~ '^[a-f0-9]{64}$'),
  schema_version integer NOT NULL CHECK (schema_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_check_at timestamptz,
  last_verified_at timestamptz,
  last_verification_status text CHECK (
    last_verification_status IS NULL OR
    last_verification_status IN ('verified', 'redis_missing', 'redis_unavailable', 'mismatch')
  ),
  FOREIGN KEY (session_id, tenant_id, subject_id)
    REFERENCES app_sessions (session_id, tenant_id, subject_id) ON DELETE CASCADE,
  FOREIGN KEY (
    session_id, patient_profile_id, provider_conversation_id, scenario_fingerprint, schema_version
  ) REFERENCES patient_scenarios (
    session_id, scenario_id, provider_conversation_id, profile_digest, schema_version
  ) ON DELETE CASCADE
);

CREATE INDEX session_identity_binding_verification_due
  ON session_identity_binding (last_check_at NULLS FIRST, created_at);

INSERT INTO session_identity_binding (
  session_id, tenant_id, subject_id, patient_profile_id, provider_conversation_id,
  scenario_fingerprint, schema_version
)
SELECT s.session_id, s.tenant_id, s.subject_id, p.scenario_id, p.provider_conversation_id,
       p.profile_digest, p.schema_version
FROM app_sessions s
JOIN patient_scenarios p ON p.session_id = s.session_id
ON CONFLICT (session_id) DO NOTHING;

CREATE FUNCTION reject_session_identity_binding_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.session_id, NEW.tenant_id, NEW.subject_id, NEW.patient_profile_id,
    NEW.provider_conversation_id, NEW.scenario_fingerprint, NEW.schema_version, NEW.created_at
  ) IS DISTINCT FROM ROW(
    OLD.session_id, OLD.tenant_id, OLD.subject_id, OLD.patient_profile_id,
    OLD.provider_conversation_id, OLD.scenario_fingerprint, OLD.schema_version, OLD.created_at
  ) THEN
    RAISE EXCEPTION 'session identity bindings are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER session_identity_binding_is_immutable
  BEFORE UPDATE ON session_identity_binding
  FOR EACH ROW EXECUTE FUNCTION reject_session_identity_binding_change();
