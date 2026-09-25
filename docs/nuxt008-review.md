## What it is

`nuxgpt008` is a Nuxt 3/Vue 3 web app for **GPTpatient: OBGYN**, intended to let clinicians practice medical-English patient conversations. The repo also contains backend services and Docker Compose setup for sessions, simulated-patient setup, speech recognition, and spoken replies.

## Intended request flow

The documented full-stack flow is:

1. The browser app asks the Express service for a session and data ID.
2. Express stores the session records in RedisJSON.
3. The setup backend prepares a patient scenario and conversation state.
4. The frontend sends the clinician’s spoken turn to the conversation backend.
5. That backend generates a reply and streams audio back over Socket.IO; the frontend plays it and resumes listening.

The current services are wired to ports **3000** (frontend), **6970** (sessions), **6960** (setup), **6961/6962** (conversation HTTP/socket), and **6379** (Redis). The local-stack guide is in `FULLSTACK_WORKSPACE.md`.

## Where things live

- `pages/` — Nuxt routes such as the home, about, help, tutorial, and session-test pages.
- `components/` — reusable Vue UI pieces, including the header, footer, and content layouts.
- `layouts/`, `app.vue` — shared page shell, theme transition, and back-to-top button.
- `composables/useSession.ts` — frontend session state, persistence, and calls to Express.
- `services/` — frontend HTTP helpers for the setup backend, speech backend, and Express.
- `stack/express-session-manager/` — Express session API and RedisJSON persistence.
- `stack/setup-backend/` — Python service for preparing the patient/simulation state.
- `stack/ttsstt-backend/` — Python service for conversation turns and speech/audio streaming.
- `docker-compose.fullstack.yml` — starts Redis, RedisInsight, all three backends, and the frontend.

The frontend is configured as a **client-rendered app** (`ssr: false`) and uses Vuetify for UI and themes.

## Important caveat

The repo’s intended product flow is ahead of what the current UI clearly implements: the inspected home, tutorial, help, and about pages contain placeholder text, and `/session-test` is the obvious session-integration test page. Also, `gptpatient-fullstack/` contains a second, similar frontend/backend layout and its own architecture docs; the root package scripts and `docker-compose.fullstack.yml` instead point to the root frontend and `stack/` services. That duplication can make it unclear which copy is authoritative.

To start the root stack, the README’s intended command is:

```bash
cp .env.fullstack.example .env.fullstack
docker compose --env-file .env.fullstack -f docker-compose.fullstack.yml up --build
```

In short: it’s a Nuxt frontend plus a locally orchestrated backend for a voice-based patient-simulation app, but the current root pages look more like an in-progress UI scaffold than a finished conversation experience.