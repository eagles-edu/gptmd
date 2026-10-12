# GPTMD

GPTMD is a Nuxt encounter application with a separate, loopback-only Express
API service.

## Local setup

Install the repository dependencies and prepare the ignored local environment
file:

```sh
npm install
test -e .env || cp .env.example .env
chmod 600 .env
```

Fill in local credentials in `.env`. The API process receives only the OpenAI,
Redis, PostgreSQL, host, and port settings it needs. Keep `.env` out of Git.

Start the local development stack with one command:

```sh
npm run dev
```

This starts Nuxt, the Express API, the session-history/audio-expiry worker,
PostgreSQL, and a dedicated Redis Stack. Published ports bind to loopback:
Nuxt at `127.0.0.1:3000`, API at `127.0.0.1:4000`, PostgreSQL at
`127.0.0.1:5432`, and the Compose Redis at `127.0.0.1:6381`. The Redis service
uses the password from `REDIS_URL` but has its own container and persistent
volume; it does not connect to or replace a separately running Redis service.
PostgreSQL and Redis attach only to an internal Compose data network;
the API and worker also join the outbound app network, while Nuxt joins only
the app network. Their published database ports remain bound to loopback for
local host tools and are not intended as production exposure.
On API shutdown, new requests receive a 503 with connection close, in-flight
requests get up to 25 seconds to finish, then remaining HTTP sockets are closed
before Redis, PostgreSQL, and provider clients. Compose and the API systemd
template allow 30 seconds for this shutdown.
The default `ops` Compose project reuses the existing local PostgreSQL volume.
Set `GPTMD_DEV_WEB_PORT`, `GPTMD_DEV_API_PORT`, `GPTMD_DEV_POSTGRES_PORT`, or
`GPTMD_DEV_REDIS_PORT` before starting if one of those host ports is occupied.

Apply the API migrations from [the API service README](services/api/README.md)
when setting up a database for the first time. The API reports ready only after
the required schema is present, and Compose holds the background worker until
that readiness gate passes. For a new database, apply the migrations from a
second terminal while `npm run dev` is running. Press Ctrl+C to stop the Compose
services, or run `npm run dev:down` from another terminal. Database and Redis
volumes remain available for the next session.
The containers use the source and dependencies baked by the Compose build; run
`npm run dev` again after source changes to rebuild and restart them.

For host-run development with Nuxt/API hot reload and the Redis service named by
`REDIS_URL`, run `npm run dev:host`. To start only the frontend, run
`npm run dev:web`. PostgreSQL and API can also be started separately with
`npm run db:up` and `npm run api:dev`.

## Build production application images

`ops/Dockerfile.production` has separate `web` and `api` runtime targets. Both
use the same digest-pinned official Node 24 base, install from their lockfiles,
and run as the unprivileged `node` user. Build each image with a unique release
tag; do not reuse a moving tag such as `latest`:

```sh
docker build --file ops/Dockerfile.production --target web --tag gptmd-web:<release-id> .
docker build --file ops/Dockerfile.production --target api --tag gptmd-api:<release-id> .
```

These commands build local images only. They do not publish, deploy, configure
TLS ingress, or start production data services. The API image's worker can be
started with `node dist/worker.js` when a deployment topology is defined.

The project-local MCP configuration is in `.codex/config.toml`. Its launcher
reads the ignored `.env` file and passes only Redis credentials to Redis MCP
and the dedicated read-only database connection to PostgreSQL MCP.

Run the repository's complete validation suite with:

```sh
npm run check
```

The encounter preflight E2E suite includes desktop Chromium, Firefox, and
WebKit plus an iPhone 13 device-profile run on Playwright WebKit. The phone
profile checks mobile layout and browser behavior; it is not a physical iPhone
or Apple Safari. Playwright's WebKit build is distinct from branded Safari.
For the main E2E suite in Opera desktop, install Opera and run
`OPERA_EXECUTABLE_PATH=/path/to/opera npm run test:e2e:opera` (the path may be
omitted when Opera is at `/usr/bin/opera`).

Third-party iOS browsers generally use Apple's WebKit engine, although Apple
allows eligible, approved browser apps to use alternative engines in the EU
under specific entitlements and OS requirements. A Playwright iPhone profile
cannot establish behavior on a real iOS browser or device. See [Apple's
alternative-engine policy](https://developer.apple.com/support/alternative-browser-engines/)
and [Playwright's WebKit notes](https://playwright.dev/docs/browsers).

See [the API service README](services/api/README.md) and
[npm scripts guide](docs/npm-scripts.md) for details.
