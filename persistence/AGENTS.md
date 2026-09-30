# Active project rules

- Treat this file and the other three files in `persistence/` as the project knowledge contract.
- Begin each development task with a concise summary and success criteria, then complete the five stages in order: troubleshooting, remediation plan, implementation, testing, completion.
- Keep durable knowledge concise, verified, and actionable. Put historical explanation in `HISTORY.md`.
- Use the OpenAI developer documentation MCP server for OpenAI product, API, plugin, or Codex questions.
- Never record credentials, tokens, private keys, connection strings, personal data, or raw transcripts.
- Keep `.curatormd/native-inbox/` temporary and redacted. It is not canonical knowledge and must not be committed.
- Use an absolute project root when calling CuratorMD. It must resolve to this Git worktree root and contain `persistence/`.
- Every bug fix requires a regression test that fails for the original defect and passes for the repair. Cover behavior and the diagnostic or boundary that exposed it; do not settle for smoke tests.
- Run `npm run check` after application changes. It runs lint, style and HTML validation, Vue-aware type checking, unit and browser tests, API compilation, and a warning-free production build.
- Keep the Express API as a separate service under `services/api/`; do not merge its runtime into Nuxt without an explicit architecture decision.
- Leave curation changes uncommitted for human review. CuratorMD must never add, commit, push, deploy, migrate, or delete project data.
- When an operation errors, analyze the cause and continue with safe repair and verification; if blocked, report the cause, a concrete repair plan, and manual and automatic healing paths.
- For SDE curation, inspect the full relevant thread and preserve substantive project meaning. Scrub secrets only; never promote cue-word fragments or generic filler, and never persist raw prompts, responses, tool arguments, or full transcripts.
- Shape one complete SDE proposal as beginning (trigger and context), middle (decisions and work), and end (outcome and verification); keep all three parts in the same candidate.
- On a failed CuratorMD approval, preserve the prepared transaction and all current persistence edits. Use automatic recovery or the documented manual recovery path; never reset or overwrite a knowledge file to bypass the conflict guard.
- Keep Hermes local-only: the dashboard binds to `127.0.0.1:9119`, and no public firewall rule is required.

- ## Build the Nuxt encounter frontend

**Beginning — trigger and context:** The modernization work needed a working GPTMD client shell rather than a blank Nuxt starter, while keeping the Express API as a separate service and carrying forward the useful encounter workflow.

**Middle — decisions and work:** The client was organized as a Nuxt 4 encounter application with a shared layout, header and footer, patient encounter screen, patient imagery and font assets, and About, Commands, Help, and Tutorial pages. Session, setup, and turn data use typed runtime-checked contracts. The encounter route is client-rendered while the public information pages are prerendered. Unused legacy content components were removed, including one that rendered raw HTML. The theme work added light and dark Vuetify palettes, a header toggle, cookie-backed preference state, and theme-aware interface colors.

**End — outcome and verification:** At the end of the implementation thread, production build, lint, style lint, and Playwright checks for theme switching, cookie persistence, desktop and mobile rendering, and browser errors were reported passing. A local preview returned HTTP 200. The saved preference is applied client-side on prerendered pages, so those pages can initially render in light mode. The later build warning repair moved the four imported font files into app assets and disabled Nuxt debug instrumentation; `npm run build` then passed without the unresolved-font or duplicate Vuetify timing warnings.

**Rationale:** Describe implemented UI behavior separately from the design-only patient and encounter model.

**Future utility:** Provides the current frontend structure, route-rendering split, contract boundary, and theme behavior for future GPTMD UI and API integration work.

**Project impact:** The verified client shell and automated theme checks improve the basis for interface changes. Backend integration and clinical validation remain separate work; no clinical outcome was tested.
  - **Why:** Provides the current frontend structure, route-rendering split, contract boundary, and theme behavior for future GPTMD UI and API integration work.

<!-- curatormd:record_id=756501e8efef5502fd2c1fbc78312e91;content_sha256=64673915a009cc78bc19510083c43bceb2eec1a1b540a54fe41e8b84614a430d -->
<!-- curatormd:fingerprint=cd620788fc39cc8a2615e2de0c3db3220a707c1bc3d4edd5c62a21651794daf3 -->

- ## Define GPTMD’s clinical session model

**Beginning — trigger and context:** GPTMD was being rebuilt as a clean-slate medical training application. The legacy repositories offered evidence about existing workflows, but should not constrain the new design. The project needed a coherent account of how patient facts, disclosure, encounter progress, and model context relate.

**Middle — decisions and work:** The modernization plan and system diagrams were revised around an immutable patient canon owned by one authenticated customer session, with encounter state tracked separately through history coverage, disclosures, exams, orders and results, assessment, transcript, and an append-only event ledger. The design distinguishes GPTMD’s database record from optional provider conversation context; it also covers customer and instructor roles, transcript and audio modes, retention controls, scenario-specific history rubrics, natural history-taking, consistent pregnancy outcomes, and bounded unpredictability where compatible details may vary between sessions but stay stable once established. Model tiers are framed as cost and quality choices rather than clinically validated rankings.

**End — outcome and verification:** The historical project account, modernization plan, and system diagrams were updated. The thread reports SVG parsing, outcome-count checks, and documentation whitespace checks passing. This is a design reference; the proposed data model and clinical workflow were not implemented or clinically validated in that work.

**Rationale:** Keep the dated design decisions and their verification limits together; link to the plan and diagrams rather than treating planned behavior as current application behavior.

**Future utility:** Gives future implementation work a shared reference for patient truth, encounter state, disclosure behavior, roles, and scenario consistency.

**Project impact:** Expected to reduce conflicting requirements and contradictory patient/session data during implementation. No clinical or runtime quality improvement was measured because the design remains unimplemented.
  - **Why:** Gives future implementation work a shared reference for patient truth, encounter state, disclosure behavior, roles, and scenario consistency.

<!-- curatormd:record_id=818d99faaee1ab94ad80ddb743eca112;content_sha256=56b8ad7ce4f4a152d98d6947a7a4364bd726fe6aa12b602e627c6dbd165a3af4 -->
<!-- curatormd:fingerprint=fe62491f1a82d9331748062ba2edb74a70aee029483a5a6c91bba5c454f286ef -->

- ## Provision GPTMD API and local data services

**Beginning — trigger and context:** The modernization plan needed a usable local API foundation and project-aligned data tools before patient-session workflows could be built.

**Middle — decisions and work:** Installed the OpenAI, PostgreSQL, and Redis Node clients; added a loopback-only Responses endpoint and a launcher that loads credentials from the ignored mode-0600 `.env`. Registered project-scoped filesystem, Redis, and PostgreSQL MCPs; the PostgreSQL MCP uses a non-superuser read-only role. Created the local PostgreSQL Compose service and connected the API to the existing Redis Stack.

**End — outcome and verification:** Dependency inventory confirmed openai 7.25.0, pg 8.23.0, and Redis Node.js client 6.2.1. PostgreSQL was healthy, Redis returned PONG, and the API `/readyz` reported Redis and PostgreSQL ready and OpenAI configured. No live OpenAI request was made; patient-session routes, Conversations, and application-data writes remain planned.

**Future utility:** This records the reproducible local API/data boundary and credential handling so future work can build patient workflows on verified services without confusing infrastructure readiness with product completion.

**Project impact:** Observed: API readiness succeeded against both local data services with OpenAI configured. Expected: project-scoped MCPs and local services shorten integration work; no patient workflow or provider response quality was tested.
  - **Why:** This records the reproducible local API/data boundary and credential handling so future work can build patient workflows on verified services without confusing infrastructure readiness with product completion.

<!-- curatormd:record_id=accb9e17ad623e7022b4c27260f38906;content_sha256=2535a05682478c1251035895c5faa87009be70648791a82fd173f415fd3e2b3e -->
<!-- curatormd:fingerprint=321cb942943dd7c65db1fe99e01b3369af6b47ff0646ea9f4fba6a4085f1332e -->
