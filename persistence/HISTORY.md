# Architectural and operational decisions

## 2026-10-16 - Deploy tenant-scoped VinMed branding

**Beginning - trigger and context:** The user requested a fictitious corporate
hospital tenant with its own logo and a designated customer administrator. The
worktree was already in progress, so existing changes and the supplied SVG had
to be preserved. Live account provisioning depends on an authenticated
Supabase identity and must not grant platform system-admin privileges.

**Middle - decisions and work:** Added migration 040 for tenant-scoped display
names and same-origin SVG paths, returned branding only with an authenticated
active membership, and changed the selected-workspace header to show that
tenant's logo/name. Added a guarded seed for the isolated `vinmed-hospital-demo`
tenant with a customer-admin membership and disabled default entitlements. The
script checks the live database identity, required migrations, unique active
Auth identity, and absence of an existing tenant. It was not run because the
designated identity was absent. A focused browser test checks the rendered SVG
loads and that unbranded workspace behavior remains covered separately.

**End - outcome and verification:** `npm run check` passed before the final
documentation-only edits; the additional VinMed header browser test passed in
Chromium, Firefox, and WebKit. The mirror deployment applied migration 040 and
activated release `2026-10-16T110205011Z`. All 39 repository migrations match
the live ledger. All three services, API readiness, public home/privacy/logo,
and OAuth/browser preflights returned success. The deployed logo SHA-256
matches the supplied local asset. The release tree has the expected owner and
group with no group/other-writable files. The branding table and VinMed tenant
are present/absent respectively as expected; no membership or branding row
exists yet. The live account flow remains incomplete until the designated
identity completes Google sign-in and the guarded seed succeeds. Raw audio
retention and token-funding evidence remain separate open product gates.

**Future utility:** Reuse the tenant-scoped branding projection and fail-closed
provisioning pattern for customer-specific identity and visual setup without
confusing customer administration with GPTMD platform operations.

## 2026-10-16 - Deploy token entitlement buckets to the OBGYN mirror

**Beginning - trigger and context:** The local entitlement release added
included/add-on token buckets, reservation settlement, a learner notice, and
the operator-managed consumer catalog. Before sync, the live database was at
migration 032 and had no token grant schema; the complete local project gate
and disposable phase verifier had passed.

**Middle - decisions and work:** Used `npm run deploy:live` to stage the web
and API artifacts, apply only unapplied migrations, atomically switch the
release symlink, and restart the three GPTMD services. Migrations 033-037
applied. Checkout remained disabled, and no grants or balances were seeded.

**End - outcome and verification:** Release
`2026-10-16T072730705Z` is active. All three services are active with zero
restarts; API readiness reports Redis, PostgreSQL, OpenAI, and auth ready.
Origin/public OAuth and Chromium home/OAuth checks passed. The shipped
educator catalog is owned by `eaglesvn:eaglesvn` with mode 0644. A read-only
live query confirmed migrations 033-037 and zero grants, reservations, offer
catalog entries, organization budget settings, group assignments, archive
jobs, and download-engagement rows. This verifies deployment/readiness only:
no learner-funded setup or provider turn was run, and no live token purchase
or renewal path exists. Provider usage remains unavailable to learners until
trusted grants are configured; the scsstx test balance requires an explicit
amount and expiry decision.

**Future utility:** Keep the live release distinct from product funding
readiness. Configure a verified ACB2Pay payment/renewal issuer or explicitly
approved test grant before claiming that learner sessions can consume tokens.

## 2026-10-14 — Define per-variant patient voice and variability settings

**Beginning — trigger and context:** The user clarified that each of GPTMD's
ten age/body portrait variants needs its own voice and variability settings,
and supplied a curated OBGYN disorders catalog for educator input. The current
app generates a new patient scenario for each visit, randomizes persona traits
per scenario, and plays replies with the browser's default speech voice.

**Middle — decisions and work:** Added a ten-key educator settings contract
covering `1019` through `5059`, each with `average` and `heavy` variants. Each
variant owns independent voice and persona-variability settings. The session
variation seed selects within reviewed persona bounds; voice selection affects
audio presentation only. Age and body labels must not imply personality or
clinical facts. Linked the contract from educator input, the modernization
design, and checklist node `i14`.

**End — outcome and verification:** Documentation now names all ten variants
and distinguishes the target contract from current behavior. Educator choices,
runtime storage/selection, and playback using the selected voice remain open;
the checklist stays unchecked. No portrait assets or application runtime were
changed in this step.

**Future utility:** Preserve per-variant ownership and prevent portrait
demographics from becoming unsupported clinical or personality assumptions
when educator settings and runtime support are implemented.

## 2026-10-14 — Add tenant-scoped instructor controls for patient variant settings

**Beginning — trigger and context:** The user clarified that each of the ten age/body portrait variants needs its own voice and variability settings. The existing template had empty voice and trait values, no educator controls, and no runtime mapping; no setting values had been supplied or approved.

**Middle — decisions and work:** Added a strict ten-variant API contract, instructor-only tenant-scoped GET/PUT routes, revision conflict protection, transactional PostgreSQL persistence, and append-only before/after audit. Added a responsive instructor page for per-variant browser voice selection/preview, playback parameters, and independent allowed values for mood, maturity, verbosity, health literacy, and disclosure willingness. Approval requires all ten voice profiles and all fifty trait lists to be complete. Incomplete draft settings do not affect learners.

**End — outcome and verification:** API unit coverage verifies role/tenant boundaries, complete variant count, approval validation, atomic audit persistence, unknown-tenant refusal, and stale-write rejection. Browser coverage exercises loading and saving all ten draft records. The new migration has not been applied to the live database; learner setup/playback does not yet consume approved settings, and educator values remain unfilled. Checklist node `i14` stays open.

**Future utility:** Complete tenant migration and educator review, then wire the approved voice profile into browser playback and the allowed variability values into session-pinned persona generation before enabling this in a learner workflow.

## 2026-10-14 — Reconcile OBGYN educator catalog counts and source attribution

**Beginning — trigger and context:** The user identified catalog metadata that
disagreed with the 130-condition array, requested the nine incomplete sections
be backfilled where sources support it, and clarified that unattributed
material was believed to originate from Mayo Clinic. All case content remains
subject to educator review before approval.

**Middle — decisions and work:** Recounted the 260 section records and source
URLs. The supplied file had eight blank Diagnosis & treatment summaries and
one additional record with a summary but no source URL; all nine incomplete
records now have Mayo Clinic page attribution, with summaries backfilled where
empty. Added explicit source attribution for the 148 formerly unattributed
sections. Preserved seven existing
non-Mayo URLs (six Pam Pearl Hospitals and one Hanoi French Hospital) and
recorded the conflict with the user's Mayo provenance report for educator
reconciliation. Updated current counts and retained the 17/45 external-source
revision-log values as historical rather than additive to current totals.

**End — outcome and verification:** The catalog now contains 130 uniquely
labeled conditions, 260 section URLs and explicit attributions, no empty
section summaries, and 86 conditions with 101 external-source records. All
catalog material remains unapproved for runtime use. Automated coverage
verifies these counts and the provenance review gate; full project checks are
reported separately from educator and clinical approval.

**Future utility:** Keep source URLs authoritative when user-reported
provenance conflicts with the catalog, document uncertainty for educators,
and never mark curated medical material approved based on structural checks.

## 2026-10-14 — Give onlineadmin separate admin and learner spaces

**Beginning — trigger and context:** The user clarified that onlineadmin must
have both customer-admin and learner access, while scsstx remains learner-only.
The roles need independent tenant policies so admin controls do not silently
grant encounter access.

**Middle — decisions and work:** Added a guarded provisioner and atomic SQL
seed for a distinct onlineadmin customer-admin tenant. It checks the live
database identity and migrations, refuses an existing admin tenant, and
requires the existing learner membership to remain active with the expected
bounded text-only policy. The new admin policy disables every capability, uses
finite baseline quotas, sets audio quota to zero, and records an append-only
initial audit. Added regression coverage and documented the procedure.

**End — outcome and verification:** The live seed completed. A read-only query
confirmed the requested active admin and learner memberships, disabled admin
capabilities, learner text access, and one initial audit row per tenant. Chrome
`Default` is signed into onlineadmin; its Account page shows two workspaces
with no preselected tenant. The existing learner tenant was preserved.
Focused provisioning tests passed; the full project gate passed before this
provisioning-only change.

**Future utility:** Keep the tenant boundary and all-off admin policy when
provisioning dual-role test identities; verify the rendered multi-workspace
selector in the account's real Chrome profile.

## 2026-10-14 — Deploy single-workspace Account behavior and verify live learners

**Beginning — trigger and context:** After the two live test identities were assigned separate learner workspaces, the Account page still showed a dropdown even for a single membership. The user asked whether customers need that control; role and policy are tenant-scoped, but a single active tenant is already auto-selected.

**Middle — decisions and work:** Kept the selector for accounts with multiple active memberships and hid it for a single membership. Added a regression proving the customer-admin role and controls remain available without the dropdown; retained multi-membership coverage for explicit selection and role-bound behavior. Updated the Chrome-profile SOP to distinguish the two states. The full project gate passed before the live mirror sync.

**End — outcome and verification:** Release `2026-10-14T083134786Z` activated successfully. The origin/public OAuth gate passed, all three services are active with zero restarts, all 9,193 release paths have the expected owner/group and no group/other write bits, and public `/`, `/privacy`, and `/contact` return 200. The existing Chrome Profile 1 and Default sessions show their expected signed-in learner identities, active learner role, visit access, voice unavailable, and no dropdown. This verifies Account presentation, not a new live visit or transcript/voice modality.

**Rationale:** A selector is useful only when the user must choose among tenant-scoped roles and policies; hiding it for a single membership reduces friction without weakening authorization.

**Future utility:** Keep multi-membership selection explicit and recheck both profile mapping and the app's displayed identity when verifying a real account. Do not infer a completed learner visit from Account-page state.

**Project impact:** Observed: the changed UI is deployed and matches both real single-workspace accounts; local regression coverage and release gates pass. Expected: customers with one organization can proceed without an unnecessary workspace choice.

**Follow-up:** Verify a new visit in the intended learner profile separately; preserve physical microphone, transcript modality, clinical, and release-acceptance gates until directly evidenced.

## 2026-10-14 — Revoke test admin access and provision a second learner profile

**Beginning — trigger and context:** The user asked to remove the admin workspace from one test identity and add learner access to the existing onlineadmin identity. The all-off control tenant and the already-active learner tenant are separate authorization scopes; revoking the former must not remove or interrupt the latter.

**Middle — decisions and work:** Resolved both exact Auth identities and confirmed the live target was `gptmd_live` as `gptmd_live_app`. Updated only the scsstx control membership from active to revoked inside a guarded transaction, retaining the row to avoid cascading deletion and preserving the append-only audit count and active learner session. The onlineadmin identity had no GPTMD memberships, so created a separate `gptmd-learner-test-onlineadmin` tenant rather than sharing the scsstx learner workspace. Added an active learner membership with bounded text/Responses quotas, voice disabled, and an initial before/after policy audit in one transaction.

**End — outcome and verification:** The scsstx control membership is revoked, its separate learner membership remains active, and audit history is unchanged. The onlineadmin learner membership is active in its own tenant with 5 monthly sessions, 50 monthly Responses, 12 Responses per session, one concurrent session, and voice disabled with zero quota; the initial audit entry is present. No code release or migration was needed because these authorization records are read from the live database. Account-page refresh/browser flow remains unverified.

**Rationale:** Tenant membership status is the authorization boundary. Updating status preserves foreign-key references and historical rows, while separate test tenants keep identities and policy/audit ownership isolated.

**Future utility:** Follow the entitlement SOP for narrow transactional revocation and provisioning; never delete membership rows or reuse another test identity's learner tenant.

**Project impact:** Observed: the intended live memberships and policy boundaries now match the requested roles, and an existing learner session was preserved. Not observed: signed-in browser refresh for either identity.

**Follow-up:** Refresh each account in its own Chrome profile to confirm active account membership presentation, then verify the intended learner route without claiming an authenticated browser flow from database evidence alone.

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

## 2026-10-13 — Commit pulse consistency and correct OAuth denial attribution

**Decision:** ## Commit pulse consistency and correct OAuth denial attribution

**Beginning — trigger and context:** The user asked to resume the GPTMD modernization checklist from the current worktree, preserve existing edits, stop photo work, and initially leave Git unstaged. Inspection found an in-progress schema-v8 change requiring a zero pulse rate to agree with absent radial and carotid pulses, alongside already-generated patient images and existing documentation. The user then directed that the changes be committed. Later, iNET's reply identified origin Nginx User-Agent filtering, rather than OneShield, as the source of authorization trace 01M4R6JG845SKV5FQN85C362PN.

**Middle — decisions and work:** Read persistence/AGENTS.md and SOP.md, inspected Git status and the full relevant diff, and verified the Zod pulse union and regression cases. Ran npm run check before staging and committed the existing worktree as ef66180 (45 files, including already-present image assets; no photo generation or editing). Verified the active obgyn Nginx vhost contains the reported User-Agent rule, a curl/8.5.0 request to /auth/v1/authorize?provider=google returns HTTP 403 with 28 bytes, a Chrome 130 User-Agent gets HTTP 302 from the same endpoint, and sudo nginx -t succeeds. Updated the modernization checklist and live deployment notes to distinguish this origin-generated denial from earlier OneShield-branded traces, keep a03 open, and record that no live security rule was changed. Committed that correction as b444cf3.

**End — outcome and verification:** The project check passed: 260 unit tests, 36 cross-browser E2E tests, 40 preflight tests, 10 mobile viewport tests, one Mobile Viewer test, schema and diagram checks, API compilation, and a warning-free production build. The documentation follow-up passed git diff --check. Git status is clean on main, two commits ahead of origin/main, with nothing pushed. The checklist remains 151/286; a03 remains open pending verified Google callback configuration and a completed learner sign-in, and i14 remains open with photo work stopped. The Nginx rule was not changed. One older CuratorMD cue remains pending because its source transcript is 1.246 billion characters and the reader caps each page at 40,000 characters.

**Rationale:** Keep the verified scenario-data invariant and the exact origin-versus-edge diagnosis together so future checklist work does not treat a successful OAuth redirect as completed sign-in or change live bot filtering without a demonstrated need.

**Future utility:** Future GPTMD work can reuse the pulse-rate/pulse-quality validation rule, its regression case, and the paired User-Agent probes for the live OAuth endpoint while preserving separate evidence for origin Nginx and OneShield responses.

**Project impact:** Observed: invalid zero-pulse combinations are rejected by regression coverage, the full project check passed, and the named OAuth trace's 403 cause was corroborated by the active Nginx rule and matching live probes. Expected: consistent scenario records and accurate block attribution reduce contradictory clinical setup data and avoid unnecessary edge-security changes. No clinical outcome or completed Google sign-in was verified.

**Follow-up:** Complete a real browser sign-in only after verifying the current Google OAuth callback registration against GoTrue's /auth/v1/callback. Keep i14 open; no further photo work was performed or requested.

**Rationale:** Future GPTMD work can reuse the pulse-rate/pulse-quality validation rule, its regression case, and the paired User-Agent probes for the live OAuth endpoint while preserving separate evidence for origin Nginx and OneShield responses.

**Impact:** Observed: invalid zero-pulse combinations are rejected by regression coverage, the full project check passed, and the named OAuth trace's 403 cause was corroborated by the active Nginx rule and matching live probes. Expected: consistent scenario records and accurate block attribution reduce contradictory clinical setup data and avoid unnecessary edge-security changes. No clinical outcome or completed Google sign-in was verified.

<!-- curatormd:record_id=6136efb12f64efeb2755f64d75a540d3;content_sha256=7d1df79a5a002e5b7bcc43816aa51f9ef21ed1fa7eabebb3ea7da84f6fde6caa -->
<!-- curatormd:fingerprint=fa5d8e2b56ad7a54acbe5a9100106fd02fff3f5527b3d56f624564a571a67d83 -->

## 2026-10-13 — Commit pulse consistency and correct OAuth denial attribution

**Decision:** ## Commit pulse consistency and correct OAuth denial attribution

**Beginning — trigger and context:** The modernization checklist resumed with the user asking to preserve the existing repository work, stop photo generation, and continue verification. The implementation had added scenario-v8 pulse consistency constraints and generated image assets, but no photo generation was requested in this event. The user later explicitly requested a commit. Separately, iNET supplied trace 01M4R6JG845SKV5FQN85C362PN for /auth/v1/authorize and attributed its 403 to an origin Nginx User-Agent rule rather than OneShield.

**Middle — decisions and work:** Read the repository persistence contract and SOP, inspected status and diff, reviewed the pulse schema and tests, and ran npm run check. Committed the already-present implementation and repository changes as ef66180 (gptMD-dev_0.0.0.14 enforce pulse consistency); this commit included existing portrait files but did not generate or edit photos. Verified the active Nginx vhost contains the User-Agent deny rule, a curl/8.5.0 request gets the 28-byte 403 response, a Chrome 130 User-Agent gets a 302, and sudo nginx -t passes. Made no live Nginx change. Updated the checklist and live-test deployment evidence to distinguish iNET's trace from separate OneShield-branded responses, then committed that documentation correction as b444cf3 (gptMD-dev_0.0.0.15 correct OAuth trace attribution).

**End — outcome and verification:** npm run check passed with 260 unit tests, 36 regular E2E tests, 40 preflight tests, 10 mobile viewport tests, one Mobile Viewer test, schema and diagram validation, API build, and warning-free production build. The documentation follow-up passed git diff --check. The worktree is clean on main, two commits ahead of origin/main; nothing was pushed. The checklist is at 151/286: i14 remains open at 28/100 images with photo work stopped, a03 remains open because a redirect is not a completed OAuth callback/login, and i07 remains open pending physical microphone and live-provider evidence.

**Rationale:** Preserve the schema invariant and the exact origin-versus-WAF attribution while keeping test evidence distinct from real authentication and audio proof. Avoid changing live infrastructure where the trace evidence establishes the source but no policy change was requested.

**Future utility:** Future maintainers can reuse the paired User-Agent probes and active-vhost inspection to diagnose this exact OAuth authorization denial, and can rely on scenario validation to reject inconsistent zero-pulse combinations without mistaking a successful redirect for a complete sign-in.

**Project impact:** Observed: the configured check suite passed, the origin behavior differed by User-Agent exactly as iNET reported, and Nginx configuration validated. Expected: consistent pulse validation and accurate trace attribution reduce invalid scenario states and misdirected WAF changes. No live OAuth completion or physical microphone/provider success was established.

**Follow-up:** Keep a03 open until a real Google OAuth callback and signed-in account flow are verified. Keep i07 open until provider recovery and physical microphone evidence are available. Leave i14 open and do not perform further photo work.

**Rationale:** Future maintainers can reuse the paired User-Agent probes and active-vhost inspection to diagnose this exact OAuth authorization denial, and can rely on scenario validation to reject inconsistent zero-pulse combinations without mistaking a successful redirect for a complete sign-in.

**Impact:** Observed: the configured check suite passed, the origin behavior differed by User-Agent exactly as iNET reported, and Nginx configuration validated. Expected: consistent pulse validation and accurate trace attribution reduce invalid scenario states and misdirected WAF changes. No live OAuth completion or physical microphone/provider success was established.

<!-- curatormd:record_id=a60de8587b8f8c9bd7e98043fd8171a3;content_sha256=da7f07d7a67331124e5391a5ef8557224e85779ee5f9aab93cc54b3e27bd75d4 -->
<!-- curatormd:fingerprint=3ec512f5d386877b636bbe72684912c556370cdbd489dd0bc99db7b07f32cbfd -->

## 2026-10-13 — Complete Google OAuth callback and fix CRS false positive

**Beginning — trigger and context:** Google rejected GPTMD sign-in with
`redirect_uri_mismatch`. The live GoTrue configuration sent
`https://obgyn.eaglesvn.club/auth/v1/callback`; the Google Cloud `gptMD` web
client had a stale callback registration.

**Middle — decisions and work:** The authorized redirect URI was corrected in
Google Cloud. A real browser callback then reached the origin but OWASP CRS
3.3.5 rule `930120` treated Google's URI-like `scope` argument as a file-access
attempt and blocked the request at anomaly rule `949110`. Added a runtime
exclusion for only `ARGS:scope` on the exact GPTMD host and `/auth/v1/callback`
path in `ops/modsecurity/gptmd-oauth-callback-exclusions.conf`; installed the
versioned file under `/etc/modsecurity/crs/` and included it from the active
request-exclusions file. Preserved timestamped backups, passed `sudo nginx -t`,
and reloaded Nginx.

**End — outcome and verification:** A callback-shaped request with Google's
scope value and no OAuth state reached GoTrue and returned its expected 303
instead of ModSecurity's 403. A fresh desktop Chrome sign-in then completed,
and `/account` showed `onlineadmin@eaglesvn.online` as signed in. The account
page also reports no active GPTpatient workspace and requires a learner role;
those access-provisioning gates remain open.

**Rationale:** Preserve the exact distinction between provider callback
registration, origin WAF false positives, completed authentication, and
workspace authorization so future incidents do not weaken all CRS inspection
or mistake a signed-in account for a provisioned learner.

**Future utility:** The versioned exception and SOP give operators a repeatable
way to identify the CRS rule behind an OAuth 403, target only the false-positive
argument, validate the live route, and verify the resulting app session.

**Project impact:** Observed: Google callback registration now matches GoTrue,
the callback-shaped probe reaches GoTrue, and the live app displays the signed-
in account. Workspace provisioning and learner access remain unavailable.

**Follow-up:** Resolve GPTpatient workspace membership/learner-role provisioning
through the existing account administration workflow; do not change the OAuth
callback or broaden the CRS exclusion for that separate gate.

## 2026-10-13 — Add tenant-scoped entitlement administration controls

**Beginning — trigger and context:** A real Google OAuth flow finally completed after correcting the Google client's authorized callback and narrowly excluding Google's URI-like `scope` argument from OWASP CRS rule 930120 on only the GPTMD callback. The signed-in account page still showed no active GPTpatient workspace and required a learner role. The user requested a thorough explanation and codification, then named `scsstx@gmail.com` as the test client for entitlement controls.

**Middle — decisions and work:** Kept authentication and authorization separate: the verified JWT subject remains the identity key; active PostgreSQL membership supplies tenant and role; tenant entitlements remain server-side policy. Added customer-admin-only GET/PUT controls for a selected tenant's visit, response, voice, quota, and concurrency settings. Policy updates validate the complete bounded field set and atomically save the policy with an append-only before/after audit record. The Account page exposes controls only for an active customer administrator. Added API/store tests, a browser UI test using the requested email as a fixture, migration 025, and a manual dedicated-tenant seed. Live inspection confirmed Supabase Auth and `gptmd_live` are separate databases and the test email did not yet have an Auth identity. Added `npm run provision:scsstx-test`, which resolves exactly one Auth subject, checks the target DB and migrations, runs the seed as `gptmd_live_app`, and verifies the disabled policy; the missing-user path was exercised and failed closed without writes.

**End — outcome and verification:** The full `npm run check` passed: lint, stylelint, HTML validation, type checks, 272 unit tests, API build, schemas, diagrams, production build, 39 cross-browser tests, 44 preflight tests, 10 mobile viewport tests, and one Mobile Viewer tool test. `npm run verify:phase2` also passed against disposable PostgreSQL/Redis after applying the migration set, including migration 025. The entitlement-control browser flow passed in Chromium, Firefox, and WebKit. Live release `2026-10-13T152107396Z` was deployed; migrations 024 and 025 are recorded in `gptmd_live`, web/API/worker are active, loopback readiness returned 200, public home returned 200, and public OAuth start returned 302. The named test account had no Supabase Auth identity at deployment time, so the tenant seed and live authorization check remain pending its first Google sign-in.

**Rationale:** A successful OAuth callback proves identity authentication only. Workspace membership, role, feature access, and quotas must remain separate database-controlled decisions and every administrative write must be tenant-scoped and reviewable.

**Future utility:** The documented OAuth diagnosis separates Google redirect registration, origin ModSecurity false-positive handling, authenticated identity, and learner entitlement. The new controls provide a narrow administrator workflow without converting client emails or JWT metadata into authorization.

**Project impact:** Observed: source now provides API-enforced tenant-admin controls with transactional audit and automated checks; the feature release and required schema are live. Not observed: test-client workspace creation, enabled capabilities, or a live encounter using that client.

**Follow-up:** After `scsstx@gmail.com` completes Google sign-in, resolve that account's UUID from the Supabase Auth database, run the corrected seed against `gptmd_live`, and verify the tenant controls and disabled-by-default learner gates through the live API. Enable only an explicitly selected test capability and preserve the audit trail.

## 2026-10-13 — Diagnose OAuth organization-only denial for the test client

**Beginning — trigger and context:** The requested test account `scsstx@gmail.com` attempted Google sign-in and received HTTP 403 `org_internal` for OAuth app `gptMD-web-oauth`, which Google said could only be used within its organization. The live Auth database still had no active identity for the account, so the entitlement seed correctly remained blocked.

**Middle — decisions and work:** Verified Google's current OAuth audience guidance: `org_internal` means an authorization request came from outside the Google Cloud project's parent organization. Classified this separately from the already-correct callback URI, the repaired origin CRS false positive, OneShield, and GPTMD membership/entitlement checks. Opened the existing local Chrome session at Google Auth Platform > Audience and documented the bounded test configuration: External user type, retain Testing status, and add only `scsstx@gmail.com` as a test user. Google's guidance notes that basic identity scopes can be exempt from the test-user allowlist, so GPTMD tenant membership and entitlements remain the real application access boundary. No audience setting was changed from this session because the authenticated Console state could not be inspected through the available browser channel.

**End — outcome and verification:** The cause is attributed to Google OAuth audience, but the Console change and subsequent sign-in are not verified. The Supabase Auth user count remains zero; no test tenant was provisioned. The API/web/worker remain active, API `/readyz` returns HTTP 200 on `127.0.0.1:4100`, and the public home page returns HTTP 200.

**Rationale:** Keeping provider audience restrictions distinct from callback routing, edge/origin filtering, and application authorization prevents repeated redirect fixes or unsafe server changes from being applied to the wrong layer.

**Future utility:** The SOP records the exact Google Console setting and fail-closed order of operations for a personal Gmail test user, including the requirement to verify Auth identity before creating a GPTMD tenant.

**Project impact:** Observed: the `org_internal` blocker is correctly classified and no identity or tenant was fabricated. Not observed: External audience, test-user allowlisting, completed Google callback, or live entitlement-control access.

**Follow-up:** In the authenticated Google Cloud Console, set the app audience to External, keep publishing status Testing, add `scsstx@gmail.com` as a test user, save and verify those settings, then complete sign-in and run `npm run provision:scsstx-test`.

## 2026-10-13 — Make Nginx the public CSP and security-header authority

**Decision:** ## Make Nginx the public CSP and security-header authority

**Beginning — trigger and context:** The live homepage produced browser CSP report-only messages for inline scripts and an external stylesheet, and the captured Permissions-Policy contained names unsupported by the browser. Earlier header fixes used a static CSP hash, which was fragile because Nuxt output hashes can change between builds. The user selected Nginx as the authoritative public header emitter.

**Middle — decisions and work:** The Nginx overlay now hides upstream copies of CSP, report-only CSP, Permissions-Policy, and other fixed security headers, then emits the public policies once. It forwards Nuxt's generated Content-Security-Policy so the allowed hashes match the built HTML. A mapped report-only copy removes only upgrade-insecure-requests, which browsers ignore in report-only mode. The unsupported Permissions-Policy names were removed from the public policy.

**End — outcome and verification:** Nginx configuration validation and the focused header contract test passed. Public HTTPS returned 200 with one enforcing CSP, one report-only CSP, and one Permissions-Policy header. Local Chromium loaded the homepage without CSP, Permissions-Policy, console, or page errors. A hosted Playwright route returned a OneShield-branded 502 page and therefore did not verify the app response through that route.

**Rationale:** The app's CSP depends on generated HTML hashes, so a static edge policy can drift from each release. Keeping Nginx as the single public emitter while forwarding the app-generated CSP preserves header ownership without weakening the enforced policy.

**Future utility:** Provides a repeatable pattern for live deployments where Nginx must own public headers but the application generates build-specific CSP hashes.

**Project impact:** Observed: the public homepage response and local Chromium navigation have no reported CSP or Permissions-Policy violations. Expected: forwarding the generated CSP prevents future Nuxt build hash drift from reintroducing inline-script reports.

**Follow-up:** Investigate hosted-browser trace 01M4T7X3PFNE5207BZ0JDJSBQA separately if remote route coverage is required; do not treat its OneShield 502 response as an application CSP report.

**Rationale:** Provides a repeatable pattern for live deployments where Nginx must own public headers but the application generates build-specific CSP hashes.

**Impact:** Observed: the public homepage response and local Chromium navigation have no reported CSP or Permissions-Policy violations. Expected: forwarding the generated CSP prevents future Nuxt build hash drift from reintroducing inline-script reports.

<!-- curatormd:record_id=0049e3f3af8271621599ff57af816a65;content_sha256=edc0432e2e2e9e932d83b7607b6779430c030541bddc18c96d73da51bd1486ae -->
<!-- curatormd:fingerprint=ed8b8ff01298bbfe5855127231afdd4ba8aea6bf76ff9b9c4beb7ca167fa3f3d -->

## 2026-10-14 — Provision bounded learner access and verify the live mirror

**Beginning — trigger and context:** The test user completed Google sign-in, then requested learner access and a full sync to the obgyn mirror. The separate customer-admin test workspace must remain a control surface rather than being repurposed as a learner.

**Middle — decisions and work:** Verified the live database target and required migrations, then provisioned an isolated learner workspace with finite text/Responses quotas and voice disabled. The full application check passed before deployment. A post-deploy audit confirmed that current release paths belong to the service account; it found group/other write permissions in the synchronized tree. Removed those bits without changing ownership or executable permissions, and added a release-time ownership and permission guard plus a regression test. Updated the checklist and live deployment record without rewriting historical OAuth status entries.

**End — outcome and verification:** Release `2026-10-13T173629854Z` is active; web/API/worker services are active and `/`, `/privacy`, and `/contact` return public HTTP 200. All 9,193 checked release paths are owned by `eaglesvn:eaglesvn`, and no regular file or directory is group/other-writable. The ownership/permission guard test passes. The signed-in learner browser path is not yet verified; refresh Account and select the `Learner` workspace for that final user-path check.

**Rationale:** Authentication, tenant membership, entitlement policy, and live learner use are distinct gates. File-sync permissions also need an explicit invariant because FreeFileSync can preserve shared-write modes from the build output.

**Future utility:** The deploy script rejects mismatched owners and normalizes only group/other write bits while retaining executable permissions; the live deploy SOP records how to inspect the symlink separately from its release target.

**Project impact:** Observed: bounded learner records exist in the intended live database and the mirror is serving public pages from the current release. Not observed: an authenticated learner selecting that workspace and starting a visit.

**Follow-up:** Complete the real signed-in Account selection and learner-route check. Keep voice and audio quotas off unless separately approved and tested.

## 2026-10-14 — Make the GPTMD source checkout read-only to LiteSpeed

**Beginning — trigger and context:** A permissions recheck found the GPTMD checkout owned by `eaglesvn:eaglesvn` but group-writable under `umask 0002`. The `nobody` account is a member of `eaglesvn`, and the active LiteSpeed workers run with that supplementary group, so they could modify the checkout even though the published release tree had already been hardened.

**Middle — decisions and work:** Preserved checkout ownership and owner-write access, removed only group-write from regular files and directories, and added default ACLs to all directories so new entries remain group-read-only despite `umask 0002`. Group read/traverse and executable bits remain intact; the existing release tree and `nobody` group membership were not changed. Added the repeatable audit and repair procedure to the GPTMD SOP.

**End — outcome and verification:** The audit found no owner mismatches and removed group-write from 51,417 paths. All 5,690 directories now carry default ACLs with no group-writable group or mask entries. A file and directory created with modes `0666` and `0777` inherited modes `0644` and `0755`. `sudo -n -u nobody` confirmed the LiteSpeed identity can read a source file and traverse the checkout but cannot write either. All three live GPTMD services remained active and the public homepage returned HTTP 200. Git status showed no file-content or executable-mode changes from the permission repair.

**Rationale:** LiteSpeed needs read/traverse access to served release files, not write access to the development checkout. Preserving the supplementary group avoids breaking vhost reads while preventing a web-worker compromise from altering code later consumed by deployment.

**Future utility:** The default ACL prevents the host's collaborative umask from recreating the checkout exposure for future files and directories; the audit distinguishes checkout permissions from the separately guarded immutable release tree.

**Project impact:** Observed: LiteSpeed retains read/traverse access and loses write access to the GPTMD checkout; the web/API/worker release remains active. Expected: source and build inputs are protected from modification by the low-privilege web worker.

## 2026-10-14 — Repair test-domain OAuth and deploy tenant entitlement controls

**Decision:** ## Repair test-domain OAuth and deploy tenant entitlement controls

**Beginning — trigger and context:** The live GPTMD test domain had separate OAuth failures: Google rejected the callback URI, and the origin returned 403 on the OAuth callback. The user also needed an isolated, least-privilege learner workspace with tenant-scoped entitlement controls.

**Middle — decisions and work:** The active Supabase GoTrue callback was verified as https://obgyn.eaglesvn.club/auth/v1/callback and added to the Google OAuth client's authorized redirects. The callback's ModSecurity 403 was traced to OWASP CRS rule 930120 misclassifying the URI-like scope parameter; the exclusion was limited to ARGS:scope on that host's /auth/v1/callback path. Tenant-scoped GET/PUT entitlement endpoints and an append-only audit were implemented, with account controls and a guarded test-workspace seed path. The release was deployed after project checks passed; migrations 024 and 025 were applied and the seed helper was corrected to take the validated Auth subject UUID from the separate Supabase Auth database.

**End — outcome and verification:** A fresh Chrome login returned to /account, and later live checks showed the release active, services healthy, OAuth start returning 302, and the unauthenticated entitlement endpoint returning 401. The scsstx@gmail.com Auth identity was still absent, so no tenant was seeded and live learner entitlement verification remained open. The origin rule was narrowed; the broader OneShield zone setting remained separate.

**Rationale:** This records the verified OAuth recovery and the deployed tenant-control path while preserving the important boundary between successful authentication and not-yet-provisioned learner authorization.

**Future utility:** For future test-domain OAuth failures, verify the exact GoTrue callback and distinguish Google redirect mismatch, origin CRS blocks, and OneShield behavior; scope any CRS exception to the endpoint and argument. For learner provisioning, resolve a real Auth subject before seeding membership.

**Project impact:** Observed: the callback reached GoTrue after a narrow CRS exclusion, browser OAuth succeeded for the existing admin account, and tenant entitlement endpoints were deployed behind verified tenant membership. The current test learner still cannot be provisioned until its real Auth identity exists. Expected: the narrow exception limits the security change to the affected callback parameter and keeps access controlled by database membership and entitlements.

**Follow-up:** After the scsstx@gmail.com identity is created by its first Google sign-in, run the guarded provisioning script and verify the learner account's selected workspace and visit in an authenticated browser.

**Rationale:** For future test-domain OAuth failures, verify the exact GoTrue callback and distinguish Google redirect mismatch, origin CRS blocks, and OneShield behavior; scope any CRS exception to the endpoint and argument. For learner provisioning, resolve a real Auth subject before seeding membership.

**Impact:** Observed: the callback reached GoTrue after a narrow CRS exclusion, browser OAuth succeeded for the existing admin account, and tenant entitlement endpoints were deployed behind verified tenant membership. The current test learner still cannot be provisioned until its real Auth identity exists. Expected: the narrow exception limits the security change to the affected callback parameter and keeps access controlled by database membership and entitlements.

<!-- curatormd:record_id=3bb90bb51ffb57ec83b87f1598dcd609;content_sha256=155095c835f066a2421aec8f26e1177d7d22ef994fec62f7a3e82d9d6ede4c01 -->
<!-- curatormd:fingerprint=d6304839c9134913daf2c0c6bc80521a8379b5fdaebdbea977dd214c478341be -->
## 2026-10-14 — Establish organization AI-time pools and group budgets as the core entitlement

**Beginning — trigger and context:** The user clarified that model, voice, reasoning, and personality are settings, not entitlements. Token/minute allowances are the crucial entitlements. The organization owns the AI-time pool and budgets it per user group (including `gptNURSING`, `gptRECEPTION`, `gptTECHNICIAN`, `gptVENDOR`, and `gptCASHIER`); departments such as OBGYN, PEDIATRICS, ONCOLOGY, UROLOGY, and ENDOCRINOLOGY are a separate dimension.

**Middle — decisions and work:** Recorded the organization as pool owner and the user group as token/minute entitlement and budget key. Kept model, voice, reasoning, and personality outside entitlement accounting as separate settings. Token and minute allowances are distinct usage dimensions unless an explicit conversion is approved. Recorded departments as independent organizational classification/attribution, not default budget buckets. Distinguished this target from existing tenant visit/Responses/audio quotas and provider cost attribution. Documented unresolved provider meters, periods, rollover, overage, reconciliation, and multi-group rules.

**End — outcome and verification:** Added `docs/organization-ai-time-entitlements.md` and linked the target to open modernization gates `a09` and `d02`. The contract distinguishes configurable AI settings from token/minute entitlements and budgets. `npm run check` passed: 285 unit tests, 42 standard browser tests, 44 preflight tests, 10 mobile-viewer tests, and one Mobile Viewer tool test; API build, schema/diagram checks, and warning-free production build also passed. No schema, API, runtime policy, database, or live tenant was changed.

**Future utility:** Use this contract before designing migrations, transactional reservations, administrator controls, or usage reports for organization/group token and minute entitlements.

## 2026-10-14 — Set group-only allocation and session reservation policy

**Beginning — trigger and context:** Follow-up design questions narrowed how the organization token pool is allocated and how provider usage must be authorized. The existing customer-admin controls remain draft-only and do not charge or block calls.

**Middle — decisions and work:** The user chose group allocations only: unallocated organization tokens are not a direct fallback. Each provider call must reserve a bounded amount before execution and reconcile that reservation to actual provider `total_tokens`; retries are separate calls. A session uses one budget group, pinned for its lifetime, and a member's reassignment affects only new sessions. Existing extra-token decisions remain: prepaid credits belong to the purchasing scope, carry forward, require confirmed payment, and require a per-session choice if both organization and individual credits can fund overage.

**End — outcome and verification:** Updated the entitlement reference and modernization checklist to record these accepted rules and remove them from the unresolved decision list. No runtime reservation, group assignment, session pin, payment, database migration, or enforcement was implemented or verified in this update. Reservation bounds and recovery behavior for missing or revised provider usage remain open.

**Future utility:** These choices constrain the upcoming member assignment, session creation, reservation ledger, retry, and reconciliation paths; they prevent silent use of unallocated pool balance or changing the budget group underneath an active session.

## 2026-10-15 — Separate consumer token plans from organization budgets

**Beginning — trigger and context:** The user distinguished consumer subscriptions from corporate customer budgets and clarified that model, voice, reasoning, and personality are controlled in-house by TEAECL, the GPTMD operating organization.

**Middle — decisions and work:** Consumer plans use monthly included-token tiers: Lunar at a configurable base amount, Solar at twice that amount, and Stellar at three times that amount. TEAECL manages plan amounts, prices, and an extensible client-facing add-on catalog. Purchased individual add-on credits carry forward; included monthly plan tokens reset monthly. Consumer plan grants remain separate from corporate organization/group/department allocations. OpenAI is the primary provider; a different provider is reserved for continuity when OpenAI is unavailable, with in-house health/routing policy and matching GPTMD response/safety contracts. TEAECL controls both provider pools. Each provider attempt is recorded and billable actual usage is reconciled once against the consumer's single plan/add-on balance and its corresponding operational provider pool; failover does not expose a second learner wallet. Learners and corporate administrators do not receive model/voice/reasoning/personality or provider-routing controls.

**End — outcome and verification:** Added `docs/consumer-ai-token-plans.md` and linked it from the organization entitlement reference. Follow-up implementation added migration 033, an allowlisted system-admin catalog API/editor, revision conflict protection, append-only audit, and explicit checkout-disabled projections. `npm run check` passed, including unit/API tests, production build, 48 cross-browser E2E tests, 44 preflight browser tests, and 11 mobile checks; the disposable-database migration verifier also passed. No deployment, product publication, payment, plan grant, or provider failover has occurred. No prices or token quantities were invented.

**Rationale:** Separate subscription entitlements, corporate budget allocations, and provider operating capacity so customer administration cannot alter TEAECL's AI configuration, while billable failover attempts remain accurately reconciled.

**Future utility:** Use this boundary when implementing the public catalog, consumer subscription ledger, add-on payments, and provider-aware metering. Cross-provider token normalization and failover behavior remain explicit implementation gates.

**Project impact:** Observed: consumer catalog configuration is now separated from corporate budgets and only the allowlisted system-admin lane can edit it. Runtime purchases and entitlements remain disabled until their separate accounting and payment paths exist.
## 2026-10-14 — Preserve OBGYN disorder catalog as educator review input

**Beginning — trigger and context:** The user supplied a curated OBGYN disorder catalog to use for educator input on fictional training cases. The project does not yet implement instructor case authoring, and clinical content must remain distinct from model instructions and runtime answer-key truth.

**Middle — decisions and work:** Initially copied the JSON byte-for-byte under `educator-input/` and documented its provenance, intended educator-review-only role, and SHA-256. Structural inspection found 130 unique condition labels, nine incomplete Diagnosis & treatment records (eight with blank summaries and one with a summary but no source URL), only 112/260 section records with explicit source attribution, and internal metadata contradictions about condition counts, enrichment, and external sources. Linked it to the future case-authoring plan without connecting it to the patient generator.

**End — outcome and verification:** At initial import, source and repository copy compared byte-identically and shared SHA-256 `d7011fd64bf761b7824f0195683174e6c876bdc685d22964bede7a3642319334`. The JSON parser accepted the file. A later 2026-10-14 reconciliation converted the repository copy into an edited educator-review derivative; see the subsequent decision entry. No runtime, database, live tenant, or clinical behavior changed; educator authoring and clinical approval remain open.

**Future utility:** Educators can use the catalog as a starting reference while preserving provenance and resolving its incomplete sections and inconsistent metadata before approving scenario content.

**Project impact:** Observed: a versioned, reviewable input asset and its known quality gaps are now recorded without treating external prose as GPTMD instructions or validated clinical truth. Expected: the explicit review boundary reduces unsupported case facts entering learner scenarios.

## 2026-10-14 — Resolve organization token entitlement policy

**Beginning — trigger and context:** The user clarified the intended entitlement model while organization AI-time controls were being wired. Earlier notes treated token/minute metering, reset periods, rollover, overage ownership, and group selection as undecided; subsequent user decisions supersede those open questions.

**Middle — decisions and work:** Actual provider token usage is the charge basis; the current Responses meter is `provider_usage.total_tokens`. Minute amounts are relative estimates, not a second independently consumed allowance. Each individual included allowance resets by calendar month, while each organization chooses its pool period. Every session uses one explicitly selected budget group for its lifetime. When included allowance is exhausted, extra tokens may be purchased in-app, are used for overage, and carry forward across months. Organization purchases are organization-owned; individual purchases are individual-owned. If both balances are available for session overage, ask the user to choose the funding scope and persist that choice rather than silently preferring or switching balances. Model, voice, reasoning, and personality remain settings, not token entitlements; departments remain distinct from user groups.

**End — outcome and verification:** Updated the organization AI-time contract and modernization checklist with these decisions. Migration 027 is applied to the live mirror, but its budget controls remain draft/read-only: there is no runtime token reservation or debit, group assignment, purchased-credit ledger/payment confirmation, or per-session overage selection. Concurrent reservations, unallocated-pool fallback, missing/revised usage reconciliation, and group reassignment timing remain open pending explicit policy and implementation evidence. The live Responses meter name and aggregate source were verified in the repository schema; no live budget or credit balance was seeded or charged.

**Future utility:** Keep actual token entitlements separate from capability quotas and AI configuration. Implement payment-confirmed credits, atomic usage accounting, and a pinned per-session funding choice only after remaining concurrency and fallback rules are settled.

## 2026-10-14 — Scope department administration and transfer allotments

**Beginning — trigger and context:** The user clarified that hospital IT staff administer department changes and that a transfer partway through a pay period should receive only the remaining share of the new department's token allotment. The existing group-budget controls had a department catalog but no member assignment, transfer proration, or roster workflow.

**Middle — decisions and work:** Department assignment is controlled by a customer administrator authenticated within one organization; learners cannot self-assign. Admins can select a member and department from dropdowns or export/import that tenant's roster as CSV. Department monthly per-user token allotments prorate against the remaining UTC calendar month on a real department transfer. Reimporting an unchanged department preserves its assignment timestamp. New sessions snapshot their group and department; existing sessions remain pinned. The assignment audit records before/after departments.

**End — outcome and verification:** Added migration 029, tenant-scoped assignment APIs and controls, CSV import/export, session snapshots, and regression coverage for proration and assignment APIs. Focused tests and the API TypeScript build passed after a session-create error type repair. Migration 029 is not live-applied or deployed. The allotment preview is not token enforcement: reservations, usage debit/reconciliation, department/group accounting, and payment-confirmed overage remain open. Full `npm run check` remains required.

**Future utility:** Keep organization-admin authority explicit, preserve historical session attribution, and avoid renewing a learner's proration period when a roster import repeats the same department.

**Project impact:** Observed: API tests verify tenant-role handling, assignment import, assignment persistence, and calendar-month proration; session creation snapshots department and group codes in code. Expected: tenant-scoped roster workflows make customer setup manageable. No live migration, deployment, or token balance enforcement was verified.

## 2026-10-16 — Support customer roster CSV, XLSX, and ODS

**Beginning — trigger and context:** The customer-admin assignment workflow supported CSV only, while the user requested import/export in XLSX, ODS, and CSV for hospital IT roster management.

**Middle — decisions and work:** Added a browser-side roster spreadsheet boundary using SheetJS 0.20.3 from the project's official package distribution. It imports and exports all three formats, preserves identifier/code values as text, rejects formulas, enforces a 5 MB file bound and 500-member row cap, and sends the same existing tenant-scoped assignment payload to the API. The downloadable roster remains based only on active members visible in the authenticated tenant workspace.

**End — outcome and verification:** Unit tests verify CSV/XLSX/ODS round trips, BOM and quoted CSV parsing, required headers, text-only identifiers, formula rejection, and file/row limits. Browser tests verify downloads and imports for all three formats in Chromium, Firefox, and WebKit. `npm run check` passed: 57 Vitest files / 375 tests, warning-free production build, 48 standard browser cases, 44 preflight browser cases, 10 mobile-viewer cases, and one mobile-viewer tool case. No live deployment or tenant roster mutation was performed.

**Future utility:** Hospital administrators can use common spreadsheet formats without changing tenant authorization, group/department assignment rules, or session-pinned historical assignments.

**Project impact:** Observed: local browser and unit evidence confirms three-format handling over the same tenant-scoped assignment contract. Live customer workflows remain deployment-gated.

## 2026-10-16 — Notify learners when add-on tokens are spent

**Beginning — trigger and context:** The learner entitlement flow could debit included or add-on grants, but it did not tell a learner when confirmed provider usage began consuming add-ons or preserve dismissal across reloads. The next account-policy decision is an informational, once-dismissable notice; payment and grant issuance remain separate unfinished work.

**Middle — decisions and work:** Added migration 037 with session-level `addon_tokens_used` and `addon_notice_acknowledged` flags. Reservation reconciliation reports whether actual settled tokens reached an add-on grant; patient turns persist that fact with settlement, while scenario setup returns the signal and writes it through its existing session transaction to avoid locking the same row on a second connection. Setup, turn, and owner-scoped restore responses expose only an unacknowledged notice. A learner-only, session-owner-scoped acknowledgment route persists dismissal. The encounter shows the notice after entering the room or after a later turn, with the existing included-first funding and 365-day add-on expiry policy. Ambiguous/held usage alone does not trigger it.

**End — outcome and verification:** `npm run check` passed locally: 59 Vitest files / 392 tests, API compilation, generated schema and diagram checks, warning-free Nuxt production build, 48 cross-browser cases, 44 encounter/preflight cases, 10 mobile-viewer cases, and one viewer-tool case. A focused regression verifies confirmed add-on debit versus included-only debit, API role enforcement, and the browser restore/dismiss flow. Migration 037 and application changes have not been applied to the live mirror; no checkout, grant issuance, deployment, or live balance change occurred. `a09` and `d02` remain open.

**Future utility:** Keep user notification tied to actual ledger consumption rather than reservation ceilings, and preserve the acknowledgment at the authenticated session-owner boundary.

**Project impact:** Observed: learners can be informed once when a settled provider usage debit spends add-on tokens, including after restoring an encounter. Expected: the persistent notice should make automatic included-first overage behavior more transparent. Live entitlement funding and payment verification remain independent gates.

## 2026-10-16 — Show learner-scoped provider usage in Account

**Beginning — trigger and context:** The learner Account page still labeled usage as unavailable even though `provider_usage` records actual provider token totals by tenant and authenticated subject. The workspace selector supports multiple memberships, so usage needed to follow the selected learner workspace without exposing organization-wide or other-user totals.

**Middle — decisions and work:** Added a learner-only account usage endpoint for the current UTC calendar month, filtering by the verified tenant and subject. Added a matching PostgreSQL index, client display of provider tokens and response count, and API, query, and browser regression coverage. The UI states clearly that usage is not a remaining balance or purchase ledger.

**End — outcome and verification:** `npm run check` passed with 57 Vitest files / 378 tests, a warning-free production build, 48 standard browser cases, 44 preflight browser cases, 10 mobile-viewer cases, and one mobile-viewer tool case. `npm run verify:phase2` applied migration 034 to its disposable PostgreSQL database and passed the real API/storage/browser workflow. No migration or application deployment has been performed; live account and tenant data remain unverified.

**Future utility:** Provides learners with usage telemetry while keeping consumer credits, organization entitlements, and engagement-minute certification as separate unimplemented records and contracts.

**Project impact:** Observed: the query and API contract are tenant-and-subject-scoped in source and covered by regression tests. Live usage display remains deployment-gated.

## 2026-10-16 — Expose published consumer token offers

**Beginning — trigger and context:** The TEAECL system-admin catalog already stored Lunar/Solar/Stellar tier pricing and extensible add-ons, but signed-in clients could not view published offers. ACB2Pay confirmation is not configured, so the app must not accept checkout or grant credits.

**Middle — decisions and work:** Added an authenticated read-only catalog endpoint that does not require tenant membership, projects only published catalog items, and returns `checkoutEnabled: false`. Added a client Account table for monthly tiers and add-ons with clear unavailable-checkout messaging. Draft products stay hidden and no model/provider controls are exposed.

**End — outcome and verification:** `npm run check` passed with 57 Vitest files / 379 tests, a warning-free production build, 48 standard browser cases, 44 preflight browser cases, 10 mobile-viewer cases, and one mobile-viewer tool case. The API regression test confirms published-only visibility without an active tenant and checkout disabled; browser coverage renders offers alongside learner usage and transcript downloads. No payment, credit, database, or application deployment occurred.

**Future utility:** This is a catalog preview only. Payment confirmation, monthly plan subscriptions, carry-forward credit ledger, balances, and provider failover remain open.

**Project impact:** Observed: the signed-in Account page can render operator-published token offers while checkout remains disabled by the API contract. Live catalog deployment and product configuration remain unverified.

## 2026-10-16 - Define separate learner included and add-on balances

**Beginning - trigger and context:** The learner account requirements distinguish private monthly included tokens from purchased add-ons, and corporate included allocations from each learner's own add-ons. The prior product notes incorrectly described a funding-choice prompt and month-to-month add-on carry-forward without a fixed expiry.

**Middle - decisions and work:** Updated the consumer and corporate entitlement contracts. Private included tokens renew on the account subscription anniversary and do not roll over; individual add-on grants expire 365 days after grant. Corporate monthly allowances remain valid for 45 days after the organization renewal date; corporate learners consume their assigned included allowance before personal add-ons, with no funding prompt. Organization-owned add-on packages must be allocated through group budgets. Clarified that TEAECL system administrators have global authority while corporate administrators remain tenant-scoped. Added a learner-only recent provider usage ledger to Account and an API query scoped by authenticated tenant and subject, capped at 100 records. Kept balance gauges and checkout unimplemented because durable entitlement grants and payment confirmation do not exist yet.

**End - outcome and verification:** `npm run check` passed: 58 Vitest files / 385 tests, API TypeScript build, schema and diagram checks, warning-free production build, 48 standard browser tests, 44 preflight tests, 10 mobile-viewer tests, and one mobile-viewer tool test. New API and browser regression coverage verifies learner-scoped ledger display and role boundaries. No payment, entitlement grant, database migration, deployment, or live account mutation occurred.

**Future utility:** Implement the durable grant/debit ledger and authenticated balance summary before showing remaining-balance gauges or enabling add-on spend. Apply the anniversary, 45-day organization window, 365-day add-on expiry, included-first debit order, and informational dismissal notice atomically with provider-usage reconciliation. Configure Anthropic Haiku 5.5 failover only after native-usage normalization and clinical simulation evaluation are approved.

**Project impact:** Observed: learners can view up to 100 recent provider-usage records for their own authenticated workspace. Balance amounts and expiry counts are not yet available, and neither provider failover nor billing is live.

## 2026-10-16 - Add learner token bucket ledger preview

**Beginning - trigger and context:** Account usage telemetry and policy docs specified separate included and purchased token buckets, but there was no persistent entitlement-grant record or learner balance view. The state must not imply available credit without a trusted renewal/payment issuer or reconciled provider usage.

**Middle - decisions and work:** Added migration 035 with owner-scoped included/add-on grant rows, append-only debit/reversal entries, and reservation-to-grant hold allocations. Database constraints enforce confirmed-purchase source types, 365-day add-on expiry, and a 45-day maximum corporate included window; row-level security and revokes keep access in the Express service. Added a learner-only API summary scoped to the authenticated subject and selected workspace, showing grant, used, reserved, remaining, renewal/expiry, and days remaining. Added responsive separate Account gauges and a no-grants state. Provider reservations now allocate available grants in included-first order, retain allocations on ambiguous outcomes, and atomically debit actual `total_tokens` exactly once when settled. The disposable verifier seeds a synthetic included grant before real API setup/turn generation and checks that reservation debit totals match provider usage in PostgreSQL and the authenticated API. Checkout and trusted payment/renewal issuance remain disabled and unimplemented.

**End - outcome and verification:** `npm run verify:phase2` passed against disposable PostgreSQL/Redis. It applies migrations 035-036, drives the actual reservation callback through authenticated scenario setup and patient turns, and verifies provider reservations debit exactly actual `total_tokens` before the learner API reports the balance. `npm run check` passed with 59 test files / 389 unit tests, API build, schema/diagram checks, warning-free production build, 48 cross-browser tests, 44 preflight tests, 10 mobile-viewer tests, and one viewer-tool test. No live migration, credit grant, payment, debit, or deployment occurred.

**Future utility:** Connect trusted subscription/organization allocation issuers and payment confirmation to grant creation. Add the once-dismissable notice when add-on spending begins. Do not activate checkout or claim live balances until live deployment, grant issuance, expiry, and source-priority behavior are verified.

**Project impact:** Observed: the repository can reserve against synthetic grants and reconcile actual provider token usage to a subject-scoped balance in disposable verification. Live balances remain absent; gauges stay empty until a trusted issuer exists. Haiku 5.5 remains the selected provider failover candidate but is not wired or live.

## 2026-10-16 - Deploy organization allocation reconciliation and cleaned OBGYN source

**Beginning - trigger and context:** Active organization budgets configured group limits but did not issue the included-token grants required by provider reservations. The educator catalog also gained discrete illustrative diagnostic tests and routine-care focus records and needed to be the exact source packaged for the live API.

**Middle - decisions and work:** Active budget saves now reconcile organization-owned grants to configured group allocations; increases create idempotent grants expiring 45 days after period renewal, while reductions append adjustments and cannot exceed unspent/unheld tokens. Draft settings remain inert, and the next provider reservation lazily renews an active period. The cleaned catalog is packaged by the live deploy path; its modeled encounter-relevance scores remain sampling weights and are not relabeled as observed incidence. Checkout and live grants remain disabled/uncreated.

**End - outcome and verification:** `npm run check` passed with 60 unit files / 399 tests, 48 desktop browser cases, 44 preflight cases, 10 mobile-viewer cases, and one viewer-tool case. The disposable PostgreSQL/Redis verifier exercised issuance, adjustment, refusal below usage, and renewal. `npm run deploy:live` activated `2026-10-16T081212459Z` and applied migration 038. Post-deploy OAuth/browser checks passed, all three services are active, API dependencies are ready, and the packaged educator source hash matches the repository file. Read-only live queries confirmed zero grants, entries, reservations, group assignments, budget settings, checkout catalog rows, archive jobs, and engagement rows. No live learner funding or scenario generation was performed.

**Future utility:** Before live learner funding, verify an intentionally configured organization allocation and owned learner flow. Verify fresh live scenario generation separately from the deploy check; retain the catalog's distinction between modeled encounter relevance and measured incidence.

**Project impact:** Observed: group-budget configuration can now issue and reconcile organization grants in verified local/disposable flows, and the cleaned educator catalog is present in the live release. Expected: this closes the active-budget-without-grants failure path once an organization configures an allocation. No live budget or learner balance was created.

## 2026-10-16 - Deploy restricted GPTMD operations and bind system admin

**Beginning - trigger and context:** The system-admin dashboard had a fixed-command API and host operator implementation, but no installed host socket/key or configured system-admin identity. The user selected `onlineadmin@eaglesvn.online` as the system-admin account.

**Middle - decisions and work:** Deployed release `2026-10-16T083125601Z`; installed the root-owned restricted operator, socket activation, and API supplementary group without changing application data. Added a separate configuration command that resolves exactly one active local Supabase Auth subject for the selected email, adds that UUID to the private API allowlist while preserving existing values, restarts the API, and checks readiness. It keeps credentials and the UUID out of terminal output. Documented setup and added regression tests for subject-list updates and invalid configuration.

**End - outcome and verification:** The operator returned a signed overview of all three GPTMD units; all three app units and both ops units report active. Public home and API readiness returned HTTP 200. The API env remains mode 0600 and the socket is `root:gptmd-ops` mode 0660. The full `npm run check` passed with 404 unit tests, 54 desktop browser tests, 44 encounter-preflight tests, 10 mobile-viewer tests, and one viewer-tool test. Desktop cross-browser tests run with one worker to avoid host contention timeouts. New E2E tests verify non-operator denial and allowlisted status/log/action UI with mocked auth/API responses. Live authenticated dashboard/actions still require an `onlineadmin` browser-session check.

**Future utility:** Keep platform operations behind exact Auth subject allowlisting, separate from tenant roles. Verify the protected page and controlled restart/log actions in the authorized browser profile; preserve the sanitized fixed-command operator boundary.

**Project impact:** Observed: the live operator is installed and signed requests work; the selected system-admin subject is configured and API-ready. Expected: the separately allowlisted operator can manage only the GPTMD stack from the system-admin dashboard after browser authentication. No customer tenant or application data was modified.
