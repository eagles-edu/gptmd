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
