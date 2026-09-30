# Standard operating procedures

## Five-stage development workflow

Start with a concise summary of the problem, intended result, and success
criteria. Then complete these stages in order:

1. **Troubleshooting:** inspect the relevant code, configuration, state, diffs,
   and actual error. Identify the cause and preserve existing user data.
2. **Plan remediation:** state the smallest safe repair, its expected result,
   recovery options, and how it will be verified.
3. **Implementation:** apply the approved repair and update the relevant
   project rules or procedures.
4. **Testing:** add or strengthen a regression test that fails against the
   original defect, then run the focused tests and full `npm run check` suite.
   Do not close a fix with only a smoke test or an unverified build.
5. **Completion:** inspect the final diff and runtime state; report what
   changed, the verification evidence, limitations, and manual/automatic
   recovery paths.

Do not stop at the first error. Continue diagnosis and safe repair; if blocked,
give the cause and an actionable remediation plan.

## Resolve all discovered diagnostics

Always fix every error, warning, and other actionable diagnostic discovered
while carrying out a task, including diagnostics emitted by required build,
lint, type-check, and test commands. Trace each diagnostic to its owning source,
configuration, or dependency and repair it there; do not suppress it, relabel it
as harmless, or leave it as a known warning. Rerun the command that exposed it
and confirm the diagnostic is gone. If a diagnostic cannot be fixed safely in
the current task, keep the task incomplete and report the exact blocker, the
evidence, and the concrete repair needed; a successful exit code does not make
the task complete while actionable diagnostics remain.

## Maintain regression coverage

Every bug fix adds or updates an automated test for the observed failure and
the repaired behavior. A warning fix also tests the setting, source transform,
or build output that prevents that warning from returning. Run `npm run check`
before completion; do not weaken or skip an existing check to make a change
pass. Keep the unit, browser, type, lint, API, and clean-build checks in that
command and in continuous integration.

## Start a coding session

1. Work from the Git worktree root: `/home/eaglesvn/dockerz/gptmd`.
2. Read `persistence/AGENTS.md`, then search the four persistence documents for the task terms.
3. Use the `gptmd-coding` Hermes profile for agent-driven coding. Keep the Codex app-server runtime selected for implementation sessions.

## Verify the Nuxt project

```bash
npm run check
git status --short
```

The check suite is authoritative for this starter. Its build fails on warnings
or errors so new diagnostics cannot pass unnoticed.

## Inspect CuratorMD safely

```bash
python3 /home/eaglesvn/dockerz/curatormd/plugins/curatormd/scripts/curatormd.py --project-root /home/eaglesvn/dockerz/gptmd status
python3 /home/eaglesvn/dockerz/curatormd/plugins/curatormd/scripts/curatormd.py --project-root /home/eaglesvn/dockerz/gptmd snapshot
python3 /home/eaglesvn/dockerz/curatormd/plugins/curatormd/scripts/curatormd.py --project-root /home/eaglesvn/dockerz/gptmd --profile gptmd-coding curate --schedule-slot '06:00 Asia/Ho_Chi_Minh'
```

The snapshot reads only approved repository metadata. The curator may update
only reviewed entries in the four persistence files and leaves all changes
uncommitted. An ambiguous or conflicting candidate is reported without a write.

When opening a CuratorMD Python source file from this GPTMD workspace, keep
CuratorMD source in its own repository and resolve sibling modules with the
workspace-relative `../curatormd/plugins/curatormd/scripts` entry in
`.vscode/settings.json` under `python.analysis.extraPaths`. Add CuratorMD-only
technical identifiers to this workspace's `cSpell.words` list when needed.

## Curate a significant development event

Use the `sde-curation` Hermes skill to inspect the full relevant discussion,
including the original request, decisions, implementation, errors, repairs,
and verification. Preserve ordinary project terminology and outcomes; scrub
secrets only. Never store the raw thread. Submit one structured proposal with
`title`, `beginning` (trigger and context), `middle` (decisions and work), and
`end` (outcome and verification) through `sde_parse`. Cue-only captures are
not candidates. Choose the archive by
purpose: durable rules in `AGENTS.md`, repeatable procedures in `SOP.md`, dated
decisions in `HISTORY.md`, and verified causes/prevention in
`LESSONS-LEARNED.md`.

## Recover a failed CuratorMD review

1. Read the exact error, check `persistence_status`, inspect the prepared
   transaction, and compare the named file with its Git diff. Preserve all
   existing edits.
2. Retry `curation_run` for automatic recovery when the prepared transaction's
   target hash still matches.
3. For manual recovery, inspect the full target diff and run:

   ```bash
   python3 /home/eaglesvn/dockerz/curatormd/plugins/curatormd/scripts/curatormd.py \
     --project-root /home/eaglesvn/dockerz/gptmd --profile gptmd-coding recover RECORD_ID
   ```

   Legacy transactions without a saved hash require the explicit
   `--accept-current-target` option only after deciding the current file is the
   correct recovery baseline. If the proposal is wrong and unfinalized, submit
   a corrected `curation_review` to supersede it. Never reset, overwrite, or
   commit a file just to make recovery pass.

4. Verify with `persistence_status`, confirm whether the candidate is pending
   or finalized, and report the repair and any checks not run.

## Hermes and recovery

```bash
hermes -p gptmd-coding status
hermes -p gptmd-coding codex-runtime migrate --dry-run
sudo hermes gateway status --system
curl http://127.0.0.1:9119/
```

The trusted observer records bounded Hermes lifecycle projections into the
temporary inbox; detailed Codex app-server history remains in Hermes' own
profile/session stores. If the observer is unavailable, continue coding but
report degraded capture; do not claim complete app-server event coverage. If a
curator run reports a lock, wait for the other run or inspect the active process
before retrying.

## Enable another repository

Use `../curatormd/docs/ENABLE-REPO.md` and the onboarding script under
`/home/eaglesvn/dockerz/curatormd/plugins/curatormd/scripts/`. Choose a
unique Hermes profile plus a staggered daily slot. The script creates only
missing knowledge files and never commits changes or modifies application
source.

## Require explicit confirmation for priority five reviews

**Added:** 2026-09-30

## Require explicit confirmation for priority five reviews

**Beginning — trigger and context:** The user reported that CuratorMD documentation did not reflect important project work and that priority-5 confirmation still failed. GPTMD is a CuratorMD consumer; its canonical knowledge is held in four persistence Markdown files, while the shared implementation is owned by the sibling CuratorMD repository. The active gptmd-coding profile reported 47 inbox records and zero pending reviews. Inspection found 42 cue-only captures correctly held in scratch because no complete full-thread SDE had been submitted, plus a stale ignored review Markdown file that did not match the active queue.

**Middle — decisions and work:** The installed CuratorMD VS Code status extension was version 0.2.11 and its loaded code included the priority-5 modal and CLI confirmation flag. The shared MCP curation_review schema, however, marked confirm_priority_5 optional and did not instruct callers to ask the reviewer, although the runtime rejected priority 5 unless the value was true. The MCP schema and tool description were updated to require an explicit boolean and direct the caller to ask before sending true. The CuratorMD user guide now documents both the MCP and VS Code confirmation paths. A regression test covers rejection without confirmation, no finalization on rejection, success with confirmation, and the required MCP field. The canonical CuratorMD SOP records the cause and repair. GPTMD persistence files were not overwritten; a consumer procedure proposal was submitted for review.

**End — outcome and verification:** The CuratorMD suite passed all 26 tests; strict Pyright reported zero errors, warnings, or informations; Pylint errors-only, Node syntax validation, and git diff --check passed. The active GPTMD status still showed zero prior pending reviews before this proposal. The 42 cue-only records do not contain full project narratives, so they cannot establish which past work is important without reviewing their corresponding full Hermes sessions. This proposal remains pending human review; no GPTMD canonical file was changed by this action.

**Rationale:** The reusable consumer action is a review procedure covering complete SDE synthesis and explicit priority confirmation; shared implementation details are documented in CuratorMD's owner repository.

**Future utility:** Future GPTMD sessions can distinguish captured cue counts from reviewable SDE proposals, use the full relevant Hermes discussion with sde_parse for important work, and send an explicit confirmation boolean on every curation_review call. This prevents callers from treating cue-only inbox records as completed documentation or discovering the priority-5 requirement only after a failed review.

**Project impact:** Observed: the MCP schema and user guide now state the explicit confirmation contract; the regression test proves priority 5 stays unfinalized until confirmed, and all 26 CuratorMD tests plus static checks passed. Expected: callers will receive clearer review instructions and avoid the previous missing-argument rejection. Historical cue-only events remain unclassified until their source discussions are reviewed.

**Verification:** Observed: the MCP schema and user guide now state the explicit confirmation contract; the regression test proves priority 5 stays unfinalized until confirmed, and all 26 CuratorMD tests plus static checks passed. Expected: callers will receive clearer review instructions and avoid the previous missing-argument rejection. Historical cue-only events remain unclassified until their source discussions are reviewed.

<!-- curatormd:record_id=9732559541f9fcf5058073e8f241cf58;content_sha256=e3cba968218f201d7c6a0d0f19a6ec0e38791dc11d2bd0421d5f03d96bb0fcf8 -->
<!-- curatormd:fingerprint=421201cec500b975f3f1b5314ecbe83d3eb2a0cfa814bcf9bfedb3434c9e4f36 -->

## Cull redundant Nuxt editor extensions

**Added:** 2026-09-30

## Cull redundant Nuxt editor extensions

**Beginning — trigger and context:** The GPTMD editor had overlapping Nuxt/Vue extensions while the user was addressing an editor crash and reducing workspace overhead.

**Middle — decisions and work:** Removed redundant Nuxt-related editor extensions while retaining the core Nuxt, Vue, and Vuetify support needed by this project. The separate crash investigation traced renderer kills to host OOM pressure and increased persistent active swap; it did not establish an extension as the cause.

**End — outcome and verification:** The current VS Code inventory still includes Nuxt, Vue, and Vuetify tooling. No before/after extension inventory or measured memory change is available, so the cleanup is recorded without claiming it fixed the crash. The verified OOM/swap repair has its own review proposal.

**Future utility:** Future workspace maintenance can preserve essential framework support while avoiding redundant editor add-ons, and can keep extension cleanup distinct from evidence-based crash diagnosis.

**Project impact:** Observed: the active editor retains the framework tooling required for GPTMD; the host OOM was independently diagnosed and mitigated. Expected: fewer redundant extensions may reduce background work, but the effect was not measured.

**Verification:** Observed: the active editor retains the framework tooling required for GPTMD; the host OOM was independently diagnosed and mitigated. Expected: fewer redundant extensions may reduce background work, but the effect was not measured.

<!-- curatormd:record_id=eb95c465882f13c687c81c819637bac3;content_sha256=1176101f5a0312ca49a4886a0ce865218b0b977222a2a4376a8b1dce0110a0e0 -->
<!-- curatormd:fingerprint=dcf7eda862286588b90ca690bff7c1b1716620fda0d598d06c7389223a3e3480 -->

## Set a conservative BuildKit cache retention target

**Added:** 2026-09-30

## Set a conservative BuildKit cache retention target

**Beginning — trigger and context:** Docker storage review found containerd snapshots, images, and roughly 3.47 GB of BuildKit cache on a small host disk. The user wanted storage managed without removing active images, volumes, or services.

**Middle — decisions and work:** Installed docker-buildx and verified the default builder. Enabled BuildKit garbage collection in /etc/docker/daemon.json with a 3 GB defaultKeepStorage target, then restarted Docker and checked the Redis Stack and RedisInsight containers.

**End — outcome and verification:** Redis Stack returned healthy and RedisInsight remained running. A conservative cache prune reclaimed 0 B because the records remained protected or needed; cache was still about 3.217 GB. The configured threshold guides future collection and did not immediately free space. No images or volumes were pruned.

**Future utility:** Future disk maintenance can configure BuildKit retention while preserving active services and can distinguish a future cache policy from immediate reclamation.

**Project impact:** Observed: daemon GC configuration validated and Redis services recovered after restart; no cache bytes were reclaimed by the attempted prune. Expected: future eligible cache can be collected toward the 3 GB target without routine image or volume pruning.

**Verification:** Observed: daemon GC configuration validated and Redis services recovered after restart; no cache bytes were reclaimed by the attempted prune. Expected: future eligible cache can be collected toward the 3 GB target without routine image or volume pruning.

<!-- curatormd:record_id=68840525e30b7342b87e8fbd7aeab9a3;content_sha256=b0b178abc003bc40c14eadd35b44fe15eff9b85a70fe1ed691f14d10b09f4a78 -->
<!-- curatormd:fingerprint=84b19649e464f0b2236e019118bfcaa32d2a2b59ea0e80f1f52f4391d8c7267d -->
