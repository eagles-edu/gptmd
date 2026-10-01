-- Apply with the gptmd application database owner before enabling authenticated API routes.
CREATE TABLE IF NOT EXISTS tenants (
  tenant_id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_memberships (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id) ON DELETE CASCADE,
  subject_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'suspended', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, subject_id)
);

CREATE TABLE IF NOT EXISTS tenant_entitlements (
  tenant_id text PRIMARY KEY REFERENCES tenants (tenant_id) ON DELETE CASCADE,
  sessions_enabled boolean NOT NULL DEFAULT false,
  responses_enabled boolean NOT NULL DEFAULT false,
  monthly_session_quota integer CHECK (monthly_session_quota IS NULL OR monthly_session_quota >= 0),
  monthly_response_quota integer CHECK (monthly_response_quota IS NULL OR monthly_response_quota >= 0),
  max_active_sessions integer CHECK (max_active_sessions IS NULL OR max_active_sessions >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_monthly_usage (
  tenant_id text NOT NULL REFERENCES tenants (tenant_id) ON DELETE CASCADE,
  feature text NOT NULL CHECK (feature IN ('sessions', 'responses')),
  month_start date NOT NULL,
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (tenant_id, feature, month_start)
);

CREATE TABLE IF NOT EXISTS app_sessions (
  session_id text PRIMARY KEY CHECK (session_id ~ '^[A-Za-z0-9_-]{43}$'),
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('initializing', 'ready', 'active', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, subject_id)
    REFERENCES tenant_memberships (tenant_id, subject_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS app_sessions_active_by_tenant
  ON app_sessions (tenant_id, created_at)
  WHERE status IN ('initializing', 'ready', 'active');
