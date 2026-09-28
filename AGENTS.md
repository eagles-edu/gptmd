# gptmd project contract

GPTMD is the medical-doctor application repository. CuratorMD is a separate
Markdown curation system that may be used by this repository. Do not treat this
repository as CuratorMD's system repository, or mix project roots, profiles,
native inboxes, state, or persistence records across repositories.

Before changing this repository, read `persistence/AGENTS.md` and use the
procedures in `persistence/SOP.md`. Durable project knowledge belongs only in
the four Markdown files under `persistence/`; CuratorMD inbox and state are
temporary and must never be committed.

Codex is the primary implementation lane. Hermes profile `gptmd-coding` owns
the project-local orchestration and Codex app-server runtime. Keep Copilot as
an attended inline or terminal assistant.

Always use the OpenAI developer documentation MCP server for OpenAI product,
API, plugin, or Codex questions.

Start each development task with a concise problem summary and success
criteria, then complete troubleshooting, remediation plan, implementation,
testing, and completion in that order. Do not stop at an error: diagnose it,
continue safe repair, and report manual and automatic recovery paths if blocked.
