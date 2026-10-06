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

See [the API service README](services/api/README.md) and
[npm scripts guide](docs/npm-scripts.md) for details.
