# npm scripts

Run these commands from the repository root. `npm run` prints the scripts that
are currently available in `package.json`.

## Development and serving

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the Nuxt frontend development server with hot reload. By default, Nuxt prints the local URL in the terminal (usually `http://localhost:3000`). Stop it with `Ctrl+C`. |
| `npm run api:dev` | Starts the Express API from TypeScript; the API launcher loads only service-specific values from the ignored `.env` file and restarts on source changes. Run it separately from Nuxt. |
| `npm run build` | Builds the Nuxt frontend for production. |
| `npm run api:build` | Compiles the Express API TypeScript project into `services/api/dist/`. |
| `npm run preview` | Serves the most recent Nuxt production build locally. Run `npm run build` first. |
| `npm run api:start` | Starts the compiled Express API from `services/api/dist/server.js`. Run `npm run api:build` first. |
| `npm run db:up` | Starts the local PostgreSQL container and preserves its named volume across restarts. |
| `npm run db:down` | Stops the local PostgreSQL container without deleting its volume. |
| `npm run generate` | Runs Nuxt's static generation and writes prerendered output for static hosting. |

For local full-stack development, open two terminals in the repository root:

```sh
npm run dev
npm run api:dev
```

The frontend's configured API base defaults to `http://127.0.0.1:4000` and can
be changed with `NUXT_PUBLIC_API_BASE`.

## Quality checks

| Command | What it does |
| --- | --- |
| `npm run lint` | Runs ESLint across the repository. |
| `npm run lint:styles` | Runs Stylelint over CSS, SCSS, and Vue files. |
| `npm run test` | Runs the Vitest suite once. |
| `npm run test:watch` | Starts Vitest in watch mode for interactive development. |
| `npm run test:e2e` | Runs the Playwright end-to-end test suite. |
| `npm run validate:html` | Runs `html-validate` on Vue components under `app/`. |

## Git update helper

| Command | What it does |
| --- | --- |
| `npm run git:update` | Interactively suggests the next `gptMD-dev_` version based on commit subjects, prompts for a commit message (Enter accepts the suggestion), then runs `git add .`, commits, and pushes. Use only when ready to stage all non-ignored workspace changes and publish the commit to the configured remote. |
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
