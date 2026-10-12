# npm scripts

Run these commands from the repository root. `npm run` prints the scripts that
are currently available in `package.json`.

## Development and serving

| Command | What it does |
| --- | --- |
| `npm run dev` | Builds and starts Nuxt, the Express API, the background worker, PostgreSQL, and an authenticated Redis Stack in Docker Compose. Host ports bind to loopback; the PostgreSQL data volume is shared with the existing `ops` project. Stop the stack with `Ctrl+C`; PostgreSQL and Redis volumes remain. |
| `npm run dev:down` | Stops the local Compose services without removing PostgreSQL or Redis data volumes. |
| `npm run dev:compose:config` | Validates the full local development Compose configuration without starting or changing containers. |
| `npm run dev:host` | Starts PostgreSQL, then the Express API, worker, and Nuxt on the host. Uses the Redis service configured by `REDIS_URL`; stop the host processes with `Ctrl+C`. |
| `npm run dev:web` | Starts only the Nuxt frontend development server with hot reload. |
| `npm run api:dev` | Starts the Express API from TypeScript; the API launcher loads only service-specific values from the ignored `.env` file and restarts on source changes. |
| `npm run build` | Builds the Nuxt frontend for production. |
| `npm run api:build` | Compiles the Express API TypeScript project into `services/api/dist/`. |
| `npm run preview` | Serves the most recent Nuxt production build locally. Run `npm run build` first. |
| `npm run api:start` | Starts the compiled Express API from `services/api/dist/server.js`. Run `npm run api:build` first. |
| `npm run db:up` | Starts the local PostgreSQL container and preserves its named volume across restarts. |
| `npm run db:down` | Stops the local PostgreSQL container without deleting its volume. |
| `npm run generate` | Runs Nuxt's static generation and writes prerendered output for static hosting. |

For local full-stack development, use one terminal in the repository root:

```sh
npm run dev
```

The command requires Docker and the ignored `.env` file. Compose runs its own
Redis Stack on loopback port 6381 using the password from `REDIS_URL`; the
separately configured Redis service is not touched. By default, Compose uses
project name `ops` and reuses the existing PostgreSQL data volume. Set
`COMPOSE_PROJECT_NAME` to isolate the Compose resources, or override
`GPTMD_DEV_WEB_PORT`, `GPTMD_DEV_API_PORT`, `GPTMD_DEV_POSTGRES_PORT`, and
`GPTMD_DEV_REDIS_PORT` when host ports are occupied. API schema migrations are
not applied automatically; on a fresh database, run the migration commands in
the [API README](../services/api/README.md) from a second terminal while the
Compose stack is running. The API readiness gate checks the required schema,
and Compose holds the worker until the API is healthy. The containers rebuild
from the current source each time `npm run dev` starts;
`npm run dev:host` and `npm run dev:web` remain available for host hot reload.

## Quality checks

| Command | What it does |
| --- | --- |
| `npm run lint` | Runs ESLint across the repository. |
| `npm run lint:styles` | Runs Stylelint over CSS, SCSS, and Vue files. |
| `npm run test` | Runs the Vitest suite once. |
| `npm run test:watch` | Starts Vitest in watch mode for interactive development. |
| `npm run test:e2e` | Runs the Playwright end-to-end test suite. |
| `npm run test:e2e:mobileviewer` | Checks responsive layout and primary navigation at MobileViewer device viewport sizes in Chromium. |
| `npm run test:e2e:mobileviewer-tool` | Opens the hosted MobileViewer, loads a target URL in its iframe, and checks a phone preset plus landscape rotation. Override the default public fixture with `GPTMD_MOBILEVIEWER_TARGET_URL` and `GPTMD_MOBILEVIEWER_EXPECTED_TEXT`. This hosted smoke test is part of `npm run test:e2e` and `npm run check`, so those commands need network access to MobileViewer and the target page. See the [mobile device review guide](mobile-device-testing.md) for its limits. |
| `npm run test:e2e:iphone-webkit` | Runs encounter preflight in Playwright WebKit with an iPhone 13 viewport, touch, and user-agent profile. This is emulation, not physical iOS Safari. |
| `npm run test:e2e:opera` | Runs the main and encounter-preflight E2E suites in installed Opera; set `OPERA_EXECUTABLE_PATH` if the executable is not `/usr/bin/opera`. |
| `npm run verify:live-session-loop -- --run-live` | Makes billable OpenAI scenario-setup and first-turn requests through real Express using a disposable PostgreSQL database and an empty non-default Redis database; prints privacy-safe checks, deletes the successful and any failed-attempt provider Conversations, and cleans up test data. If provider deletion fails, it preserves the temporary database with a retry record. Requires loopback storage URLs and the existing `.env` OpenAI key. |
| `npm run verify:live-realtime-transcription` | Extends the live session-loop verifier with one short synthetic speech sample played through Chromium WebRTC, the authenticated audio-transcription route, provider-duration persistence, and a patient turn submitted as `realtime_transcription`. Makes billable OpenAI audio and patient-response requests; requires `espeak`, installed Playwright Chromium, loopback storage, and the existing `.env` OpenAI key. It is opt-in and is not part of `npm run check`. |
| `npm run validate:html` | Runs `html-validate` on Vue components under `app/`. |

## Git update helper

| Command | What it does |
| --- | --- |
| `npm run git:update` | Prefills the editable commit-message prompt with the next `gptMD-dev_` version based on commit subjects (Enter accepts it), then runs `git add .`, commits, and pushes. Use only when ready to stage all non-ignored workspace changes and publish the commit to the configured remote. |
| `npm run git:update -- --dry-run` | Prints the suggested next commit message without prompting or changing Git state. |

The version helper increments the final numeric field through `99`, then rolls
it to `00` and advances the preceding field. If no matching prior commit subject
exists, its initial suggestion is `gptMD-dev_0.0.0.01`.

## Install lifecycle

| Script | When it runs | What it does |
| --- | --- | --- |
| `postinstall` (`nuxt prepare`) | Automatically after npm installs dependencies. | Prepares Nuxt's generated types and project files. You normally do not need to run it directly. |

The API's `build`, `dev`, and `start` commands are also defined in
[`services/api/package.json`](../services/api/package.json); the root scripts
`api:build`, `api:dev`, and `api:start` delegate to those service commands.
The local API reads Redis and PostgreSQL connection settings from `.env`;
project MCP servers load only their own required credentials through
`scripts/gptmd-mcp-launcher.mjs`.
