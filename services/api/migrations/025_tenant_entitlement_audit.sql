CREATE TABLE tenant_entitlement_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  changed_by text NOT NULL,
  before_policy jsonb NOT NULL,
  after_policy jsonb NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_entitlement_audit_by_tenant
  ON tenant_entitlement_audit (tenant_id, changed_at DESC);

REVOKE UPDATE, DELETE, TRUNCATE ON tenant_entitlement_audit FROM PUBLIC;

CREATE FUNCTION reject_tenant_entitlement_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'tenant entitlement audit rows are append-only';
END;
$$;

CREATE TRIGGER tenant_entitlement_audit_append_only
  BEFORE UPDATE OR DELETE ON tenant_entitlement_audit
  FOR EACH ROW EXECUTE FUNCTION reject_tenant_entitlement_audit_mutation();

CREATE TRIGGER tenant_entitlement_audit_no_truncate
  BEFORE TRUNCATE ON tenant_entitlement_audit
  FOR EACH STATEMENT EXECUTE FUNCTION reject_tenant_entitlement_audit_mutation();
