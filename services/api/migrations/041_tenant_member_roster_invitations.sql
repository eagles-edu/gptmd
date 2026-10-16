CREATE TABLE tenant_member_roster_invitations (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id) ON DELETE CASCADE,
  email text NOT NULL CHECK (
    email = lower(btrim(email)) AND
    length(email) BETWEEN 3 AND 254 AND
    email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  group_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  department_code text,
  status text NOT NULL CHECK (status IN ('pending', 'accepted')) DEFAULT 'pending',
  assigned_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  accepted_subject_id text,
  accepted_at timestamptz,
  PRIMARY KEY (tenant_id, email),
  FOREIGN KEY (tenant_id, accepted_subject_id)
    REFERENCES tenant_memberships (tenant_id, subject_id) ON DELETE RESTRICT,
  CHECK ((status = 'pending' AND accepted_subject_id IS NULL AND accepted_at IS NULL) OR
         (status = 'accepted' AND accepted_subject_id IS NOT NULL AND accepted_at IS NOT NULL)),
  CHECK (cardinality(group_codes) <= 100),
  CHECK (array_position(group_codes, NULL) IS NULL),
  CHECK (department_code IS NULL OR department_code ~ '^[a-z][a-z0-9_-]{1,39}$')
);

CREATE TABLE tenant_member_roster_invitation_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  email text NOT NULL CHECK (
    email = lower(btrim(email)) AND
    length(email) BETWEEN 3 AND 254 AND
    email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  changed_by text NOT NULL,
  action text NOT NULL CHECK (action IN ('roster_imported', 'membership_claimed')),
  subject_id text,
  before_group_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  after_group_codes text[] NOT NULL DEFAULT ARRAY[]::text[],
  before_department_code text,
  after_department_code text,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX tenant_member_roster_invitations_pending_by_email
  ON tenant_member_roster_invitations (email, tenant_id)
  WHERE status = 'pending';
CREATE INDEX tenant_member_roster_invitation_audit_by_tenant
  ON tenant_member_roster_invitation_audit (tenant_id, occurred_at DESC);

ALTER TABLE tenant_member_roster_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_member_roster_invitation_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON tenant_member_roster_invitations, tenant_member_roster_invitation_audit FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON tenant_member_roster_invitation_audit FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON tenant_member_roster_invitations, tenant_member_roster_invitation_audit FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE UPDATE, DELETE, TRUNCATE ON tenant_member_roster_invitation_audit FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION reject_tenant_member_roster_invitation_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'tenant member roster invitation audit rows are append-only';
END;
$$;

CREATE TRIGGER tenant_member_roster_invitation_audit_append_only
  BEFORE UPDATE OR DELETE ON tenant_member_roster_invitation_audit
  FOR EACH ROW EXECUTE FUNCTION reject_tenant_member_roster_invitation_audit_mutation();

CREATE TRIGGER tenant_member_roster_invitation_audit_no_truncate
  BEFORE TRUNCATE ON tenant_member_roster_invitation_audit
  FOR EACH STATEMENT EXECUTE FUNCTION reject_tenant_member_roster_invitation_audit_mutation();
