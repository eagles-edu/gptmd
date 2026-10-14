ALTER TABLE patient_scenarios
  ADD COLUMN presentation_settings_json jsonb,
  ADD COLUMN presentation_settings_digest text,
  ADD CONSTRAINT patient_scenarios_presentation_settings_object
    CHECK (presentation_settings_json IS NULL OR jsonb_typeof(presentation_settings_json) = 'object'),
  ADD CONSTRAINT patient_scenarios_presentation_settings_pair
    CHECK ((presentation_settings_json IS NULL) = (presentation_settings_digest IS NULL)),
  ADD CONSTRAINT patient_scenarios_presentation_settings_digest
    CHECK (presentation_settings_digest IS NULL OR presentation_settings_digest ~ '^[0-9a-f]{64}$');

CREATE TABLE tenant_patient_variant_settings (
  tenant_id text PRIMARY KEY REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  status text NOT NULL CHECK (status IN ('draft', 'approved')),
  revision integer NOT NULL CHECK (revision > 0),
  variants jsonb NOT NULL CHECK (jsonb_typeof(variants) = 'array' AND jsonb_array_length(variants) = 10),
  changed_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_patient_variant_settings_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  changed_by text NOT NULL,
  before_settings jsonb,
  after_settings jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_patient_variant_settings_audit_by_tenant
  ON tenant_patient_variant_settings_audit (tenant_id, changed_at DESC);

ALTER TABLE tenant_patient_variant_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_patient_variant_settings_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tenant_patient_variant_settings, tenant_patient_variant_settings_audit FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON tenant_patient_variant_settings_audit FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON tenant_patient_variant_settings, tenant_patient_variant_settings_audit FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE UPDATE, DELETE, TRUNCATE ON tenant_patient_variant_settings_audit FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION reject_patient_variant_settings_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'patient variant settings audit rows are append-only';
END;
$$;

CREATE TRIGGER patient_variant_settings_audit_append_only
  BEFORE UPDATE OR DELETE ON tenant_patient_variant_settings_audit
  FOR EACH ROW EXECUTE FUNCTION reject_patient_variant_settings_audit_mutation();

CREATE TRIGGER patient_variant_settings_audit_no_truncate
  BEFORE TRUNCATE ON tenant_patient_variant_settings_audit
  FOR EACH STATEMENT EXECUTE FUNCTION reject_patient_variant_settings_audit_mutation();
