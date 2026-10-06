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
