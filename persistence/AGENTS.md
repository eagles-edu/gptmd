# Active project rules

- Treat this file and the other three files in `persistence/` as the project knowledge contract.
- Keep durable knowledge concise, verified, and actionable. Put historical explanation in `HISTORY.md`.
- Use the OpenAI developer documentation MCP server for OpenAI product, API, plugin, or Codex questions.
- Never record credentials, tokens, private keys, connection strings, personal data, or raw transcripts.
- Keep `.curatormd/native-inbox/` temporary and redacted. It is not canonical knowledge and must not be committed.
- Use an absolute project root when calling CuratorMD. It must resolve to this Git worktree root and contain `persistence/`.
- Run `npm run build` after application changes. Report the existing Vuetify/Nuxt `useLayout` warning unless it is explicitly fixed.
- Leave curation changes uncommitted for human review. CuratorMD must never add, commit, push, deploy, migrate, or delete project data.
- Keep Hermes local-only: the dashboard binds to `127.0.0.1:9119`, and no public firewall rule is required.
