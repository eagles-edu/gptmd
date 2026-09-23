# Standard operating procedures

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
python3 plugins/gptmd-memory/scripts/gptmd_memory.py --project-root /home/eaglesvn/dockerz/gptmd status
python3 plugins/gptmd-memory/scripts/gptmd_memory.py --project-root /home/eaglesvn/dockerz/gptmd snapshot
python3 plugins/gptmd-memory/scripts/gptmd_memory.py --project-root /home/eaglesvn/dockerz/gptmd --profile gptmd-coding curate --schedule-slot '06:00 Asia/Ho_Chi_Minh'
```

The snapshot reads only approved repository metadata. The curator may update
only reviewed entries in the four persistence files and leaves all changes
uncommitted. An ambiguous or conflicting candidate is reported without a write.

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

Use `docs/ENABLE-REPO.md` and choose a unique Hermes profile plus a staggered
daily slot. The onboarding script creates only missing knowledge files and
never commits changes or modifies application source.
