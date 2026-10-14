CREATE TABLE tenant_ai_time_budget_settings (
  tenant_id text PRIMARY KEY REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  revision integer NOT NULL CHECK (revision > 0),
  settings jsonb NOT NULL CHECK (jsonb_typeof(settings) = 'object'),
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE tenant_ai_time_budget_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  changed_by text NOT NULL,
  before_settings jsonb,
  after_settings jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_ai_time_budget_audit_by_tenant
  ON tenant_ai_time_budget_audit (tenant_id, changed_at DESC);

ALTER TABLE tenant_ai_time_budget_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_ai_time_budget_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tenant_ai_time_budget_settings, tenant_ai_time_budget_audit FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON tenant_ai_time_budget_audit FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON tenant_ai_time_budget_settings, tenant_ai_time_budget_audit FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE UPDATE, DELETE, TRUNCATE ON tenant_ai_time_budget_audit FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION reject_tenant_ai_time_budget_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'organization AI-time budget audit rows are append-only';
END;
$$;

CREATE TRIGGER tenant_ai_time_budget_audit_append_only
  BEFORE UPDATE OR DELETE ON tenant_ai_time_budget_audit
  FOR EACH ROW EXECUTE FUNCTION reject_tenant_ai_time_budget_audit_mutation();

CREATE TRIGGER tenant_ai_time_budget_audit_no_truncate
  BEFORE TRUNCATE ON tenant_ai_time_budget_audit
  FOR EACH STATEMENT EXECUTE FUNCTION reject_tenant_ai_time_budget_audit_mutation();
