# gptmd API service

This is the separate Express service boundary for the project. It is
TypeScript-built and deliberately starts with only operational endpoints:

- `GET /healthz` — process health
- `GET /readyz` — Redis, PostgreSQL, and OpenAI configuration readiness
- `POST /api/openai/responses` — server-side OpenAI Responses API integration

The private patient-scenario generator in `src/patient-profile.ts` creates a
Responses Conversation, requests a strict structured profile, validates it,
and retries once in a fresh Conversation when validation fails. Its canonical
field catalog is checked against `docs/pp.md`; the exported JSON Schema is in
`docs/schemas/patient-scenario-profile.schema.json`. This module is not an HTTP
route and does not yet activate or persist sessions. Keep its full profile
server-side; the learner-facing profile is a separate contract.

The service defaults to `HOST=127.0.0.1` and `PORT=4000`. It refuses a
non-loopback `HOST` so it cannot accidentally become a public listener. The
API launcher reads the ignored repository `.env` file and passes only the
service's OpenAI, Redis, PostgreSQL, host, and port variables to the process.

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

No domain API routes, authentication scheme, Redis writes, public listener, or
deployment automation is defined yet.
