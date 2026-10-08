# gptmd API service

This is the separate Express service boundary for the project. It is
TypeScript-built and currently exposes:

- `GET /healthz` — process health
- `GET /readyz` — Redis, PostgreSQL, OpenAI, and authentication readiness
- `POST /api/openai/responses` — authenticated, tenant-quota-limited Responses API integration
- `POST /api/sessions` — create an opaque initializing application session
- `POST /api/sessions/:sessionId/setup` — idempotently generate and persist the immutable scenario
- `POST /api/sessions/:sessionId/turns` — serialize, validate, and accept a patient turn
- `POST /api/sessions/:sessionId/audio-transcription` — consent- and entitlement-gated Realtime STT credential
- `GET /api/sessions/:sessionId` — read a session owned by the authenticated user and tenant
- `GET /api/encounters/current` — find and restore the current owner-scoped encounter without browser storage; Redis locates the candidate from a tenant-and-subject hash, PostgreSQL verifies ownership and falls back to the latest open session if Redis has lost the lookup

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
returns `{ memberships: [{ tenantId, role }] }` for the authenticated subject,
including only active workspace memberships. The browser uses the role to show
workspace access and disables learner encounter entry for instructor and
customer-administrator memberships. Other API routes accept
`X-GPTMD-Tenant-ID`; when omitted, the API chooses a workspace only if the user
has exactly one active membership. Encounter routes still authorize only the
learner role.

Apply the schema as the application database owner after PostgreSQL is ready:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/001_auth_sessions.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/002_patient_scenario_setup.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/003_patient_profile_binding.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/004_durable_session_history.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/005_setup_failure_status.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/006_tenant_membership_roles.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/007_user_and_session_quotas.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/008_scope_session_usage_to_owner.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/009_audio_transcription_policy.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/010_disclosure_event_ordinals.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/011_persist_scenario_seed.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/013_assessment_events.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/014_session_turn_audits.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/015_session_transcript_view.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/016_strict_session_transcript_view.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/017_audio_transcription_expiry.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/018_provider_usage_cost_attribution.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/019_patient_scenario_conversation_cleanup.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/020_session_identity_binding.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/021_assessment_drafts.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f services/api/migrations/022_session_local_utterances.sql
```

Provision a tenant row in `tenants`, its active `(tenant_id, subject_id)` in
`tenant_memberships`, and its flags and limits in `tenant_entitlements` before
allowing a user to call the API. Entitlements default to disabled. A `NULL`
monthly quota or active-session limit means unlimited; zero means no use. The
API rechecks active membership, atomically reserves tenant and configured
user/session usage, and returns
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
scenario without creating a new provider Conversation. Apply all listed
migrations through 022 before starting this API version; `/readyz` checks membership
roles, scoped usage tables, session binding, durable-history tables, and audio
consent/quota schema. If
setup generation or validation fails before the scenario commits, the owning session transitions from
`initializing` to `failed` and cannot enter the encounter. A Redis mirror error
after the PostgreSQL commit leaves the session `ready`, so an idempotent retry
can restore the mirror from the saved scenario.

Migration 020 adds `session_identity_binding`, an immutable owner-scoped record
that binds the application session ID, patient-profile ID, provider Conversation
ID, schema version, and canonical scenario fingerprint. Setup retries insert
the record idempotently and compare every value before returning success. The
identity-verification worker checks open bindings against Redis at least every
15 minutes and stores the last check time, last successful verification time,
and result. A missing or unavailable Redis state remains distinguishable from
a verified identity and is recoverable from PostgreSQL when the learner resumes
the encounter.

Active tenant memberships carry one of `learner`, `instructor`, or
`customer_admin`. Migration 006 defaults existing memberships to `learner`;
the current encounter endpoints authorize only that role. Instructor and
customer-administrator workflows are not exposed yet, and privileged roles
must be assigned explicitly by the database owner.

Optional monthly per-user session and response quotas and per-session response
quotas are configured on `tenant_entitlements`; `NULL` leaves that dimension
unlimited. Reservations for tenant, user, and encounter dimensions commit or
roll back together. The generic Responses endpoint has user and tenant limits;
patient turns additionally reserve the owning encounter's response budget.

Cross-browser STT uses an authenticated `POST /api/sessions/:id/audio-transcription`
to mint an OpenAI Realtime transcription client secret. The long-lived API key
stays on the server; the browser receives only a short-lived client secret.
Tenant owners must explicitly set `audio_transcription_enabled` and
`audio_transcription_privacy_approved` after reviewing the user-facing consent
text. `monthly_audio_transcription_session_quota` must be set to a finite value
before audio can be used; `NULL` leaves the audio grant gate closed, and zero
disables use. Each grant records the consent version,
timestamp, and provider session ID. Learners must accept the visit-level consent
before a grant is issued. Raw microphone audio is not stored by GPTMD. Current
voice sessions stop at 15 minutes in the browser; this client-side cutoff is a
product safeguard, not a server-observed audio-duration meter. Realtime billing
and provider-side retention remain subject to the configured OpenAI project
terms and settings.

Accepted-turn events include a learner input modality (`typed` or
`realtime_transcription`) and remain the durable source for the
`session_transcript` view. The modality comes from the client request and is
not provider-attested. The view projects one learner utterance and one patient
text response per accepted turn; both use the accepted-turn timestamp. Local
voice repair/stop phrases and actual browser speech-synthesis playback are not
currently recorded.

Patient setup uses a bounded in-process queue. `API_SETUP_MAX_CONCURRENT`
(default `2`, range `1`–`16`) sets active generation slots;
`API_SETUP_MAX_QUEUED` (default `4`, range `0`–`100`) sets waiting requests;
`API_SETUP_QUEUE_TIMEOUT_MS` (default `15000`, range `1000`–`120000`) limits
how long a queued request waits for a slot. A full queue or expired wait
returns `503` with `Retry-After: 1`; retry with the same `Idempotency-Key`.
The API does not invoke scenario generation for a rejected or expired queued
request. The session remains `initializing` so the same idempotent setup request
can be retried. These limits are per API process and currently assume one API
replica; they are not a distributed queue. Active generation is additionally
bounded by the OpenAI client request timeout/retry settings and the scenario
generator's single validation retry.

OpenAI Responses work uses a separate in-process capacity scheduler with four
active provider slots and two slots reserved for learner-facing interactive
requests. Scenario setup may use at most two slots; interactive requests may
use any free slot and are started before waiting setup work. The interactive
lane holds at most eight waiting requests for five seconds; the setup lane
holds at most two provider waits for fifteen seconds. Full or expired waits
return `503` with `Retry-After: 1` before patient-turn quota or state work begins.
These limits protect turn admission from setup load on one API process; they do
not coordinate across replicas or establish a provider-wide account rate limit.

## Request rate limits

Every `/api` request consumes one shared Redis fixed-window counter keyed by a
hash of the client IP. The default window is 60 seconds with a limit of 1,200
requests per IP. After bearer authentication succeeds, the request also
consumes a second shared counter keyed by a hash of the tenant and subject,
limited to 300 requests per identity in the same window. Configure these
limits with `API_RATE_LIMIT_WINDOW_SECONDS`, `API_RATE_LIMIT_PER_IP`, and
`API_RATE_LIMIT_PER_IDENTITY`. Redis updates each counter atomically and
expires it at the end of the window; raw IP addresses and identity values are
not used as Redis keys.

An exceeded limit returns `429` with a generic JSON error and `Retry-After`
seconds until the counter expires. If the shared limiter is missing or Redis
cannot update a counter, `/api` returns `503` before authentication-dependent
or route work. `/healthz` and `/readyz` are outside these request limits.
Ingress rate limits remain a separate deployment control; forwarded client IP
is trustworthy only when the configured proxy chain matches Express's
one-hop `trust proxy` setting.

Encounter mutation responses expose `redis_turn_state_event_commit`,
`redis_phase_state_event_commit`, `redis_assessment_state_event_commit`, and
`redis_terminal_state_event_commit` in `Server-Timing`. Each value measures the
full Redis `EVAL` round trip that commits encounter state together with its
event, not the event append in isolation. The timings are transient response
measurements; they are not aggregated or persisted, so use request telemetry to
evaluate the 5 ms handoff target.

## Redis live state and PostgreSQL history

Run the session-history and audio-expiry workers next to the API:

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

The same worker process claims due audio transcription calls from PostgreSQL,
hangs each provider call up at its persisted 15-minute deadline, and marks the
call ended. It retries failed hangups with bounded exponential delays and
reclaims claims older than one minute after a worker restart. Provider calls
are created through the API, so the browser receives only the SDP answer; the
ephemeral credential and provider call identifier stay server-side. Keep at
least one worker process running anywhere audio transcription is enabled. The
local `npm run dev` launcher starts it automatically.

The same worker retries cleanup of rejected scenario Conversations. GPTMD
deletes and verifies every Conversation item before deleting the Conversation,
because deleting a Conversation alone leaves its items at OpenAI. Failed
cleanup IDs are stored without profile text and retried with bounded
exponential delays.

The worker emits a structured `session_event_worker_metrics` log every 30
seconds with consumer-group pending and undelivered counts, their combined
backlog, the age of the oldest pending Redis entry, and the maximum event-time
to-PostgreSQL-commit delay observed in the interval. The record contains no
session IDs or patient content. These are live operational logs, not durable
historical aggregates; a metrics inspection failure does not interrupt event
commit or acknowledgement.

The local Redis Stack is configured with AOF enabled and `appendfsync
everysec`, so a sudden Redis failure can lose up to roughly one second of
recent writes. Redis replays its AOF on restart. If an owned session's JSON is
missing, `GET /api/sessions/:sessionId` rebuilds it from the immutable
PostgreSQL scenario and committed session events, including saved retry replies.
Events that Redis lost before the worker committed them to PostgreSQL are
within the documented one-second loss window. The local recovery verifier
exercises the complete PostgreSQL session identity binding (owner, app session,
patient profile, provider Conversation, schema version, and canonical scenario
fingerprint), runs the periodic identity verifier against Redis live state, and
retries setup with the same idempotency key. It then resumes the owner-scoped
current encounter, deletes the test session's Redis live/profile/retry/owner
index keys, and verifies that resume reconstructs the same identity from
PostgreSQL. It also covers Redis turn retries, worker commit/ack ordering,
terminal outcomes, and reconstruction after deleting the test session's Redis
JSON:

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

An accepted turn atomically updates the Redis JSON state and retry reply, then
appends the accepted turn plus one disclosure event per disclosed history fact
to `gptmd:session-events`. Disclosure event IDs are deterministic from the
turn, field, and fact, and their ordinal preserves order within that turn. The
worker persists both event types to PostgreSQL asynchronously and acknowledges
only after commit; the learner response does not wait for worker completion.
The accepted event remains a complete replay snapshot with transcript text,
patient-reported fact expansions, history coverage, disclosed fact IDs, and any
clinical actions. This route currently implements the text history path;
orders, exams, assessment submission, phase changes, and modality transitions
remain later phase work.

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
