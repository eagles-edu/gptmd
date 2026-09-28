# Active project rules

- Treat this file and the other three files in `persistence/` as the project knowledge contract.
- Begin each development task with a concise summary and success criteria, then complete the five stages in order: troubleshooting, remediation plan, implementation, testing, completion.
- Keep durable knowledge concise, verified, and actionable. Put historical explanation in `HISTORY.md`.
- Use the OpenAI developer documentation MCP server for OpenAI product, API, plugin, or Codex questions.
- Never record credentials, tokens, private keys, connection strings, personal data, or raw transcripts.
- Keep `.curatormd/native-inbox/` temporary and redacted. It is not canonical knowledge and must not be committed.
- Use an absolute project root when calling CuratorMD. It must resolve to this Git worktree root and contain `persistence/`.
- Run `npm run build` after application changes. Report the existing Vuetify/Nuxt `useLayout` warning unless it is explicitly fixed.
- Keep the Express API as a separate service under `services/api/`; do not merge its runtime into Nuxt without an explicit architecture decision.
- Leave curation changes uncommitted for human review. CuratorMD must never add, commit, push, deploy, migrate, or delete project data.
- When an operation errors, analyze the cause and continue with safe repair and verification; if blocked, report the cause, a concrete repair plan, and manual and automatic healing paths.
- For SDE curation, inspect the full relevant thread and preserve substantive project meaning. Scrub secrets only; never promote cue-word fragments or generic filler, and never persist raw prompts, responses, tool arguments, or full transcripts.
- Shape one complete SDE proposal as beginning (trigger and context), middle (decisions and work), and end (outcome and verification); keep all three parts in the same candidate.
- On a failed CuratorMD approval, preserve the prepared transaction and all current persistence edits. Use automatic recovery or the documented manual recovery path; never reset or overwrite a knowledge file to bypass the conflict guard.
- Keep Hermes local-only: the dashboard binds to `127.0.0.1:9119`, and no public firewall rule is required.
