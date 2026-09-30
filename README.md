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

Start local PostgreSQL and the API in separate terminals:

```sh
npm run db:up
npm run api:dev
```

The API expects the local Redis Stack service at the `REDIS_URL` endpoint. Start
the Nuxt frontend in another terminal with `npm run dev`. The API listens only
on `127.0.0.1:4000` by default.

The project-local MCP configuration is in `.codex/config.toml`. Its launcher
reads the ignored `.env` file and passes only Redis credentials to Redis MCP
and the dedicated read-only database connection to PostgreSQL MCP.

Run the repository's complete validation suite with:

```sh
npm run check
```

See [the API service README](services/api/README.md) and
[npm scripts guide](docs/npm-scripts.md) for details.
