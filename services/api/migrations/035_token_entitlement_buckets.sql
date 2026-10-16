CREATE TABLE gptmd_token_entitlement_grants (
  grant_id text PRIMARY KEY CHECK (length(trim(grant_id)) BETWEEN 1 AND 200),
  account_scope text NOT NULL CHECK (account_scope IN ('consumer', 'organization')),
  subject_id text,
  tenant_id text REFERENCES tenants (tenant_id) ON DELETE RESTRICT,
  group_code text,
  bucket_kind text NOT NULL CHECK (bucket_kind IN ('included', 'addon')),
  source_kind text NOT NULL CHECK (source_kind IN ('subscription_renewal', 'organization_allocation', 'verified_purchase')),
  source_reference text NOT NULL CHECK (length(trim(source_reference)) BETWEEN 1 AND 200),
  granted_tokens bigint NOT NULL CHECK (granted_tokens > 0),
  granted_at timestamptz NOT NULL,
  valid_from timestamptz NOT NULL,
  renewal_at timestamptz,
  expires_at timestamptz NOT NULL,
  granted_by text NOT NULL CHECK (length(trim(granted_by)) BETWEEN 1 AND 200),
  UNIQUE (account_scope, source_reference),
  CHECK (expires_at > valid_from),
  CHECK (
    (account_scope = 'consumer' AND subject_id IS NOT NULL AND tenant_id IS NULL AND group_code IS NULL)
    OR
    (account_scope = 'organization' AND subject_id IS NULL AND tenant_id IS NOT NULL AND group_code IS NOT NULL)
  ),
  CHECK (
    (account_scope = 'consumer' AND bucket_kind = 'included'
      AND renewal_at IS NOT NULL AND source_kind = 'subscription_renewal'
      AND expires_at = renewal_at)
    OR (account_scope = 'organization' AND bucket_kind = 'included'
      AND renewal_at IS NOT NULL AND source_kind = 'organization_allocation'
      AND expires_at = renewal_at + interval '45 days')
    OR
    (bucket_kind = 'addon' AND renewal_at IS NULL AND source_kind = 'verified_purchase'
      AND expires_at = granted_at + interval '365 days')
  )
);

CREATE INDEX gptmd_token_grants_consumer_active
  ON gptmd_token_entitlement_grants (subject_id, bucket_kind, expires_at)
  WHERE account_scope = 'consumer';
CREATE INDEX gptmd_token_grants_organization_active
  ON gptmd_token_entitlement_grants (tenant_id, group_code, bucket_kind, expires_at)
  WHERE account_scope = 'organization';

CREATE TABLE gptmd_token_entitlement_entries (
  entry_id text PRIMARY KEY CHECK (length(trim(entry_id)) BETWEEN 1 AND 200),
  grant_id text NOT NULL REFERENCES gptmd_token_entitlement_grants (grant_id) ON DELETE RESTRICT,
  reservation_id text REFERENCES provider_token_reservations (reservation_id) ON DELETE RESTRICT,
  entry_kind text NOT NULL CHECK (entry_kind IN ('usage_debit', 'reversal')),
  token_delta bigint NOT NULL CHECK (token_delta <> 0),
  source_reference text NOT NULL CHECK (length(trim(source_reference)) BETWEEN 1 AND 200),
  occurred_at timestamptz NOT NULL,
  UNIQUE (grant_id, source_reference),
  CHECK ((entry_kind = 'usage_debit' AND token_delta < 0) OR
         (entry_kind = 'reversal' AND token_delta > 0))
);

CREATE INDEX gptmd_token_entries_by_grant_time
  ON gptmd_token_entitlement_entries (grant_id, occurred_at);
CREATE INDEX gptmd_token_entries_by_reservation
  ON gptmd_token_entitlement_entries (reservation_id, grant_id)
  WHERE reservation_id IS NOT NULL;
CREATE UNIQUE INDEX gptmd_token_entries_reservation_grant_debit
  ON gptmd_token_entitlement_entries (reservation_id, grant_id)
  WHERE reservation_id IS NOT NULL AND entry_kind = 'usage_debit';

CREATE TABLE gptmd_token_reservation_allocations (
  reservation_id text NOT NULL REFERENCES provider_token_reservations (reservation_id) ON DELETE RESTRICT,
  grant_id text NOT NULL REFERENCES gptmd_token_entitlement_grants (grant_id) ON DELETE RESTRICT,
  reserved_tokens bigint NOT NULL CHECK (reserved_tokens > 0),
  PRIMARY KEY (reservation_id, grant_id)
);
CREATE INDEX gptmd_token_reservation_allocations_by_grant
  ON gptmd_token_reservation_allocations (grant_id, reservation_id);

ALTER TABLE gptmd_token_entitlement_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE gptmd_token_entitlement_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE gptmd_token_reservation_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON gptmd_token_entitlement_grants, gptmd_token_entitlement_entries,
  gptmd_token_reservation_allocations FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format(
        'REVOKE ALL ON gptmd_token_entitlement_grants, gptmd_token_entitlement_entries, gptmd_token_reservation_allocations FROM %I',
        role_name
      );
    END IF;
  END LOOP;
END;
$$;

CREATE FUNCTION reject_gptmd_token_ledger_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'GPTMD token entitlement grant and usage ledger rows are append-only';
END;
$$;

CREATE TRIGGER gptmd_token_grants_append_only
  BEFORE UPDATE OR DELETE ON gptmd_token_entitlement_grants
  FOR EACH ROW EXECUTE FUNCTION reject_gptmd_token_ledger_mutation();
CREATE TRIGGER gptmd_token_grants_no_truncate
  BEFORE TRUNCATE ON gptmd_token_entitlement_grants
  FOR EACH STATEMENT EXECUTE FUNCTION reject_gptmd_token_ledger_mutation();
CREATE TRIGGER gptmd_token_entries_append_only
  BEFORE UPDATE OR DELETE ON gptmd_token_entitlement_entries
  FOR EACH ROW EXECUTE FUNCTION reject_gptmd_token_ledger_mutation();
CREATE TRIGGER gptmd_token_entries_no_truncate
  BEFORE TRUNCATE ON gptmd_token_entitlement_entries
  FOR EACH STATEMENT EXECUTE FUNCTION reject_gptmd_token_ledger_mutation();
