CREATE TABLE tenant_member_ai_group_assignments (
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  group_code text NOT NULL CHECK (group_code ~ '^[a-z][a-z0-9_-]{1,39}$'),
  assigned_by text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subject_id, group_code),
  FOREIGN KEY (tenant_id, subject_id)
    REFERENCES tenant_memberships (tenant_id, subject_id) ON DELETE CASCADE
);

CREATE INDEX tenant_member_ai_group_assignments_by_group
  ON tenant_member_ai_group_assignments (tenant_id, group_code, subject_id);

CREATE TABLE tenant_member_ai_department_assignments (
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  department_code text NOT NULL CHECK (department_code ~ '^[a-z][a-z0-9_-]{1,39}$'),
  assigned_by text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subject_id),
  FOREIGN KEY (tenant_id, subject_id)
    REFERENCES tenant_memberships (tenant_id, subject_id) ON DELETE CASCADE
);

CREATE TABLE tenant_member_ai_assignment_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  subject_id text NOT NULL,
  changed_by text NOT NULL,
  before_groups text[] NOT NULL,
  after_groups text[] NOT NULL,
  before_department text,
  after_department text,
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_member_ai_assignment_audit_by_tenant
  ON tenant_member_ai_assignment_audit (tenant_id, changed_at DESC);

ALTER TABLE app_sessions
  ADD COLUMN ai_budget_group_code text,
  ADD COLUMN ai_budget_department_code text;

ALTER TABLE tenant_member_ai_group_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_member_ai_department_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_member_ai_assignment_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tenant_member_ai_group_assignments,
  tenant_member_ai_department_assignments,
  tenant_member_ai_assignment_audit FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON tenant_member_ai_assignment_audit FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON tenant_member_ai_group_assignments, tenant_member_ai_department_assignments, tenant_member_ai_assignment_audit FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE UPDATE, DELETE, TRUNCATE ON tenant_member_ai_assignment_audit FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION reject_tenant_member_ai_assignment_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'tenant member AI assignment audit rows are append-only';
END;
$$;

CREATE TRIGGER tenant_member_ai_assignment_audit_append_only
  BEFORE UPDATE OR DELETE ON tenant_member_ai_assignment_audit
  FOR EACH ROW EXECUTE FUNCTION reject_tenant_member_ai_assignment_audit_mutation();

CREATE TRIGGER tenant_member_ai_assignment_audit_no_truncate
  BEFORE TRUNCATE ON tenant_member_ai_assignment_audit
  FOR EACH STATEMENT EXECUTE FUNCTION reject_tenant_member_ai_assignment_audit_mutation();
