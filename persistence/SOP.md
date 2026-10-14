# Standard operating procedures

## Keep SDE cue captures out of scratch

Automatic CuratorMD captures use the `sde_cue_capture` type and remain in the
native inbox for later full-thread synthesis. They are not individual review
candidates and do not need scratch files or manual dispositions. When cleaning
older scratch copies, first confirm each record ID and complete payload match
the corresponding native-inbox source, then remove only those redundant copies.

## Five-stage development workflow

Start with a concise summary of the problem, intended result, and success
criteria. Then complete these stages in order:

1. **Troubleshooting:** inspect the relevant code, configuration, state, diffs,
   and actual error. Identify the cause and preserve existing user data.
2. **Plan remediation:** state the smallest safe repair, its expected result,
   recovery options, and how it will be verified.
3. **Implementation:** apply the approved repair and update the relevant
   project rules or procedures.
4. **Testing:** add or strengthen a regression test that fails against the
   original defect, then run the focused tests and full `npm run check` suite.
   Do not close a fix with only a smoke test or an unverified build.
5. **Completion:** inspect the final diff and runtime state; report what
   changed, the verification evidence, limitations, and manual/automatic
   recovery paths.

Do not stop at the first error. Continue diagnosis and safe repair; if blocked,
give the cause and an actionable remediation plan.

## Resolve all discovered diagnostics

Always fix every error, warning, and other actionable diagnostic discovered
while carrying out a task, including diagnostics emitted by required build,
lint, type-check, and test commands. Trace each diagnostic to its owning source,
configuration, or dependency and repair it there; do not suppress it, relabel it
as harmless, or leave it as a known warning. Rerun the command that exposed it
and confirm the diagnostic is gone. If a diagnostic cannot be fixed safely in
the current task, keep the task incomplete and report the exact blocker, the
evidence, and the concrete repair needed; a successful exit code does not make
the task complete while actionable diagnostics remain.

## Maintain regression coverage

Every bug fix adds or updates an automated test for the observed failure and
the repaired behavior. A warning fix also tests the setting, source transform,
or build output that prevents that warning from returning. Run `npm run check`
before completion; do not weaken or skip an existing check to make a change
pass. Keep the unit, browser, type, lint, API, and clean-build checks in that
command and in continuous integration.

## Start a coding session

1. Work from the Git worktree root: `/home/eaglesvn/dockerz/gptmd`.
2. Read `persistence/AGENTS.md`, then search the four persistence documents for the task terms.
3. Use the `gptmd-coding` Hermes profile for agent-driven coding. Keep the Codex app-server runtime selected for implementation sessions.

## Verify the Nuxt project

```bash
npm run check
git status --short
```

The check suite is authoritative for this starter. Its build fails on warnings
or errors so new diagnostics cannot pass unnoticed.

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

## Require explicit confirmation for priority five reviews

**Added:** 2026-09-30

## Require explicit confirmation for priority five reviews

**Beginning — trigger and context:** The user reported that CuratorMD documentation did not reflect important project work and that priority-5 confirmation still failed. GPTMD is a CuratorMD consumer; its canonical knowledge is held in four persistence Markdown files, while the shared implementation is owned by the sibling CuratorMD repository. The active gptmd-coding profile reported 47 inbox records and zero pending reviews. Inspection found 42 cue-only captures correctly held in scratch because no complete full-thread SDE had been submitted, plus a stale ignored review Markdown file that did not match the active queue.

**Middle — decisions and work:** The installed CuratorMD VS Code status extension was version 0.2.11 and its loaded code included the priority-5 modal and CLI confirmation flag. The shared MCP curation_review schema, however, marked confirm_priority_5 optional and did not instruct callers to ask the reviewer, although the runtime rejected priority 5 unless the value was true. The MCP schema and tool description were updated to require an explicit boolean and direct the caller to ask before sending true. The CuratorMD user guide now documents both the MCP and VS Code confirmation paths. A regression test covers rejection without confirmation, no finalization on rejection, success with confirmation, and the required MCP field. The canonical CuratorMD SOP records the cause and repair. GPTMD persistence files were not overwritten; a consumer procedure proposal was submitted for review.

**End — outcome and verification:** The CuratorMD suite passed all 26 tests; strict Pyright reported zero errors, warnings, or informations; Pylint errors-only, Node syntax validation, and git diff --check passed. The active GPTMD status still showed zero prior pending reviews before this proposal. The 42 cue-only records do not contain full project narratives, so they cannot establish which past work is important without reviewing their corresponding full Hermes sessions. This proposal remains pending human review; no GPTMD canonical file was changed by this action.

**Rationale:** The reusable consumer action is a review procedure covering complete SDE synthesis and explicit priority confirmation; shared implementation details are documented in CuratorMD's owner repository.

**Future utility:** Future GPTMD sessions can distinguish captured cue counts from reviewable SDE proposals, use the full relevant Hermes discussion with sde_parse for important work, and send an explicit confirmation boolean on every curation_review call. This prevents callers from treating cue-only inbox records as completed documentation or discovering the priority-5 requirement only after a failed review.

**Project impact:** Observed: the MCP schema and user guide now state the explicit confirmation contract; the regression test proves priority 5 stays unfinalized until confirmed, and all 26 CuratorMD tests plus static checks passed. Expected: callers will receive clearer review instructions and avoid the previous missing-argument rejection. Historical cue-only events remain unclassified until their source discussions are reviewed.

**Verification:** Observed: the MCP schema and user guide now state the explicit confirmation contract; the regression test proves priority 5 stays unfinalized until confirmed, and all 26 CuratorMD tests plus static checks passed. Expected: callers will receive clearer review instructions and avoid the previous missing-argument rejection. Historical cue-only events remain unclassified until their source discussions are reviewed.

<!-- curatormd:record_id=9732559541f9fcf5058073e8f241cf58;content_sha256=e3cba968218f201d7c6a0d0f19a6ec0e38791dc11d2bd0421d5f03d96bb0fcf8 -->
<!-- curatormd:fingerprint=421201cec500b975f3f1b5314ecbe83d3eb2a0cfa814bcf9bfedb3434c9e4f36 -->

## Cull redundant Nuxt editor extensions

**Added:** 2026-09-30

## Cull redundant Nuxt editor extensions

**Beginning — trigger and context:** The GPTMD editor had overlapping Nuxt/Vue extensions while the user was addressing an editor crash and reducing workspace overhead.

**Middle — decisions and work:** Removed redundant Nuxt-related editor extensions while retaining the core Nuxt, Vue, and Vuetify support needed by this project. The separate crash investigation traced renderer kills to host OOM pressure and increased persistent active swap; it did not establish an extension as the cause.

**End — outcome and verification:** The current VS Code inventory still includes Nuxt, Vue, and Vuetify tooling. No before/after extension inventory or measured memory change is available, so the cleanup is recorded without claiming it fixed the crash. The verified OOM/swap repair has its own review proposal.

**Future utility:** Future workspace maintenance can preserve essential framework support while avoiding redundant editor add-ons, and can keep extension cleanup distinct from evidence-based crash diagnosis.

**Project impact:** Observed: the active editor retains the framework tooling required for GPTMD; the host OOM was independently diagnosed and mitigated. Expected: fewer redundant extensions may reduce background work, but the effect was not measured.

**Verification:** Observed: the active editor retains the framework tooling required for GPTMD; the host OOM was independently diagnosed and mitigated. Expected: fewer redundant extensions may reduce background work, but the effect was not measured.

<!-- curatormd:record_id=eb95c465882f13c687c81c819637bac3;content_sha256=1176101f5a0312ca49a4886a0ce865218b0b977222a2a4376a8b1dce0110a0e0 -->
<!-- curatormd:fingerprint=dcf7eda862286588b90ca690bff7c1b1716620fda0d598d06c7389223a3e3480 -->

## Set a conservative BuildKit cache retention target

**Added:** 2026-09-30

## Set a conservative BuildKit cache retention target

**Beginning — trigger and context:** Docker storage review found containerd snapshots, images, and roughly 3.47 GB of BuildKit cache on a small host disk. The user wanted storage managed without removing active images, volumes, or services.

**Middle — decisions and work:** Installed docker-buildx and verified the default builder. Enabled BuildKit garbage collection in /etc/docker/daemon.json with a 3 GB defaultKeepStorage target, then restarted Docker and checked the Redis Stack and RedisInsight containers.

**End — outcome and verification:** Redis Stack returned healthy and RedisInsight remained running. A conservative cache prune reclaimed 0 B because the records remained protected or needed; cache was still about 3.217 GB. The configured threshold guides future collection and did not immediately free space. No images or volumes were pruned.

**Future utility:** Future disk maintenance can configure BuildKit retention while preserving active services and can distinguish a future cache policy from immediate reclamation.

**Project impact:** Observed: daemon GC configuration validated and Redis services recovered after restart; no cache bytes were reclaimed by the attempted prune. Expected: future eligible cache can be collected toward the 3 GB target without routine image or volume pruning.

**Verification:** Observed: daemon GC configuration validated and Redis services recovered after restart; no cache bytes were reclaimed by the attempted prune. Expected: future eligible cache can be collected toward the 3 GB target without routine image or volume pruning.

<!-- curatormd:record_id=68840525e30b7342b87e8fbd7aeab9a3;content_sha256=b0b178abc003bc40c14eadd35b44fe15eff9b85a70fe1ed691f14d10b09f4a78 -->
<!-- curatormd:fingerprint=84b19649e464f0b2236e019118bfcaa32d2a2b59ea0e80f1f52f4391d8c7267d -->

## Reclaim Space from Unused Supabase Images

**Added:** 2026-10-02

## Reclaim Space from Unused Supabase Images

**Beginning — trigger and context:** On the 60 GB root filesystem, usage had reached 51 GB (84%) with 9.8 GB free, and /var/lib/containerd had grown to about 14 GB. The configured BuildKit cache was 3.217 GB, near the project’s retained 3 GB target, so cache pruning was not the appropriate first action. The request was to relieve containerd disk pressure while preserving active containers, images, volumes, and the cache reserve.

**Middle — decisions and work:** Inspected df/df -i, Docker 29.1.3 storage configuration, docker system df -v, all containers and images, containerd content/snapshot usage, and the active Supabase Compose configuration. The active Supabase stack contained only api-gw, db, and auth; the six cached images for realtime, storage-api, studio, edge-runtime, postgres-meta, and supavisor were unused by any running or stopped container and were absent from the active service list. Removed only those image tags with docker image rm, allowing Docker/containerd metadata and shared layers to be handled by the runtime. Left all seven active containers, four volumes, remaining images, BuildKit cache, and daemon configuration intact. An ops Compose ps check could not interpolate POSTGRES_DB in the current shell environment; verified the running database directly with docker inspect and pg_isready instead.

**End — outcome and verification:** After removal, root usage fell to 45 GB (75%) with 16 GB free, and /var/lib/containerd fell to 7.5 GB, reclaiming about 6 GB. All seven containers remained running; Supabase auth, Supabase DB, Supabase Envoy, ops PostgreSQL, and Redis Stack reported healthy, Redis returned PONG, and both PostgreSQL servers accepted connections. The 3.217 GB BuildKit cache and all volumes were unchanged. Docker's summary still reported 6.269 GB reclaimable for images although the detailed listing showed five remaining unused non-Supabase images totaling about 0.9 GB; this estimate discrepancy was not investigated. The disk-pressure repair completed without service interruption; the removed Supabase images will be pulled again if those services are enabled later.

**Future utility:** Provides a conservative containerd cleanup path for this host: compare filesystem usage with Docker's image/cache accounting, verify the active Compose service set and container references, remove only clearly unused image tags via Docker, preserve volumes and the build-cache reserve, then verify disk space and dependent service health. Avoid deleting containerd snapshot/content files directly or using a broad system prune.

**Project impact:** Observed: about 6 GB of root filesystem space was recovered and containerd usage decreased by about 6.5 GB; all running containers remained healthy and database/Redis probes succeeded. Expected: checking configured services and container references before image removal reduces the risk of interrupting active workloads or deleting persistent data. The residual Docker reclaimable-space estimate remains unexplained.

**Follow-up:** If additional space is needed, investigate the mismatch between docker system df's 6.269 GB reclaimable estimate and detailed image references before removing other images; inspect current service and volume state again because these measurements change over time.

**Verification:** Observed: about 6 GB of root filesystem space was recovered and containerd usage decreased by about 6.5 GB; all running containers remained healthy and database/Redis probes succeeded. Expected: checking configured services and container references before image removal reduces the risk of interrupting active workloads or deleting persistent data. The residual Docker reclaimable-space estimate remains unexplained.

<!-- curatormd:record_id=90e2cb6484262618edecdfeaf5c9cc43;content_sha256=d9f60b7ab4c7e1201fb734b55235b3a9e08ca55edcc97bae26eddee58d38ca42 -->
<!-- curatormd:fingerprint=ec1d6097247698847142e6565415b597d8745d8230e2586c41129665303449df -->

## Remove unused Docker images conservatively

**Added:** 2026-10-02

## Remove unused Docker images conservatively

**Beginning — trigger and context:** Docker storage accounting showed multiple reclaimable image tags and a large BuildKit cache, but active containers depended on the remaining images. The cleanup needed to recover confirmed unused image data while preserving services, volumes, and cache that had not been proven safe to remove.

**Middle — decisions and work:** Compared image references with running containers and separated confirmed unused image tags from layers used by active workloads. Removed five unused image tags through Docker, leaving all nine running containers and four volumes intact. Did not delete raw containerd or OverlayFS files, and did not remove active images when Docker's reclaimable estimate conflicted with container references. The later accounting still showed about 3.921 GB marked reclaimable, so that estimate was retained as an unresolved discrepancy.

**End — outcome and verification:** The five-tag image removal reported 238.2 MB reclaimed. Redis returned PONG, both PostgreSQL containers accepted connections, and all nine containers and four volumes remained intact. The additional reported reclaimable image data was not removed because its references were inconsistent; the event records a partial cleanup rather than a full disk-reclamation result.

**Future utility:** Provides a repeatable safe cleanup rule: validate image use against active containers, remove only clearly unused tags through Docker, preserve volumes and active images, and investigate accounting mismatches before further deletion.

**Project impact:** Observed: 238.2 MB was reclaimed while all nine running containers and four volumes remained intact and service probes succeeded. Expected: reference checks and Docker-managed removal reduce risk to active workloads and storage metadata. The residual reclaimable-space estimate remains unexplained.

**Follow-up:** Reinspect current Docker image references and cache state before further cleanup; do not rely on the unresolved reclaimable estimate alone.

**Verification:** Observed: 238.2 MB was reclaimed while all nine running containers and four volumes remained intact and service probes succeeded. Expected: reference checks and Docker-managed removal reduce risk to active workloads and storage metadata. The residual reclaimable-space estimate remains unexplained.

<!-- curatormd:record_id=8705cd21d024b1b845925f7cf29ba88d;content_sha256=2ffe96f58304078014ac8d4725cd493d20ba04f1950fa3313d86e4a0c045d72f -->
<!-- curatormd:fingerprint=d2b0fec99ed6ba8164b26c3b520864a9d276bba4491094659d78397668f49ece -->

## Install and activate GPTMD Node through nvm

**Added:** 2026-10-12

## Install and activate GPTMD Node through nvm

**Beginning — trigger and context:** A GPTMD shell could not run `nvm use` because the `nvm` command was unavailable. The repository requires Node >=24 <25 and pins Node 24 in `.nvmrc`; the task was to make the project runtime selectable through nvm.

**Middle — decisions and work:** Checked the project version pin and shell setup. Installed nvm in the user's home directory and configured Bash startup to load `~/.nvm/nvm.sh` and its completion script. Used the repository `.nvmrc` to install and select Node 24.21.0 rather than adding another runtime version.

**End — outcome and verification:** A fresh interactive Bash shell loaded nvm 0.40.6, `nvm use` selected Node v24.21.0, and npm reported 11.19.0. The current checkout also confirms `nvm install` reports v24.21.0 already installed and `nvm use` selects it. No application tests were run because this was a user-level runtime setup.

**Rationale:** Records how to restore the project Node runtime when Bash does not recognize nvm, while keeping the version aligned with `.nvmrc`, package engine ranges, and CI.

**Future utility:** Future GPTMD shell setup can source nvm from Bash startup and use `.nvmrc` to install/select the supported runtime.

**Project impact:** Observed: a fresh interactive Bash shell can resolve nvm and select the pinned Node and npm versions. Expected: this makes project commands consistently use the runtime declared by the repository; application behavior was not tested.

**Verification:** Observed: a fresh interactive Bash shell can resolve nvm and select the pinned Node and npm versions. Expected: this makes project commands consistently use the runtime declared by the repository; application behavior was not tested.

<!-- curatormd:record_id=f57faa169f22591ec64fb9e3f367fee3;content_sha256=0d685690197a0cf19c5f817d9f61495e26f00553e03db8f8ddd8c673620b9cb9 -->
<!-- curatormd:fingerprint=04428a6a43d339979bb7e8f5a7d19b7fdf05950f5894e62a4b07932580fdb827 -->

## Reuse authenticated desktop Chrome for OnePortal

**Added:** 2026-10-12

## Reuse authenticated desktop Chrome for OnePortal

**Beginning — trigger and context:** Repeated OnePortal work triggered another login cycle because an isolated Playwright browser profile was used even though the user's desktop Chrome already had an authenticated OnePortal session. The user asked to codify and repeat the successful method.

**Middle — decisions and work:** Launched the exact OneShield WAF URL with `google-chrome --new-tab 'https://portal.inet.vn/list-service/one-shield/waf/eaglesvn.club'`. Chrome reported that it opened the URL in the existing browser session. Captured the existing Chrome window and visually confirmed the authenticated OnePortal WAF Rules page for `eaglesvn.club`. This parent domain is the applicable WAF scope for the `obgyn` DNS host record. No credentials, cookies, or browser storage were accessed, and no WAF settings were changed.

**End — outcome and verification:** The authenticated desktop Chrome session was reused successfully and the parent-domain WAF page was visible. The repeatable entry command and verification approach are ready to record in the project SOP; the visual screenshot is current-turn evidence. An isolated Playwright profile remains separate and must not be treated as the authenticated browser.

**Future utility:** Prevents repeated sign-in requests by directing OnePortal work to the persistent desktop Chrome profile and checking the visible signed-in page before continuing.

**Project impact:** Observed: Chrome opened the requested WAF URL in its existing session and showed the authenticated OnePortal page. Expected: future work can resume authenticated portal tasks without repeating sign-in, while preserving secrets and avoiding accidental changes.

**Verification:** Observed: Chrome opened the requested WAF URL in its existing session and showed the authenticated OnePortal page. Expected: future work can resume authenticated portal tasks without repeating sign-in, while preserving secrets and avoiding accidental changes.

<!-- curatormd:record_id=14ac9226e487f64d679dfff15f464e93;content_sha256=05f0ddb79f1aaeaa4dc658ebf120ef79253684d075c763bb1c592324d7cd521c -->
<!-- curatormd:fingerprint=5668612a4b101d35d4cd1c50a6966bb1bf5eadd7f36af502b32546d7957cd82f -->

## Use the matching Chrome profile for live learner checks

For a real-account check, use the existing Chrome profile that owns that
account's app session. List only Chrome's profile catalog metadata to map a
profile directory to its display name and Google account:

```sh
jq -r '.profile.info_cache | to_entries[] | [.key, .value.name, (.value.user_name // "")] | @tsv' "$HOME/.config/google-chrome/Local State"
```

Launch the app in the matching profile, for example:

```sh
google-chrome --profile-directory='Profile 1' --new-tab 'https://obgyn.eaglesvn.club/'
```

The Chrome profile label or Google account alone is not proof of an app login.
Before testing, verify that the app itself displays the expected signed-in
identity and confirm its role and access status in Account. A single active
membership is auto-selected and has no dropdown. When multiple memberships are
listed, the selector starts blank: do not guess a default role or tenant; select
the intended workspace explicitly. Do not inspect cookies, tokens, or browser storage. Do not
substitute TinyFish or an isolated Playwright context for this real-account
check; those profiles do not share the user's authenticated Chrome session. If
the matching app session is absent, report that exact state without restarting
sign-in in another profile or asking the user to repeat a completed sign-in.
Encounter authorization uses the selected tenant; the app auto-selects only
when exactly one active membership exists.

## Treat unexpected public 403/5xx responses as release blockers

An unexpected 403 or 5xx on a user-facing route, login handoff, or required
asset is a live-site incident until the intended user path is restored. Do not
stop after identifying a likely layer or report an origin-versus-edge
attribution as a fix.

1. Capture the URL, time, status, response body, response/request IDs, and
   client class without exposing credentials or personal data.
2. Compare browser and command-line probes, then bypass the edge to test the
   origin directly. Correlate origin access/error logs with the response to
   identify whether Nginx, the upstream app, or the edge generated it.
3. Repair the confirmed generating rule or upstream fault. Preserve unrelated
   security controls; never disable bot/WAF protections or allowlist shared
   test egress without trace-level evidence and an approved narrow change.
4. Validate configuration before reload, reload only after validation, then
   retest the exact failing route through both origin and public ingress with
   the affected client class. Check required assets and a real browser render.
5. Keep the incident open if any affected user path still returns an
   unexplained 403/5xx. Record the live change, backup/recovery path, exact
   verification, and any separate edge classification requiring the provider.

`npm run deploy:live` runs the live OAuth authorization check before invoking
FreeFileSync. It probes local-origin Nginx and public ingress with the
previously affected `curl/8.5.0` User-Agent and requires the exact Google
callback redirect. A failure stops deployment before staging changes; diagnose
origin versus edge from which probe failed, repair the generating layer, then
rerun the verification and deployment.

For origin changes under `/etc/nginx`, preserve a timestamped backup, run
`sudo nginx -t` before reload, and verify `systemctl is-active nginx` plus the
public route afterward. A browser-style User-Agent on curl is only an HTTP
probe; it is not a substitute for browser rendering or completed OAuth.

## Keep live releases owned by the service account

Run `npm run deploy:live` as `eaglesvn`, matching the `User=` and `Group=` on
the web, API, and worker units. Before moving staging into releases, the deploy
script verifies every path has the invoking UID/GID and removes group/other
write bits while preserving executable bits. If ownership differs, stop and
diagnose the staging source; do not paper over it with recursive `chown`.
After deployment, verify the `current` symlink target, service owners, release
tree owners/modes, active services, loopback readiness, and affected public
routes. A symlink's displayed 777 mode is normal and does not represent the
target tree's permissions. Do not change owners or permissions on retained
rollback releases unless a concrete access failure requires it.

## Keep LiteSpeed read-only to the source checkout

On this host, LiteSpeed runs as `nobody` with supplementary group `eaglesvn`.
Because the GPTMD checkout is owned by `eaglesvn:eaglesvn`, group-write bits
would let the web worker modify source files. Keep owner write access, preserve
group read/traverse and executable bits, and remove only group-write from
regular files and directories. The development shell uses `umask 0002`, so set
default ACLs on checkout directories to keep inherited group/mask permissions
read-only:

```bash
root=/home/eaglesvn/dockerz/gptmd
find "$root" -xdev \( -type f -o -type d \) -perm /0020 -exec chmod g-w -- {} +
find "$root" -xdev -type d -exec setfacl -m d:u::rwx,d:g::r-x,d:m::r-x,d:o::r-x -- {} +
```

Verify all checkout paths remain owned by `eaglesvn:eaglesvn`, no regular file
or directory matches `-perm /0022`, and LiteSpeed can read a source file and
traverse the checkout but cannot write either. Do not remove LiteSpeed's
supplementary group without checking every served vhost path; read access is
intentional. The `deploy-live.mjs` release-tree guard separately enforces the
published release owner and mode policy.

## Identify OneShield edge denials by trace

Do not attribute a 403/5xx to OneShield from its appearance or a site-wide
analytics count alone. For a request that receives a OneShield trace, preserve
the trace ID, UTC timestamp, hostname, path, status/body fingerprint, and
client class. Exclude OAuth codes, state, cookies, authorization headers, and
other credentials from notes and support requests. Ask iNET/OneShield to
correlate that exact trace and return the generating layer, policy/rule ID,
rule category, matched signal, action, and sanitized event details.

Compare the trace with origin Nginx access/error logs at the same time and
request path. An absent origin request supports an edge denial; a matching
origin response must be diagnosed at Nginx, ModSecurity, or the upstream app
instead. For an edge event, distinguish custom/System WAF rules, bot
classification, rate limiting, and other access controls. Record the exact
rule and client signal before changing policy; aggregates, empty visible rule
tables, or a branded block page do not identify the cause. Do not allowlist a
shared test egress or alter a broad rule unless the trace proves that rule
caused an intended user's false positive and the change is approved.

The `eaglesvn.club` OneShield zone was explicitly switched off on 2026-10-13,
which affects every hostname in that parent zone. While it remains off, public
requests resolve directly to the origin and cannot produce a fresh OneShield
block trace for this hostname. Do not re-enable the zone just to generate a
trace. If protection is later restored, first confirm the intended scope and
capture a new trace from the affected client; otherwise ask iNET whether it
can provide the historical event details for the saved trace IDs. Keep
historical OneShield 403/502 traces distinct from origin-generated OAuth 403s.

## Resolve public CSP violations without weakening enforcement

1. Capture the exact failing URL and distinguish `Content-Security-Policy`
   from `Content-Security-Policy-Report-Only` in that navigation's response.
   A report-only message is diagnostic; it does not mean the browser blocked
   the resource.
2. Compare the effective upstream policy and edge response headers. Check for
   duplicated headers from the application and reverse proxy, and verify the
   actual inline-script hashes and external resource origins from served HTML.
3. Fix only the source mismatch: keep dynamic application CSP hashes aligned
   with built HTML, allow only required origins or move dependencies local,
   and keep Nginx as the public response-header emitter when it owns the site
   vhost. Do not add broad `unsafe-inline` or `https:` sources to silence a
   report.
4. Validate the proxy configuration before reload, then run a fresh browser
   navigation and confirm no CSP console diagnostics, required assets load,
   and the page still works. Treat unsupported directives in a captured
   policy as a source/cache discrepancy until they appear in fresh headers.

## Tune CRS false positives on OAuth callbacks

When an OAuth callback receives a ModSecurity 403, inspect the per-vhost error
log and ModSecurity audit transaction to identify the triggering CRS rule and
matched argument. Do not infer the source from the final anomaly-scoring rule
alone. OAuth `scope` values can contain URI-like strings that resemble file
paths to CRS rule `930120`.

For the GPTMD live host, the versioned exception is
`ops/modsecurity/gptmd-oauth-callback-exclusions.conf`. It removes only
`ARGS:scope` from rule `930120`, and only for host `obgyn.eaglesvn.club` and
path `/auth/v1/callback`; all other arguments and rules remain inspected. Use
`REQUEST_FILENAME` for the path match because `REQUEST_URI` includes the query
string. Install the versioned file under `/etc/modsecurity/crs/`, include it
from the active `REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf`, preserve a
timestamped backup, run `sudo nginx -t`, and reload only after validation.
Verify a callback-shaped request reaches GoTrue and returns its missing-state
response instead of a ModSecurity 403, then complete a fresh browser login and
check the app session. Do not log or share OAuth `code`, `state`, access tokens,
or refresh tokens. Record account authentication separately from workspace or
learner-role provisioning.

## Diagnose Google OAuth `org_internal`

If Google returns `403 org_internal` with a message that the app is available
only within its organization, treat it as a Google Cloud OAuth audience
restriction. It is distinct from `redirect_uri_mismatch`, an origin 403, a
Supabase Auth identity, and GPTMD tenant authorization. Google documents that
this error occurs when a request comes from outside the Cloud project's parent
organization.

For the named personal Gmail test client, use Google Auth Platform > Audience:
set **User type** to **External**, keep **Publishing status** at **Testing**,
and add the exact account under **Test users**. Do not publish the app or add
extra OAuth scopes merely to resolve `org_internal`. Verify the saved audience
and allowlist in Cloud Console, retry sign-in, and then confirm exactly one
active matching row exists in Supabase `auth.users` before provisioning any
GPTMD tenant. Add the exact test account even though Google documents an
exception where apps requesting only basic identity scopes (`openid`, `email`,
`profile`) may be available without the test-user allowlist. Therefore the
Google test-user list is not the GPTMD authorization boundary; active tenant
membership and entitlements remain that boundary. An OAuth redirect or consent
screen alone does not prove account creation. If the organization policy
prevents an External audience, stop and have its Cloud administrator authorize
the narrow test configuration rather than weakening GPTMD or origin access
controls.

## Administer tenant entitlements safely

GPTMD access authorization is based on the verified JWT `sub`, an active
`tenant_memberships` row, its database role, and the selected tenant's current
`tenant_entitlements` row. Do not authorize from a client-supplied email,
`user_metadata`, a submitted tenant ID, or stale capability claims in a JWT.
Supabase Auth authenticates the user; GPTMD PostgreSQL owns tenant membership,
role, feature flags, and quotas.

The account API exposes only the signed-in subject's active memberships. The
tenant control endpoints (`GET` and `PUT /api/admin/entitlements`) are available
only to an active `customer_admin` of the selected tenant. The selected tenant
is resolved from that subject's active membership, never from the request body.
Learners and instructors cannot access controls, and non-learners remain
blocked from encounter routes. Session and response operations recheck the
database flags and reserve quotas transactionally.

Policy writes validate the complete flag/limit set, lock the tenant row, then
commit the entitlement upsert and append-only before/after audit entry in one
transaction. Keep new or missing policies disabled by default. A `NULL` limit
means unlimited and zero denies use. Voice requires both the enable flag and
the explicit privacy approval flag, as well as available monthly quota. Apply
`services/api/migrations/025_tenant_entitlement_audit.sql` before deploying the
controls; `/readyz` checks for this schema.

The test account must first complete Google sign-in; this creates its Supabase
Auth identity. Supabase Auth and `gptmd_live` are separate databases. After the
first sign-in, run `npm run provision:scsstx-test`. The provisioner resolves
exactly one active UUID from `auth.users` in the `supabase-db` container,
verifies `gptmd_live` and migrations 024/025, then runs
`ops/sql/provision-scsstx-entitlement-test.sql` as `gptmd_live_app`. It refuses
a missing or ambiguous identity and refuses to overwrite an existing test
tenant. The seed validates the UUID, creates the isolated
`gptmd-entitlement-test-scsstx` tenant, grants only a tenant-scoped
`customer_admin` role, and initializes conservative quotas with all features
disabled; post-seed checks verify the role, quota values, and every feature
flag. It does not create or modify a Supabase Auth account. Do not add the email
to application authorization logic or activate features outside that test
tenant. After provisioning, refresh Account, confirm the tenant controls
appear, enable only the feature under test, and verify the API account response
plus the actual encounter/audio authorization path. Rollback by disabling all
flags and revoking the test membership in that isolated tenant; preserve audit
rows.

When the test user must act as a learner, retain that all-off control workspace
and run `npm run provision:scsstx-learner`. It creates a second isolated
`gptmd-learner-test-scsstx` membership with the `learner` role, text visits and
Responses enabled, finite quotas (5 visits and 50 Responses monthly, 12 per
visit, one active visit), and voice disabled with zero grants. It requires the
control workspace to remain all-off and refuses to overwrite an existing
learner workspace. The initial policy is written to the append-only audit. On
Account, select the workspace labeled `Learner`; its selected role and access
status should show learner visit access. To revoke test access, disable both
text flags from the customer-admin workspace controls or revoke only the
learner membership after inspecting outstanding session data; keep the audit.

To remove a test user's admin workspace, update only that user's active
`customer_admin` membership in the isolated control tenant to `status='revoked'`.
Do not delete the membership row: `app_sessions` references it with cascading
delete behavior. Before the update, resolve exactly one active Auth subject,
confirm the live target is `gptmd_live` as `gptmd_live_app`, inspect active
sessions, and confirm any separate learner membership. Revoke only when no
active control-tenant session would be disrupted. In a transaction, require
exactly one matching `(tenant_id, subject_id, role, status)` row to change;
afterward verify the learner row is still active and the append-only audit
history is unchanged. The revoked row remains for referential/history
preservation and is excluded from active account memberships.

If another test identity needs learner access, create a dedicated tenant rather
than adding it to the scsstx tenant. For the onlineadmin test profile, the
dedicated tenant is `gptmd-learner-test-onlineadmin`; provision an active
`learner` membership, the same bounded policy as the scsstx learner seed (5
monthly sessions, 50 monthly Responses, 12 per session, one active session),
voice disabled with zero audio quota, and an initial before/after audit entry
in one transaction. Resolve the Auth subject from Supabase Auth, refuse an
existing membership/tenant, and verify the exact role, flags, quotas, and audit
before commit. Never share a test learner tenant between identities.

The onlineadmin test profile uses both a dedicated learner tenant and a
separate customer-admin control tenant. After the exact Auth identity and live
database target are verified, run `npm run provision:onlineadmin-admin`. The
provisioner refuses to proceed unless the existing learner membership is
active with the expected bounded text-only policy, refuses an existing admin
tenant, and checks migrations 024/025. The single-statement seed creates
`gptmd-entitlement-test-onlineadmin` with an active `customer_admin` membership,
all capabilities disabled, finite baseline quotas, zero audio quota, and an
append-only initial policy audit. Verify both active rows and the rendered
Account selector; it must begin blank and require an explicit workspace choice.
To revoke only admin access, set that tenant membership to `status='revoked'`
without deleting its row or changing the learner tenant/session.

## Make git:update wait for NVM and pause on the editable commit message

**Added:** 2026-10-14

## Make git:update wait for NVM and pause on the editable commit message

**Beginning — trigger and context:** A task terminal reported that `git:update` committed a subject containing `nvm use` without the expected edit pause. The command ran under noninteractive `bash -c`, which skips `.bashrc`; the updater also placed the pause at the wrong prompt, so the intended Node initialization and editable message were not reliably reached.

**Middle — decisions and work:** The helper was iteratively corrected to put the auto-incremented suggestion directly on the editable `Suggested commit message:` line. A shell launcher now loads NVM and waits for `nvm use` to finish before starting the helper, including under the same noninteractive `bash -c` path. Regression tests and pseudo-terminal checks verified the Node version appears first, the process remains at the message editor, and no Git staging or publish action occurs before acceptance. Earlier accidental subjects had already been pushed and were left unchanged.

**End — outcome and verification:** The exact `bash -c 'npm run git:update'` path was verified to load Node 24.21.0 and remain waiting at the editable `gptMD-dev_0.0.0.18` message. Focused tests, lint, syntax checks, and the pseudo-terminal check passed. The corrected run remained unaccepted, unstaged, uncommitted, and unpushed.

**Future utility:** Future maintainers can use the NVM-loading launcher and pseudo-terminal regression path to preserve the message pause when VS Code tasks start a noninteractive Bash shell.

**Project impact:** Observed: the task command loaded the pinned Node version before opening the editable message and waited without staging, committing, or pushing. Expected: the guarded interactive flow prevents shell startup text from becoming an accidental commit subject.

**Follow-up:** The earlier mistaken commit subjects remain in the published history; the repair did not rewrite or revert them.

**Verification:** Observed: the task command loaded the pinned Node version before opening the editable message and waited without staging, committing, or pushing. Expected: the guarded interactive flow prevents shell startup text from becoming an accidental commit subject.

<!-- curatormd:record_id=6adacdbb9c29cc365c2539878ef66602;content_sha256=560aa2711777d6a212fd1d0125af1b2a40869e7d47e7cdc4d87912474f68745a -->
<!-- curatormd:fingerprint=7dccbaa2205e717a2d666cb085c36ee45b6132e4d49c529c86d64120b602e0f0 -->
