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

This starts PostgreSQL, the API, its session-history/audio-expiry worker, and the Nuxt frontend. The API listens only on
`127.0.0.1:4000` by default, and Nuxt uses its available local development
port. Keep the Redis Stack service configured by `REDIS_URL` running separately;
this repository does not manage that existing service. Apply the API migrations
from [the API service README](services/api/README.md) when setting up a database
for the first time. Press Ctrl+C to stop the API, worker, and Nuxt processes;
PostgreSQL continues running for the next development session.

To start only the frontend, run `npm run dev:web`. PostgreSQL and API can also
be started separately with `npm run db:up` and `npm run api:dev`.

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
