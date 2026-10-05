ALTER TABLE tenant_entitlements
  ADD COLUMN monthly_session_quota_per_user integer
    CHECK (monthly_session_quota_per_user IS NULL OR monthly_session_quota_per_user >= 0),
  ADD COLUMN monthly_response_quota_per_user integer
    CHECK (monthly_response_quota_per_user IS NULL OR monthly_response_quota_per_user >= 0),
  ADD COLUMN response_quota_per_session integer
    CHECK (response_quota_per_session IS NULL OR response_quota_per_session >= 0);

CREATE TABLE tenant_user_monthly_usage (
  tenant_id text NOT NULL,
  subject_id text NOT NULL,
  feature text NOT NULL CHECK (feature IN ('sessions', 'responses')),
  month_start date NOT NULL,
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (tenant_id, subject_id, feature, month_start),
  FOREIGN KEY (tenant_id, subject_id)
    REFERENCES tenant_memberships (tenant_id, subject_id) ON DELETE CASCADE
);

CREATE TABLE app_session_usage (
  session_id text NOT NULL REFERENCES app_sessions (session_id) ON DELETE CASCADE,
  feature text NOT NULL CHECK (feature = 'responses'),
  used integer NOT NULL DEFAULT 0 CHECK (used >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, feature)
);
