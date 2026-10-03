# gptmd API service

This is the separate Express service boundary for the project. It is
TypeScript-built and currently exposes:

- `GET /healthz` — process health
- `GET /readyz` — Redis, PostgreSQL, OpenAI, and authentication readiness
- `POST /api/openai/responses` — authenticated, tenant-quota-limited Responses API integration
- `POST /api/sessions` — create an opaque initializing application session
- `POST /api/sessions/:sessionId/setup` — idempotently generate and persist the immutable scenario
- `POST /api/sessions/:sessionId/turns` — serialize, validate, and accept a patient turn
- `GET /api/sessions/:sessionId` — read a session owned by the authenticated user and tenant

The private patient-scenario generator in `src/patient-profile.ts` creates a
Responses Conversation, requests a strict structured profile, validates it,
and retries once in a fresh Conversation when validation fails. Its canonical
field catalog is in `catalog/patient-profile.json` and is checked against the
runtime contract; the documentation JSON Schema is in
`../../docs/schemas/patient-scenario-profile.schema.json`. This module is not
an HTTP route on its own; the authenticated session setup route coordinates
generation and persistence. Keep its full profile server-side; the learner-facing
profile is a separate contract.
Across the private and learner-safe contracts, the shared fields are named
`fullName`, `dateOfBirth`, `bodyType`, and `reasonForVisit`; the private profile
also has `diagnosis`.

The service defaults to `HOST=127.0.0.1` and `PORT=4000`. It refuses a
non-loopback `HOST` so it cannot accidentally become a public listener. The
API launcher reads the ignored repository `.env` file and passes only the
service's OpenAI, Redis, PostgreSQL, JWT verification, host, and port variables
to the process.

## Authentication and tenant provisioning

The API verifies signed bearer JWTs from a trusted identity issuer. Configure
the exact expected `API_AUTH_JWT_ISSUER` and `API_AUTH_JWT_AUDIENCE`. For the
current self-hosted Supabase Auth Docker setup, set
`API_AUTH_JWT_JWKS_URL` to the public `/auth/v1/.well-known/jwks.json` URL and
use audience `authenticated`. Legacy HS256-only setups can instead use
`API_AUTH_JWT_SECRET` with at least 32 random bytes. Tokens must contain `sub`,
`iss`, `aud`, and an unexpired `exp`. The API does not issue login tokens or
trust entitlements embedded in tokens. A token's optional `tenant_id` is only
a workspace selection hint; the API checks every selection against active
membership in GPTMD PostgreSQL. Keep private signing material only in ignored
secret storage. Use TLS at the reverse proxy before accepting bearer tokens
outside loopback.

The browser sends the Supabase access token as a bearer token. Configure
`API_CORS_ORIGINS` with exact trusted web origins. `GET /api/account/tenants`
returns active workspace IDs for the authenticated subject. Other API routes
accept `X-GPTMD-Tenant-ID`; when omitted, the API chooses a workspace only if
the user has exactly one active membership.

Apply the schema as the application database owner after PostgreSQL is ready:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/001_auth_sessions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/002_patient_scenario_setup.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/003_patient_profile_binding.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/004_durable_session_history.sql
```

Provision a tenant row in `tenants`, its active `(tenant_id, subject_id)` in
`tenant_memberships`, and its flags and limits in `tenant_entitlements` before
allowing a user to call the API. Entitlements default to disabled. A `NULL`
monthly quota or active-session limit means unlimited; zero means no use. The
API rechecks active membership, atomically reserves monthly usage, and returns
`403` for missing capability or `429` for exhausted limits. Usage is counted
when the API accepts work, including a provider request that later fails.

See [`docs/SELF-HOSTED-SUPABASE.md`](../../docs/SELF-HOSTED-SUPABASE.md) for
the Docker and Google OAuth setup.

Session IDs contain 256 random bits encoded as base64url. Session lookup binds
the ID, tenant, and authenticated subject in one database query; an absent or
foreign session returns the same `404` response. Provider Conversation IDs are
not included in session responses. Session creation records the configured
model ID plus prompt, schema, and policy versions. Setup requires an
`Idempotency-Key`; PostgreSQL locks the owned session while generation runs,
so concurrent matching requests share the committed result and a changed key
receives `409`. The validated private profile, digest, and Conversation ID are
committed together with the session's transition to `ready`. A database
trigger rejects updates to saved scenario rows. The setup response contains
only the learner-safe profile projection. Setup initializes the session and
per-visit patient JSON documents in Redis before calling the profile generator;
after PostgreSQL commits the accepted profile, its five-value private setup
projection, digest, version, and Conversation ID are mirrored into Redis. A
matching retry repairs a missing Redis mirror from the immutable PostgreSQL
scenario without creating a new provider Conversation. Apply migration 003
and migration 004 before starting this API version; `/readyz` checks the
session binding and durable-history tables.

## Redis live state and PostgreSQL history

Run the session-history worker as a separate process next to the API:

```bash
npm run api:worker
```

The API's Redis state store accepts an already generated `SessionTurn` with one
Lua/EVAL transaction. It updates the session and patient JSON documents, saves
the turn's retry reply, and appends the event to `gptmd:session-events` in that
same atomic operation. A repeated turn ID returns its saved reply. Terminal
events use the same stream and set an absolute 20-minute expiry on live JSON;
the stream and retry group are retained independently.

The worker consumes the `gptmd-session-history` consumer group in bounded
batches. PostgreSQL locks each session row, checks the next event sequence,
inserts the event and terminal outcome idempotently, and commits before the
worker acknowledges the stream entry. A failed database write stays pending;
the worker retries claimed entries after the database is available. Multiple
worker processes cannot commit events for one session out of order because the
session row lock and sequence check serialize their writes.

The local Redis Stack is configured with AOF enabled and `appendfsync
everysec`, so a sudden Redis failure can lose up to roughly one second of
recent writes. Redis replays its AOF on restart. If an owned session's JSON is
missing, `GET /api/sessions/:sessionId` rebuilds it from the immutable
PostgreSQL scenario and committed session events, including saved retry replies.
Events that Redis lost before the worker committed them to PostgreSQL are
within the documented one-second loss window. The local recovery verifier
exercises Redis turn retries, worker commit/ack ordering, terminal outcomes,
and reconstruction after deleting the test session's Redis JSON:

```bash
npm run verify:phase2
```

The verifier uses a temporary PostgreSQL database, requires permission to
create and drop that database, and refuses to run while the shared Redis event
stream contains entries.

## Patient turns

The browser posts `{ "turnId": "...", "text": "..." }` to the authenticated
session turn route. GPTMD checks tenant/session ownership and response quota,
acquires a Redis per-session lock, and returns the saved patient reply for an
accepted matching retry. A different message that reuses an accepted turn ID
receives `409`; an overlapping new turn receives `409` and can retry after the
active turn finishes.

Redis JSON is the active copy of the private patient profile, accepted session
state, transcript, coverage, disclosures, and fact expansions. The provider
Conversation ID and prompt/model/schema/policy pins come from that session's
saved Redis state and PostgreSQL session row. The patient response uses a
structured Responses result with the session's stored Conversation. Proposed
facts are accepted only for scenario history fields marked unknown, and cannot
replace the seed or conflict with earlier accepted facts. Diagnosis stays out
of the per-turn projection and the prompt prohibits disclosing private answer
key data. The API retries invalid structured output once; if it remains
invalid, it accepts a fixed clarification with no new facts. Failure audit logs
contain only the event type, session ID, and turn ID.

An accepted turn atomically updates the Redis JSON state, retry reply, and
recovery event in `gptmd:session-events`. The existing worker persists the
accepted turn to PostgreSQL asynchronously; the learner response does not wait
for worker completion. The accepted event carries transcript text, patient
reported fact expansions, history coverage, disclosed fact IDs, and any
clinical actions for replay. This route currently implements the text history
path; orders, exams, assessment submission, and modality transitions remain
later phase work.

## Local development

From the repository root:

```bash
npm --prefix services/api install
npm run api:build
npm run api:dev
```

Probe it locally:

```bash
curl http://127.0.0.1:4000/healthz
curl http://127.0.0.1:4000/readyz
```

The API uses pooled Redis and PostgreSQL clients. The OpenAI SDK key is only
read by Express and is never sent to the browser. Send a JSON body containing
`input` to `/api/openai/responses`; use fictional data only and never send
patient identifiers or other protected health information.

## Local PostgreSQL

Set up the local PostgreSQL container with:

```bash
docker compose --env-file .env -f ops/postgres.compose.yml up -d
docker compose --env-file .env -f ops/postgres.compose.yml ps
```

PostgreSQL binds to `127.0.0.1:5432` and stores data in a named Compose volume.
The initialization script creates a separate
read-only role for the PostgreSQL MCP server. `docker compose down` preserves
the volume; do not use `-v` unless you intend to delete the database.

## Local production-style deployment

Build the service and install the reviewed systemd template only after
checking the user, paths, and port:

```bash
npm run api:build
sudo install -o root -g root -m 0644 ops/gptmd-api.service /etc/systemd/system/gptmd-api.service
sudo systemctl daemon-reload
sudo systemctl enable --now gptmd-api.service
systemctl status gptmd-api.service --no-pager
```

The systemd unit keeps Express on loopback. A secure subdomain is a separate
reverse-proxy concern: Nginx terminates ACME-backed TLS for
`api.eaglesvn.club` and proxies to `http://127.0.0.1:4000`. Review
`ops/nginx/api.eaglesvn.club.conf.example`, DNS, certificate paths, and the
existing OLSWS/Nginx port ownership before activating that configuration.

Redis session state, clinical-data migrations, and identity provider
account/login flows remain separate work. The API stays on loopback;
TLS proxy activation and production identity-provider provisioning are not
performed by this local implementation.
