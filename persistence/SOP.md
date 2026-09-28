# Standard operating procedures

## Five-stage development workflow

Start every development task with a concise summary of the problem, intended
result, and success criteria. Then complete these stages in order:

1. **Troubleshooting:** inspect relevant source, state, configuration, diffs,
   and errors; identify the cause and preserve existing data.
2. **Plan remediation:** state the smallest safe fix, expected result, recovery
   options, and verification steps.
3. **Implementation:** apply the fix and update the governing project docs.
4. **Testing:** run focused tests and the broader checks required by the
   change; report anything that could not run.
5. **Completion:** inspect final diffs and runtime state; summarize changes,
   evidence, limitations, and manual/automatic recovery paths.

Never stop at the first error. Continue diagnosis and safe repair; if blocked,
give the cause and an actionable remediation plan.

## Five-stage development workflow

Start with a concise summary of the problem, intended result, and success
criteria. Then complete these stages in order:

1. **Troubleshooting:** inspect the relevant code, configuration, state, diffs,
   and actual error. Identify the cause and preserve existing user data.
2. **Plan remediation:** state the smallest safe repair, its expected result,
   recovery options, and how it will be verified.
3. **Implementation:** apply the approved repair and update the relevant
   project rules or procedures.
4. **Testing:** run the focused tests and broader checks required by the
   change. Report checks that could not run.
5. **Completion:** inspect the final diff and runtime state; report what
   changed, the verification evidence, limitations, and manual/automatic
   recovery paths.

Do not stop at the first error. Continue diagnosis and safe repair; if blocked,
give the cause and an actionable remediation plan.

## Start a coding session

1. Work from the Git worktree root: `/home/eaglesvn/dockerz/gptmd`.
2. Read `persistence/AGENTS.md`, then search the four persistence documents for the task terms.
3. Use the `gptmd-coding` Hermes profile for agent-driven coding. Keep the Codex app-server runtime selected for implementation sessions.

## Verify the Nuxt project

```bash
npm run build
git status --short
```

The build is authoritative for this starter. The current starter may report the
known `useLayout` auto-import collision warning from Vuetify and Nuxt.

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
