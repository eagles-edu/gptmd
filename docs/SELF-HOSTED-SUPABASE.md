# Self-hosted Supabase Google sign-in

GPTMD uses Supabase Auth from the official Docker Compose stack. The web app
uses Google OAuth through the Supabase Auth gateway; the GPTMD Express API
verifies the resulting bearer token and checks membership in GPTMD's own
PostgreSQL database. Supabase Auth users do not receive GPTMD tenant access
automatically.

## Current local deployment

The separate Docker deployment is at `/home/eaglesvn/dockerz/supabase-project`
and is based on `self-hosted/v0.8.2`. Its `.env` is mode `0600`. The database
password is stored there as `POSTGRES_PASSWORD` and in GPTMD's ignored `.env`
as `SUPABASE_POSTGRES_PASSWORD`; it is separate from GPTMD's `POSTGRES_PASSWORD`.

The default Compose configuration runs only Postgres, Auth, and the API gateway.
The gateway binds to `127.0.0.1:8000`. PostgREST is disabled by default,
default Data API read/write table grants and sequence usage/select grants are
revoked for the API roles, and a Postgres event trigger enables RLS on newly
created public tables. Studio,
Realtime, Storage, Edge Functions, and the connection pooler are opt-in Compose
profiles. The local Auth health endpoint and ES256 JWKS endpoint have been
verified. Google sign-in is enabled in the running Auth service and its Google
client credentials are configured there.

For local Google OAuth, register
`http://localhost:8000/auth/v1/callback` as Google's authorized redirect URI.
Set `GOOGLE_ENABLED=true`, `GOOGLE_CLIENT_ID`, and `GOOGLE_SECRET` in the
Supabase deployment `.env`, then recreate Auth with
`docker compose up -d --force-recreate auth`. The app return URLs
`http://localhost:4000/confirm` and
The GPTMD Express API uses port 4000, while the Nuxt browser app uses port 3000
by default (or 3001 when 3000 is occupied). Auth had been configured with port
4000 as its site URL and only allowed `/confirm` there, sending OAuth's fallback
to the API and excluding the browser app callback. The local configuration is
now repaired: its site URL is `http://localhost:3000`, and its redirect
allow-list includes `/confirm` on localhost and 127.0.0.1 at ports 3000 and
3001. The Auth container was recreated and the OAuth authorize endpoint now
redirects to Google's consent flow. For a public deployment, use a domain and
HTTPS through a reverse proxy.

The `prod-ca-2021.crt` certificate is for verifying TLS when connecting to a
managed Supabase Postgres endpoint. It is not the server certificate for this
local Docker gateway and is not used by this deployment.

## Configure the Supabase Docker stack

Use the official [Supabase Docker self-hosting guide](https://supabase.com/docs/guides/self-hosting/docker)
to install and maintain the complete Supabase stack in its own deployment
directory. Do not merge that stack's PostgreSQL data directory or credentials
with GPTMD's application database. This repository currently has a PostgreSQL
service bound to `127.0.0.1:5432`; if both stacks run on the same host, assign
Supabase's host database port another free port in the Supabase stack `.env`.

In the Supabase deployment `.env`, configure:

- `API_EXTERNAL_URL` as the public Auth gateway URL ending in `/auth/v1`.
- `SITE_URL` as the GPTMD web origin.
- `ADDITIONAL_REDIRECT_URLS` with each exact GPTMD `/confirm` URL used by the
  deployment and local development.
- `GOOGLE_ENABLED=true`, `GOOGLE_CLIENT_ID`, and `GOOGLE_SECRET`.
- `JWT_SECRET` as a random secret of at least 32 bytes. The official setup also
  uses it for legacy keys while generating the current ES256 signing key pair.

In the `auth` service of the official Supabase `docker-compose.yml`, pass
through the Google values (following the official OAuth guide):

```yaml
GOTRUE_EXTERNAL_GOOGLE_ENABLED: ${GOOGLE_ENABLED}
GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: ${GOOGLE_CLIENT_ID}
GOTRUE_EXTERNAL_GOOGLE_SECRET: ${GOOGLE_SECRET}
GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: ${API_EXTERNAL_URL}/callback
```

Register `${API_EXTERNAL_URL}/callback` as Google's authorized redirect URI.
That callback belongs to Supabase Auth; the app return URL is `/confirm` and
must be in Supabase's redirect allow-list. The current official Docker setup
generates an ES256 signing key pair and exposes its public key at
`/auth/v1/.well-known/jwks.json`; GPTMD verifies tokens using that public JWKS.
Do not copy private signing keys into the GPTMD API. GPTMD also retains HS256
verification support for older stacks.

## Configure GPTMD

In GPTMD's ignored `.env`, set the public Auth gateway URL and publishable key
for the client. The key is safe for browsers; never set a Supabase secret or
service-role key in a `NUXT_PUBLIC_` variable.

```dotenv
NUXT_PUBLIC_SUPABASE_URL=https://auth.example.test
NUXT_PUBLIC_SUPABASE_KEY=your-supabase-publishable-key
API_AUTH_JWT_ISSUER=https://auth.example.test/auth/v1
API_AUTH_JWT_AUDIENCE=authenticated
API_AUTH_JWT_JWKS_URL=https://auth.example.test/auth/v1/.well-known/jwks.json
API_CORS_ORIGINS=https://gptmd.example.test
```

With the current asymmetric Supabase setup, the public JWKS URL is the
verifier. Set `API_AUTH_JWT_SECRET` only when using an older HS256-only
Supabase setup, and keep it in ignored secret storage.

For local development, add the exact browser origin to `API_CORS_ORIGINS` and
the exact Nuxt `/confirm` URL to Supabase's `ADDITIONAL_REDIRECT_URLS`. Include
the port Nuxt actually uses (usually `3000`, or `3001` when occupied), and match
the hostname used in the browser (`localhost` or `127.0.0.1`). Use HTTPS for
deployed Google OAuth origins.

In this workspace, the ignored GPTMD root `.env` has the local gateway URL,
publishable key, issuer, audience, JWKS endpoint, and development CORS origins.
Its `SUPABASE_POSTGRES_PASSWORD` is the separate database password already
configured as `POSTGRES_PASSWORD` in the Supabase deployment `.env`; do not
replace GPTMD's existing database password.

Start Supabase using its deployment's documented `docker compose up -d` flow,
then start GPTMD and the API. Check Supabase Auth's `/settings` endpoint to
confirm Google is enabled. Apply GPTMD's `001_auth_sessions.sql` migration to
its application database, then provision a tenant, active membership, and
entitlements for each approved Supabase Auth user. The Auth subject is the
Supabase user UUID (`sub`). Entitlements default to disabled until explicitly
provisioned.

## Sign-in and workspace behavior

The login page starts Google OAuth using PKCE. Supabase sessions use the
Nuxt module's SSR cookies; encounter and account data are not written to
browser storage. GPTMD's API reads the bearer token, resolves active tenant
memberships from GPTMD PostgreSQL, and verifies any requested workspace on
every request. A user with one active workspace is selected automatically; a
user with multiple workspaces chooses one on Account Status. A valid Google
account without an active membership sees an access message and cannot create
sessions.

Google OAuth cannot be completed until the deployment has valid Google OAuth
client credentials and reachable public HTTPS callback URLs.
