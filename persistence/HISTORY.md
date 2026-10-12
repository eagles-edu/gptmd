# Architectural and operational decisions

## 2026-09-23 — Codex-primary local curation boundary

**Decision:** Use Hermes profile `gptmd-coding` with the Codex app-server runtime
as the implementation lane, and CuratorMD as a local, reviewable persistence
layer. Canonical durable knowledge is limited to the four files in this
directory; native-projection records are temporary inbox input.

**Rationale:** Codex owns workspace edits and tests, while Hermes provides
project-local orchestration, session history, and background review. Keeping
the durable boundary in checked-in Markdown makes authority reviewable and
avoids treating local memory or raw transcripts as project rules.

**Impact:** CuratorMD requires an absolute worktree root, redacts observer
payloads, stores state outside the repository, acquires a project lock, and
never commits or modifies application source.

## 2026-09-25 — Add reusable new-repository enablement skill

**Decision:** Add `enable-hermes-repo` to the gptmd-memory plugin. It codifies absolute worktree validation, contract and persistence review, unique Hermes profile and schedule selection, Codex plugin verification, CuratorMD and OpenAI Docs MCP registration, profile skill installation, observer and cron verification, VS Code profile binding, and final build/status checks.

**Rationale:** The nuxt008 onboarding exposed repeated setup steps and a status-checker path mismatch for repositories that use the installed CuratorMD plugin instead of carrying a local plugin directory.

**Impact:** Future repository onboarding can use one discoverable skill plus the idempotent `enable_repo.py` bootstrap, with reviewable local-only changes and explicit live verification.

## 2026-09-23 — Legacy native capture with unusable test summary

**Decision:** Native `agent:end` capture `5561b902467b4ba1ef3ac50ebbe715a9` (captured 2026-09-23T10:58:52Z) generated the bounded summary “verified [REDACTED]” but exposed no result fields. The original inbox record was retired as test-only input. No project behavior or durable claim can be inferred from this capture.

**Rationale:** Preserve the test artifact's known limits without treating its placeholder summary as evidence of a project result.

**Impact:** No reusable operational conclusion; future curation should leave this kind of payload unpromoted unless a bounded result is available.

## 2026-09-23 — Legacy gptmd-coding live-hook validation

**Decision:** The local `hermes:gptmd-coding:live-hook-test:agent:end` completed successfully on 2026-09-23 using provider `openai-codex` and model `gpt-5.6-luna`. It made no persistent project change. Native record ID: `68b3db3f6a430b8f09e7917a6626ec81`; fingerprint prefix: `a3c7b8f33c1c`.

**Rationale:** Retain the verifiable outcome of the legacy live-hook test in the repository's dated history.

**Impact:** Records a successful local observer hook check only; it does not establish broader app-server event coverage or ongoing observer health.

## 2026-09-26 — CuratorMD review experience and status LED

**Decision:** Reworked each pending review record into three numbered parts: concise metadata and safe payload JSON, an advisory AI proposal with probabilities, and an editable decision block prefilled from the proposal. Approval and rejection actions now use the human-edited decision values. Repaired the VS Code status LED so it targets the configured workspace profile, opens pending review notes when clicked, and refreshes its timer when `curatormdStatus` settings change. The pending-review notice also offers a direct open action.

**Rationale:** The former review document did not clearly distinguish event evidence, the AI recommendation, and the human decision. The status indicator needed a direct route to the review document and to honor polling changes.

**Impact:** Reviewers can compare the unchanged AI proposal with an editable copy and act on the edited values. Pending notes are reachable from the LED and its notification; the proposal remains advisory.
## 2026-09-26 — Consume CuratorMD from its independent repository

**Decision:** Keep GPTMD as the medical-doctor application repository and consume CuratorMD from the sibling `/home/eaglesvn/dockerz/curatormd` system repository. Retain GPTMD's own `gptmd-coding` profile, project marker, inbox, and persistence.

**Rationale:** Shared CuratorMD source and GPTMD project knowledge have separate owners. This prevents application data, runtime profiles, and system implementation from being mixed.

## 2026-09-26 — Structured SDE review and five-stage repair workflow

**Decision:** Adopt a five-stage development procedure for GPTMD work: begin with a concise problem-and-success summary, then troubleshoot, plan remediation, implement, test, and complete with verified results and recovery paths. Add the Hermes `sde-curation` skill and CuratorMD `sde_parse` MCP so the full relevant discussion is synthesized into a factual SDE; automatic cue-only captures are not proposal prose. Scrub secrets only in the synthesis, keep raw threads out of persistence, snapshot target hashes for approvals, retry unchanged prepared transactions automatically, and expose manual recovery for legacy transactions.

**Rationale:** The review error came from an already edited `HISTORY.md` combined with a prepared approval that had no target baseline. The event card also contained vocabulary fragments and generic filler instead of the concrete repair. The new workflow requires cause, plan, implementation, testing, and completion evidence, and preserves user edits during recovery.

**Impact:** The malformed SDE `1fb0c4c6a90341ecabb128940c8faeaa` was corrected to `do-not-record`; revision 1 is superseded and revision 2 is finalized in CuratorMD's private review state. No gibberish was appended to GPTMD history. The CuratorMD suite passed 18 tests and MCP discovery exposed 16 tools. `sde-curation` is installed for Hermes profile `gptmd-coding`. SDE proposals now require one complete beginning/middle/end narrative.

## 2026-09-26 — Resolve CuratorMD imports in the GPTMD editor workspace

**Decision:** Add CuratorMD's sibling scripts directory to GPTMD workspace `python.analysis.extraPaths` and add the reported CuratorMD identifiers to GPTMD's `cSpell.words` list. Keep the implementation and its Pyright configuration in the standalone CuratorMD repository.

**Rationale:** The editor reported unresolved imports for `curation_learning` and `sde_vocabulary` plus spellcheck notices because the CuratorMD source file was open outside the GPTMD workspace root. CuratorMD's own Pyright configuration did not supply import paths to that workspace.

**Impact:** The workspace settings parse and include the expected relative source path and spellcheck entries. Pyright run from GPTMD with the matching import path reports zero diagnostics for `gptmd_memory.py`. The Pylance server should refresh its external-file diagnostics after the workspace settings reload.

## 2026-09-29 — Document GPTMD root npm scripts

**Decision:** Added docs/npm-scripts.md with explanation of each NPM script's function.

**Rationale:** Lets contributors choose the correct client, API, validation, and publishing command without reconstructing behavior from `package.json`.

**Impact:** Expected to improve maintainability and reduce command-use errors. The completeness check passed; this change did not alter runtime behavior.

<!-- curatormd:record_id=2a4a1911870f2031ffb8726292dabb4e;content_sha256=fe4ba33d351eea28a8ca8283440e11569fe3db939176204af7c177ad73eb9be3 -->
<!-- curatormd:fingerprint=8f7ae922cf662fbfa8cb804c89674608885570c79e7f85373ac2477016790476 -->

## 2026-09-29 — Add an NPM interactive Git update command script

**Decision:** ## Added an interactive Git remote update script to package.json

**Rationale:** Gives contributors a confirmed release workflow and a dry-run path for checking the next version before staging or publishing.

**Impact:** Expected to reduce manual version and commit-message mistakes. The commit and push completed successfully; no broader release automation was added.

<!-- curatormd:record_id=450ee673b761764e29788b7615b5a419;content_sha256=dba77a5fdff25ec29e79c17e7f222315f44bf4287e94b0cdccf1b9ee6bba85e5 -->
<!-- curatormd:fingerprint=92b52a01134a2a7fa0e1b9396e0e00b8d610582c17d09d34c6667516f73b1679 -->

## 2026-10-04 — Separate profile catalog from scenario seed examples

**Decision:** ## Separate profile catalog from scenario seed examples

**Beginning — trigger and context:** The 1A inventory needed to distinguish the canonical allowed-field catalog and runtime patient profile contract from concrete fixtures, historical examples, and values that could be mistaken for production seeds.

**Middle — decisions and work:** Audited the current API schema and repository examples. Clarified that the JSON catalog names reason and history fields while `patient-profile.ts` defines the full runtime schema; separated active generation behavior from test fixtures, the legacy Nuxt008 request, and archived examples. Replaced concrete values in the checked-in patient JSON example with explicit placeholders. The runtime profile shape did not change, so schema version 1 required no migration.

**End — outcome and verification:** The task list and companion checklist now describe the sources separately. The placeholder JSON parses and `git diff --check` passed. The application test suite was not run because this thread changed documentation and an illustrative template only.

**Future utility:** Prevents future work from treating a field catalog, fixture, or legacy example as active generation input and keeps illustrative profile values from being mistaken for real patient scenarios.

**Project impact:** Observed: the example contains placeholders and the source inventory is recorded in project documentation. Expected: the distinction reduces accidental use of fabricated example values in runtime behavior.

**Rationale:** Prevents future work from treating a field catalog, fixture, or legacy example as active generation input and keeps illustrative profile values from being mistaken for real patient scenarios.

**Impact:** Observed: the example contains placeholders and the source inventory is recorded in project documentation. Expected: the distinction reduces accidental use of fabricated example values in runtime behavior.

<!-- curatormd:record_id=c454d4b1abb9eb376dba5972b0f8d20c;content_sha256=80ddf7c286be290ba1edec30f9f7610b197ce70ae2e3d365666936a7a34d2869 -->
<!-- curatormd:fingerprint=c652858f314e58e0dadbaa10cb6e04fe83294d1748c44c0d331a9f7533a4b684 -->

## 2026-10-06 — Require the current first-generation patient turn contract

**Decision:** ## Require the current first-generation patient turn contract

**Beginning — trigger and context:** While modernizing the patient encounter checklist, GPTMD connected patient-profile response guidance to question-matched turn generation and added PP section IDs to accepted patient facts. A prior implementation note said older saved turns would remain readable. The user clarified that GPTMD is a refactored first-generation system and explicitly directed that older turn compatibility fallbacks should not be added.

**Middle — decisions and work:** Made the accepted patient turn and its patient-reported fact expansion strict: section, modality, phase, version pins, coverage arrays, and event ordinal must be present in the current contract. Removed defaults that silently filled missing turn arrays, phase, and accepted/terminal event ordinal; removed the duplicate-turn modality fallback to typed; and made patient-state acceptance take phase from the validated turn. Updated generated JSON schemas, checklist/task-plan wording, and regression tests so incomplete records are rejected and malformed stream entries are left pending rather than acknowledged.

**End — outcome and verification:** The focused five-file test selection passed all 59 tests. The full npm run check passed lint, style and HTML validation, type checks, all 135 unit tests, API build, schema and diagram checks, production build, 33 standard Playwright tests, and 15 preflight Playwright tests across Chromium, Firefox, and WebKit. Existing payloads that omit current required fields are intentionally not adapted; no data backfill or destructive cleanup was performed.

**Future utility:** Gives future turn-contract changes a clear first-generation rule: validate the current serialized shape at Redis and PostgreSQL boundaries, and do not add compatibility shims for earlier development records without an explicit product decision.

**Project impact:** Observed: current producers, generated schemas, unit checks, and browser suite pass with required turn fields. Expected: strict parsing prevents incomplete patient disclosures and event metadata from entering the durable history. Older development records missing the new fields will fail validation and remain unacknowledged for repair.

**Rationale:** Gives future turn-contract changes a clear first-generation rule: validate the current serialized shape at Redis and PostgreSQL boundaries, and do not add compatibility shims for earlier development records without an explicit product decision.

**Impact:** Observed: current producers, generated schemas, unit checks, and browser suite pass with required turn fields. Expected: strict parsing prevents incomplete patient disclosures and event metadata from entering the durable history. Older development records missing the new fields will fail validation and remain unacknowledged for repair.

<!-- curatormd:record_id=498fe326fdde3e8e8287cea87042e725;content_sha256=f2a07cb56c718b0cb5e75aaf79971c64cd584f7c7f216fb016b14716db2d40d9 -->
<!-- curatormd:fingerprint=4be923f12c3b6fc97128ba99eb327d43027f6c429177d3871512b48016055b9b -->

## 2026-10-10 — Set the manual OLS site workflow and install acme.sh

**Decision:** ## Set the manual OLS site workflow and install acme.sh

**Beginning — trigger and context:** On 2026-10-07, the user described limitations in iNET.vn OneDash and asked for help creating webroots and configuring OpenLiteSpeed behind Nginx. The existing eaglesvn.club OLS vhost was found disabled by filename: the main config references vhconf.conf while only vhconf.conf.disabled exists. The user chose to work from the VNC console and use the production Nginx hierarchy.

**Middle — decisions and work:** The workflow boundary was set: OneDash-managed Nginx files should be preserved; DNS remains in iNET/OneShield controls; OLS owns virtual hosts and document roots. The proposed provisioning script would create the webroot and OLS configuration, validate before reload, and use /etc/nginx/sites-available with /etc/nginx/sites-enabled for Nginx. The user then requested ACME installation. acme.sh 3.1.6 was installed as root at /root/.acme.sh/acme.sh, and its automatic renewal cron job was verified.

**End — outcome and verification:** The ACME client and renewal schedule were reported installed. No certificate was requested, and Nginx or OLS configuration was not changed by that installation. The eaglesvn.club vhost repair and reusable site provisioning script remain unfinished; the thread left open whether to repair eaglesvn.club first or build a new-domain tool.

**Rationale:** Preserves the verified server change and the chosen ownership boundaries for a later manual migration, while keeping the still-broken OLS vhost and unbuilt provisioning script explicit.

**Future utility:** Future site work can retain OneDash-managed Nginx files, manage DNS at iNET, configure OLS vhosts and roots separately, validate before reload, and use the installed acme.sh client without assuming a certificate or web-server change has already happened.

**Project impact:** Observed: acme.sh 3.1.6 and its automatic renewal cron job were verified. Expected: separating DNS, Nginx, and OLS responsibilities should reduce accidental overwrite risk during manual provisioning. The target site's OLS vhost still requires repair, and no certificate issuance or site provisioning was verified.

**Follow-up:** Repair and validate the eaglesvn.club OLS vhost before using it as a production template; then implement the chosen provisioning workflow and request certificates only after DNS and challenge routing are ready.

**Rationale:** Future site work can retain OneDash-managed Nginx files, manage DNS at iNET, configure OLS vhosts and roots separately, validate before reload, and use the installed acme.sh client without assuming a certificate or web-server change has already happened.

**Impact:** Observed: acme.sh 3.1.6 and its automatic renewal cron job were verified. Expected: separating DNS, Nginx, and OLS responsibilities should reduce accidental overwrite risk during manual provisioning. The target site's OLS vhost still requires repair, and no certificate issuance or site provisioning was verified.

<!-- curatormd:record_id=75b180e28552e0ca91b8b1c8edce39ea;content_sha256=38f1b31fdd6c0612f87d68d4ac769dca54cdaba09fec8e29e95f1249fb39a4d6 -->
<!-- curatormd:fingerprint=9a458020f121e7bd0d381454e25db3f396fe45212a0a895754759a2b553ffc04 -->

## 2026-10-10 — Isolate local Compose data services

**Beginning — trigger and context:** The delivery checklist completed local startup but left the Postgres/Redis network boundary open. All services shared Compose's default network, allowing Nuxt to resolve the data-service names.

**Middle — decisions and work:** Added an internal `gptmd-data` network for PostgreSQL and Redis. API and worker attach to both that network and the outbound app network; Nuxt attaches only to the app network. The resolved Compose configuration is validated by `npm run dev:compose:config`, and unit coverage rejects public-network data stores or a web-to-data connection. Host database ports remain loopback-published for local tools. Production exposure remains deferred until ingress is selected.

**End — outcome and verification:** The Compose config validator and seven focused tests passed. An isolated project started PostgreSQL and Redis as healthy containers on a network reported `Internal=true`; both containers were stopped and only the two volumes labelled for that disposable project were removed. Existing `ops-postgres-1` and `redis-stack` remained running with their original start times. No application database, production ingress, or archive-retention policy was changed.

**Future utility:** Preserves database isolation in local development while allowing API/worker provider egress and web/API app traffic. The same separation should be retained when a production Compose topology is designed.

## 2026-10-10 — Build pinned non-root production images

**Beginning — trigger and context:** The delivery checklist had a development Dockerfile only. Nuxt and Express needed separate production artifacts without bundling local credentials or development tooling into their runtime images.

**Middle — decisions and work:** Added `ops/Dockerfile.production` with separate web and API targets. Each build installs from its lockfile using the official Node 24 multi-platform image pinned by digest. The web runtime contains Nuxt's generated `.output`; the API runtime contains compiled `dist` plus production-only dependencies. Both run under the unprivileged `node` user. The API target also supports the history worker entry point. Documentation requires unique release tags and states that build commands do not publish or deploy images.

**End — outcome and verification:** Both production targets built successfully from the current worktree. The Nuxt build completed without warnings; the API TypeScript build passed. Image inspection showed user `node` and distinct content-addressed image IDs. The web container returned HTTP 200 and rendered its home-page heading. Its temporary container was removed; the two local verification images remain available. No deployment, database migration, registry push, or production exposure change was made.

**Future utility:** Establishes a reproducible production image boundary for later deployment work while keeping host, secret injection, database, registry, and TLS choices separate.

## 2026-10-10 — Drain API requests before closing clients

**Beginning — trigger and context:** The API exposed health and readiness routes, but SIGTERM stopped the process with an unbounded `server.close()` wait. It did not reject new work on existing keep-alive connections, and its `finally(process.exit(0))` reported success even if client cleanup failed.

**Middle — decisions and work:** Added a drain gate that returns `503` and `Connection: close` for requests received after shutdown starts. The API now stops accepting requests, waits up to 25 seconds for in-flight HTTP work, closes remaining sockets at the deadline, then closes provider observers and storage clients. Repeated termination signals force-close sockets. The development Compose service and systemd unit allow 30 seconds for cleanup.

**End — outcome and verification:** Shutdown unit tests cover successful draining, rejection of new work, and deadline force-close; API TypeScript build passed. The full `npm run check` passed: 238 unit tests, API build, schema and diagram checks, production build, 33 standard browser tests, 40 preflight tests, 10 viewport tests, and one hosted MobileViewer test. Compose config validation and `git diff --check` passed. No running systemd unit or public ingress was changed.

**Future utility:** Gives the API a bounded stop sequence for local Compose and future ingress deployments, with explicit behavior for in-flight requests and process cleanup errors.

## 2026-10-10 — Trust forwarded client addresses only from configured proxies

**Decision:** Express no longer trusts a fixed one-hop proxy chain. The API defaults to trusting no forwarded address and accepts an explicit, validated `API_TRUSTED_PROXY_ADDRESSES` list of proxy peer IPs/CIDRs.

**Rationale:** A fixed hop count can let a direct caller influence `request.ip` by supplying `X-Forwarded-For`. Rate limits must derive a forwarded client address only when the immediate peer is an operator-configured proxy.

**Impact:** Focused tests prove untrusted forwarded headers do not change the per-IP Redis limiter key, and reject wildcard/default-route trust configurations. The release checklist remains open until the production ingress peers and its forwarded-header sanitization are configured and verified.

## 2026-10-10 — Add an opt-in live transcription verifier

**Beginning — trigger and context:** The Realtime audio path was covered by mocked browser events, but those tests could not prove that a real provider call accepted browser WebRTC audio or that provider duration reached PostgreSQL.

**Middle — decisions and work:** Added `npm run verify:live-realtime-transcription`, which extends the disposable live session verifier with a generated speech WAV played through Chromium WebRTC, the authenticated Express audio route, a finalized transcript submitted through the regular patient-turn route, and a check for persisted provider-reported audio duration. The command is explicitly opt-in because it makes billable setup and response requests. The Realtime session setup omits a fixed audio format for WebRTC; the browser negotiates media format through SDP. Failure output is bounded and redacts credentials; raw audio, SDP, and transcript text are not logged.

**End — outcome and verification:** The script compiles, focused API integration tests pass, and all created provider Conversations were deleted after live attempts. The OpenAI client secret was created, but `POST /v1/realtime/calls` returned HTTP 500 before a call ID was returned, so no provider audio call, live transcript, duration event, or voice patient turn was verified. The checklist keeps `i07` open pending provider-call success and physical-microphone testing. `npm run verify:live-realtime-transcription` is not included in `npm run check`.

## 2026-10-13 — Isolate the live test domain OAuth and OneShield blockers

**Decision:** ## Isolate the live test domain OAuth and OneShield blockers

**Beginning — trigger and context:** The user stood up obgyn.eaglesvn.club as a live GPTMD test home and asked for a free-file-sync deployment path, then reported public HTTPS 403 responses at the site root and Google authorization endpoint. They asked to check the OneShield WAF logs, verify the browser sign-in route, and stop repeating an unsuccessful sign-in dance.

**Middle — decisions and work:** Repository guidance and the existing authenticated browser session were reviewed. The OneShield portal was opened in the already signed-in Chrome profile at the parent-domain WAF page; this method avoids starting a second remote profile or asking the user to sign in again. Public auth probes remained 403 even with ModSecurity temporarily disabled, so it was restored and no broad security bypass was left in place. With user approval, an iNET support request was sent using only the trace ID, host, path, and time. Google then returned redirect_uri_mismatch: the configured client had been last confirmed with https://obgyn.eaglesvn.club as its JavaScript origin and /auth/v1/callback2 as redirect, while the active GoTrue service sends /auth/v1/callback. iNET replied that the wildcard DNS record alone was insufficient and asked for an explicit www.obgyn host record before enabling protection and retesting.

**End — outcome and verification:** The live OAuth flow is not yet verified. The external blockers are an exact Google OAuth redirect URI mismatch and iNET's requested explicit host record/WAF recheck. No change to DNS, Google Cloud OAuth registration, or production security policy was made in this thread; OneShield support correlation is pending. The checklist was later updated to record these facts and keep a03 open.

**Rationale:** This unresolved live-test path combines two distinct failure layers. Future work needs the verified browser session and exact provider callback evidence to distinguish edge filtering from Google client configuration, while preserving the user's request for granular security controls.

**Future utility:** Use this handoff to resume the live test domain investigation from its verified state, reuse the authenticated Chrome session, correlate support by the recorded trace without resending secrets, and check DNS host coverage and Google callback registration independently.

**Project impact:** Observed: the app reached Google's OAuth error page once the authorize request passed the edge, proving a separate redirect URI mismatch; earlier public requests were rejected with 403. Expected: preserving the authenticated-browser method, exact trace, and separation between edge rejection and provider configuration should prevent repeated login attempts and unsafe blanket WAF changes.

**Follow-up:** Recheck the live DNS record and OneShield support status, then update the Google OAuth Web client so its registered redirect URI exactly matches the active Supabase GoTrue callback. Retest from the authenticated browser and update the a03 checklist only after interactive Google return and an established app session are observed.

**Rationale:** Use this handoff to resume the live test domain investigation from its verified state, reuse the authenticated Chrome session, correlate support by the recorded trace without resending secrets, and check DNS host coverage and Google callback registration independently.

**Impact:** Observed: the app reached Google's OAuth error page once the authorize request passed the edge, proving a separate redirect URI mismatch; earlier public requests were rejected with 403. Expected: preserving the authenticated-browser method, exact trace, and separation between edge rejection and provider configuration should prevent repeated login attempts and unsafe blanket WAF changes.

<!-- curatormd:record_id=6e8696bbb24c6b3c0b64f2187733504f;content_sha256=8d09e138c204e4a23803495ce65dd26387f6b273d9915b62f87fda4a19668055 -->
<!-- curatormd:fingerprint=46e185d59e198316bd888528b07de328b2531d9716adaaa7a4ec62c4dbe681ea -->
