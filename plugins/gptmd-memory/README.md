# Gptmd Memory

Gptmd Memory is a local-first Codex plugin for three gaps in long-running coding
work:

1. **Memory** — search durable project knowledge before acting.
2. **Persistence** — record decisions, procedures, active rules, and lessons in
   reviewable Markdown under `persistence/`.
3. **Self-improvement** — capture verified failures and fixes as reusable lessons.

The plugin never commits, pushes, edits application source, or sends project
knowledge to a remote service. It refuses obvious credentials and only writes
inside the project's `persistence/` directory.

## Stores

| Store | Purpose |
| --- | --- |
| `AGENTS.md` | Current active rules |
| `SOP.md` | Repeatable procedures |
| `HISTORY.md` | Dated decisions and rationale |
| `LESSONS-LEARNED.md` | Verified failures, fixes, and prevention |

## MCP tools

- `memory_recall` — search the four persistence documents.
- `persistence_status` — inspect document health and working-tree status.
- `persistence_record` — append a durable decision, procedure, rule, or lesson.
- `self_improvement_capture` — record a verified failure/fix lesson.

The plugin discovers the project root from `GPTMD_PROJECT_ROOT` or by walking
upward from the workspace and looking for `persistence/` and `package.json`.

## Safety boundary

This is evidence-based self-improvement, not autonomous self-modifying code.
The model may record a lesson after verification, but it must not silently
rewrite the plugin, application source, or project rules.
