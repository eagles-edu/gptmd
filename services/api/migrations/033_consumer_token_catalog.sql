CREATE TABLE gptmd_consumer_token_catalog (
  catalog_id smallint PRIMARY KEY CHECK (catalog_id = 1),
  revision integer NOT NULL CHECK (revision > 0),
  catalog jsonb NOT NULL CHECK (jsonb_typeof(catalog) = 'object'),
  changed_by text NOT NULL CHECK (length(trim(changed_by)) BETWEEN 1 AND 200),
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE gptmd_consumer_token_catalog_audit (
  audit_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  revision integer NOT NULL UNIQUE CHECK (revision > 0),
  changed_by text NOT NULL CHECK (length(trim(changed_by)) BETWEEN 1 AND 200),
  catalog jsonb NOT NULL CHECK (jsonb_typeof(catalog) = 'object'),
  changed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE gptmd_consumer_token_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE gptmd_consumer_token_catalog_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gptmd_consumer_token_catalog, gptmd_consumer_token_catalog_audit FROM PUBLIC;
REVOKE UPDATE, DELETE, TRUNCATE ON gptmd_consumer_token_catalog_audit FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON gptmd_consumer_token_catalog, gptmd_consumer_token_catalog_audit FROM %I',
        role_name
      );
      EXECUTE format(
        'REVOKE UPDATE, DELETE, TRUNCATE ON gptmd_consumer_token_catalog_audit FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION reject_gptmd_consumer_token_catalog_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'consumer token catalog audit rows are append-only';
END;
$$;

CREATE TRIGGER gptmd_consumer_token_catalog_audit_append_only
  BEFORE UPDATE OR DELETE ON gptmd_consumer_token_catalog_audit
  FOR EACH ROW EXECUTE FUNCTION reject_gptmd_consumer_token_catalog_audit_mutation();

CREATE TRIGGER gptmd_consumer_token_catalog_audit_no_truncate
  BEFORE TRUNCATE ON gptmd_consumer_token_catalog_audit
  FOR EACH STATEMENT EXECUTE FUNCTION reject_gptmd_consumer_token_catalog_audit_mutation();
