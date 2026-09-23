---
name: gptmd-memory
description: Use for project memory, persistence, session handoffs, architecture decisions, repeatable procedures, verified failures, lessons learned, or improving project instructions across Codex sessions.
---

# Gptmd Memory

Use the project's `persistence/` documents as the durable, reviewable knowledge
layer. The application source remains outside this plugin's write boundary.

## Authority

- `persistence/AGENTS.md`: current active rules that every agent should follow.
- `persistence/SOP.md`: repeatable procedures and verification steps.
- `persistence/HISTORY.md`: dated decisions and their rationale.
- `persistence/LESSONS-LEARNED.md`: verified failures, fixes, and prevention.

Treat Codex's built-in memory as supplemental recall. Treat these project files
as the source of truth for project-specific operating knowledge.

## Session workflow

1. Before a non-trivial task, call `persistence_status` and then
   `memory_recall` with the task's key terms.
2. Read the returned entries before choosing an implementation path.
3. Work normally, keeping changes scoped to the user's request.
4. After a durable architecture, security, deployment, or toolchain decision,
   call `persistence_record` with `kind=decision`.
5. After a failure has been fixed and verified, call
   `self_improvement_capture`. Record the trigger, root cause, fix, and a
   preventative rule or test.
6. Before finishing, call `persistence_status` again and report any knowledge
   files changed. Do not commit automatically.

## What is durable

Record information that will change a future session's behavior: constraints,
decisions, commands that are known to work, failure patterns, security rules,
and recovery procedures. Do not record greetings, raw transcripts, temporary
thoughts, generated output, or routine status.

Summarize logs before recording them. Never store passwords, API keys, tokens,
private keys, connection strings, or unredacted secrets. The MCP server rejects
common credential patterns, but the agent must still redact deliberately.

## Self-improvement boundary

Self-improvement means improving reusable project knowledge from verified
evidence. It does not mean rewriting source code, plugin code, AGENTS rules, or
security controls without explicit user review. If a proposed rule is
uncertain, report it as a candidate instead of recording it as authoritative.

If MCP tools are unavailable, use the fallback commands from the repository:

```bash
python3 plugins/gptmd-memory/scripts/gptmd_memory.py status
python3 plugins/gptmd-memory/scripts/gptmd_memory.py search "your terms"
```
