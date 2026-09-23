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
