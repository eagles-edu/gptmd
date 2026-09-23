# Two-Part Hermes / Codex / Copilot Environment and Knowledge-Curation Plan

## Summary

Build a Codex-primary coding environment with Hermes as the orchestration, persistence, and review layer; GitHub Copilot remains available in VS Code and terminal as a complementary assistant.

Then add a daily 06:00 Asia/Ho_Chi_Minh curator that converts durable project knowledge into reviewable Markdown updates. The curator never commits automatically and never edits application source.

Codex local memory remains enabled as a supplemental recall layer, but `AGENTS.md` and checked-in documentation are the authoritative project instructions, consistent with official OpenAI guidance. [OpenAI Docs: Codex memories](https://learn.chatgpt.com/docs/customization/memories)

## Part 1 — Stable AI Development Environment

- Create a project-scoped Hermes profile named `gptmd-coding`; authenticate both Hermes’ OpenAI Codex provider and the standalone Codex CLI, since their credentials are stored separately.
- Enable Hermes’ Codex app-server runtime in `gptmd-coding` for implementation sessions. Hermes will project Codex shell, file-change, and MCP events into Hermes session history and continue background memory/skill review. [Hermes Codex app-server runtime](https://hermes-agent.nousresearch.com/docs/user-guide/features/codex-app-server-runtime)
- Install and authenticate:
  - GitHub CLI (`gh`) for repository, issue, and PR operations.
  - GitHub Copilot CLI for terminal fallback.
  - GitHub Copilot in VS Code for inline assistance and chat.
- Retain the existing Codex VS Code extension as the primary editor agent. Codex owns workspace edits, sandboxing, patches, and task compaction; Copilot is not allowed to make unattended broad edits.
- Install the Hermes gateway as a system-level service running as `eaglesvn`, configured to start at boot. Keep the dashboard local-only at `127.0.0.1:9119`; do not add a public firewall rule.
- Create the initial local Git commit for the existing Nuxt starter after confirming or setting local Git author identity. This is the baseline for all later curation review.
- Run environment acceptance checks:
  - `hermes status`
  - `hermes --profile gptmd-coding codex-runtime migrate --dry-run`
  - `codex doctor`
  - `gh auth status`
  - Copilot CLI login/status
  - VS Code Copilot and Codex extension sign-in
  - `npm run build`
  - `curl http://127.0.0.1:9119/` returns HTTP 200

## Part 2 — CuratorMD per-project intelligence

CuratorMD is the local-first project-memory package shared by Codex and Hermes. **Mode A is mandatory:** all agent-driven coding for a repository begins in its Hermes-managed Codex app-server profile. There is no standalone-Codex capture path. Hermes therefore receives Codex's native projected shell, file-change, and MCP events in the coding profile's session history, and its background memory/skill review continues to run. [Hermes Codex app-server runtime](https://hermes-agent.nousresearch.com/docs/user-guide/features/codex-app-server-runtime)

Each repository is an isolated **project instance** with one `codex_app_server` Hermes profile, a CuratorMD state boundary, and one reviewable Markdown knowledge apparatus. This repository's profile is `gptmd-coding`; it owns the project's native Codex-projected sessions, Hermes memory, skills, scheduler, and CuratorMD state. Do not run a second Hermes process against it. Hermes profiles intentionally do not share memory or session history. [Hermes profiles](https://hermes-agent.nousresearch.com/docs/user-guide/profiles)

- A trusted, project-local native-projection inbox is written from the coding profile's already-projected Codex events—not by standalone Codex hooks. It is the daily curator's bounded input inside the same profile, not a cross-profile bridge.
- Live chat-history search is a separate interactive concern: open `gptmd-coding` in the Hermes GUI and start the next query on the default runtime (`/codex-runtime auto`) when `session_search` is needed. Its session database remains in the same project profile. Switch the next coding session back to `codex_app_server`.

- Keep Codex as the direct project coding lane. It owns source edits, tests, sandboxing, and task execution in this repository through Hermes Mode A.
- Package CuratorMD as a shared local Skill plus stdio MCP server. Its machine-safe identifier is `curatormd`; its user-facing name is **CuratorMD**. Every MCP call requires an explicit absolute `project_root`, which must resolve to this Git worktree root and contain `persistence/`.
- Create these canonical project knowledge files with clear ownership:
  - Root `AGENTS.md`: compact bootstrap contract that directs agents to the persistence boundary.
  - `persistence/AGENTS.md`: current active rules, commands, security constraints, and architecture invariants.
  - `persistence/SOP.md`: repeatable procedures for development, tests, Docker, deployment, Hermes/Codex operation, and recovery.
  - `persistence/HISTORY.md`: dated, append-only architectural and operational decisions.
  - `persistence/LESSONS-LEARNED.md`: reusable failures, avoided approaches, and corrections.
- Add `environment_snapshot(project_root)` to CuratorMD. It reads only safe repository metadata: Git state, approved stack manifests, CI/container markers, known commands, and persistence health. It never reads `.env`, credentials, private keys, unrelated repositories, or process memory.
- Use a trusted, project-scoped Hermes CuratorMD observer to write bounded, secret-redacted native-projection records under `.curatormd/native-inbox/`. This Git-ignored, non-canonical, owner-readable queue is retained for 30 days. If the observer is unavailable or untrusted, coding continues but the project reports degraded curation capture; it never claims complete coverage. The inbox is not a Mode B fallback.
- Register one `gptmd-coding` cron job at 06:00 Asia/Ho_Chi_Minh with this repository as its absolute `workdir` and continuity enabled. Assign every additional repository a distinct later slot (for example, 06:15, 06:30). Set the host scheduler's `cron.max_parallel_jobs: 1`, and acquire a project-local CuratorMD curation lock before writing, so delayed/manual runs also cannot overlap. The job:
  - Reads this project's native-projection inbox, safe environment snapshot, persistence documents, and Git diff. The Git diff admits the effects of manual or external edits without pretending they are Hermes chat history.
  - Identifies only verified, durable rules, decisions, repeatable procedures, or broadly reusable lessons.
  - Writes only reviewed knowledge to the four persistence documents and leaves resulting changes uncommitted.
  - Stores source IDs, fingerprints, cursors, schedule slot, lock state, and idempotency state in the project profile's CuratorMD `PLUGIN_DATA`.
  - Reports ambiguous candidates without writing them.
  - Never writes secrets, credentials, personally sensitive information, temporary task notes, generated directories, or application source.
  - Never runs `git add`, `git commit`, push, deployment, migrations, or destructive commands. [Hermes cron workdirs](https://hermes-agent.nousresearch.com/docs/user-guide/features/cron)
- Define a manual high-value-decision workflow: after a major architecture, security, deployment, or toolchain decision, use CuratorMD to record verified knowledge immediately instead of waiting for the daily job.
- Use this authority model:

  | Store | Authority |
  |---|---|
  | Hermes memory and sessions in `gptmd-coding` | Project-local interactive recall, native history, and background self-improvement |
  | `.curatormd/native-inbox/` | Redacted, temporary native-projection input for the same project's daily curator |
  | Codex local memory | Supplemental local recall only |
  | Root `AGENTS.md` | Bootstrap pointer to the project knowledge contract |
  | `persistence/AGENTS.md` | Current project rules every agent must follow |
  | `persistence/SOP.md` | Repeatable operational procedures |
  | `persistence/HISTORY.md` | Dated decisions and rationale |
  | `persistence/LESSONS-LEARNED.md` | Durable mistakes and preventative guidance |

## Curation Contract and Safety Rules

- The canonical durable write boundary is the four `persistence/*.md` documents. `.curatormd/native-inbox/` is the only exception: it holds temporary, redacted, non-canonical projection records and is never committed.
- `persistence/AGENTS.md` contains only active, actionable rules; historical explanation belongs in `HISTORY.md`.
- `HISTORY.md` entries require date, decision, rationale, and impact.
- `LESSONS-LEARNED.md` entries require trigger, lesson, and preventative rule.
- CuratorMD validates `project_root` and fails closed if the root is missing, outside the Git worktree, or lacks `persistence/`.
- If the working tree contains unresolved or conflicting edits to a knowledge document, the curator exits without modifying that document and reports the conflict.
- The curator runs under `eaglesvn`, not root; Hermes credentials remain in user-owned configuration paths and are never copied into repository files.

## Test Plan

- Verify that each repository's `-coding` profile is isolated from every other repository: memory, sessions, skills, scheduler state, CuratorMD state, inbox records, and durable documents must not mix.
- Validate CuratorMD discovery and MCP initialization in both Codex and Hermes.
- Verify valid roots, invalid roots, nested directories, symlinks, and Git worktrees; all invalid roots must fail closed.
- Verify the trusted Hermes observer creates correctly scoped native-projection records, secret-like content is redacted or rejected, and observer failures leave coding functional while reporting degraded mode.
- Run an initial curator job manually, inspect `git diff`, and confirm it writes only persistence documents plus temporary CuratorMD inbox/state.
- Verify duplicate source IDs do not duplicate durable entries and ambiguous evidence is reported without changing Markdown.
- Verify the 06:00 job uses this repository as its workdir, cannot overlap another project job or a locked local run, does not require live `session_search`, does not expose port `9119`, alter firewall rules, commit changes, push, deploy, or write secrets.

## Assumptions

- Codex remains the primary implementation agent; Copilot is inline/terminal support and an optional fallback.
- This repository's daily curation slot is 06:00 Asia/Ho_Chi_Minh; each later repository receives a unique, staggered slot and the host allows one curator at a time.
- Curation updates remain uncommitted until you review them.
- CuratorMD is local-only in v1: no external memory provider, remote database, continuous filesystem watcher, or automatic source-code modification.
