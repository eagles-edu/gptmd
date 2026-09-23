# CuratorMD

CuratorMD is the local-only project intelligence layer for Codex and Hermes.
It keeps durable knowledge in four reviewable Markdown files under a project's
`persistence/` directory and keeps unreviewed native observations in the
ignored `.curatormd/native-inbox/` directory.

The observer is project-scoped and best-effort. It records bounded, redacted
metadata from the configured Hermes profile; capture failure never blocks the
agent. A curator run can promote only an explicitly reviewed candidate. It
does not commit, push, deploy, run migrations, delete data, or modify
application source.

## MCP tools

- `memory_recall` — search the four persistence documents.
- `persistence_status` — inspect document health and CuratorMD state.
- `environment_snapshot` — collect safe project metadata without reading env
  values, credentials, private keys, or unrelated repository data.
- `native_projection_record` — append a redacted, idempotent native projection.
- `curation_run` — process the inbox and promote reviewed candidates only.
- `persistence_record` — append a reviewed durable decision, procedure, rule,
  or lesson.
- `self_improvement_capture` — record a verified failure/fix lesson.

All tools require an explicit absolute `project_root` that resolves to the
project's Git worktree root. The MCP server identifier is the machine-safe
`curatormd`; the plugin package remains `gptmd-memory` for marketplace
compatibility.

## Knowledge authority

- `persistence/AGENTS.md` — current active rules.
- `persistence/SOP.md` — repeatable procedures and verification steps.
- `persistence/HISTORY.md` — dated decisions and rationale.
- `persistence/LESSONS-LEARNED.md` — verified failures, fixes, and prevention.

The plugin refuses common credential patterns, uses owner-readable state, and
never sends project data to a remote service.
