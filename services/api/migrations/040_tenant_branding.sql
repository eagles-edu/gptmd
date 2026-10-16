CREATE TABLE tenant_branding (
  tenant_id text PRIMARY KEY REFERENCES tenants (tenant_id) ON DELETE CASCADE,
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 120),
  logo_path text NOT NULL CHECK (logo_path ~ '^/assets/images/[A-Za-z0-9-]+\.svg$'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
