ALTER TABLE app_sessions
  ADD CONSTRAINT app_sessions_identity_scope_unique UNIQUE (session_id, tenant_id, subject_id);

CREATE TABLE provider_token_reservations (
  reservation_id text PRIMARY KEY,
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  session_id text NOT NULL,
  budget_group_code text,
  budget_department_code text,
  operation text NOT NULL CHECK (operation IN ('scenario_setup', 'patient_turn')),
  input_tokens integer NOT NULL CHECK (input_tokens >= 0),
  output_token_cap integer NOT NULL CHECK (output_token_cap > 0),
  status text NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'settled', 'held', 'released')),
  provider_response_id text UNIQUE,
  actual_total_tokens integer CHECK (actual_total_tokens >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  FOREIGN KEY (session_id, tenant_id, subject_id)
    REFERENCES app_sessions (session_id, tenant_id, subject_id) ON DELETE RESTRICT,
  CHECK (
    (status = 'settled' AND provider_response_id IS NOT NULL AND actual_total_tokens IS NOT NULL AND settled_at IS NOT NULL)
    OR status <> 'settled'
  )
);

CREATE INDEX provider_token_reservations_by_budget
  ON provider_token_reservations (tenant_id, budget_group_code, budget_department_code, created_at);
CREATE INDEX provider_token_reservations_held
  ON provider_token_reservations (created_at) WHERE status = 'held';

ALTER TABLE provider_token_reservations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON provider_token_reservations FROM PUBLIC;

DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON provider_token_reservations FROM %I', role_name);
    END IF;
  END LOOP;
END;
$$;
