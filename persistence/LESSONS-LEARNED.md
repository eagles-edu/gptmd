# Reusable lessons

CuratorMD lesson entries require a verified trigger, lesson, and preventative
rule. Do not add speculative or transcript-only observations.

## Keep CuratorMD profile binding in workspace settings

**Date:** 2026-09-26

**Lesson:** Trigger: repository status checks can target the wrong project's Hermes and CuratorMD state when curatormdStatus.profile is set in VS Code User settings shared by several workspaces. Lesson: bind each repository to its own Hermes profile at workspace scope. Preventative rule: set curatormdStatus.profile in that repository's .vscode/settings.json; for this workspace use vuepy05-coding. Do not put a repository-specific CuratorMD profile in VS Code User settings.

## Separate GPTMD implementation status from modernization targets

**Date:** 2026-09-30

**Lesson:** ## Separate GPTMD implementation status from modernization targets

**Beginning — trigger and context:** The modernization document mixed delivered work with the proposed product design, and its current-state diagnosis said OpenAI, Redis, and PostgreSQL clients did not exist even though the worktree now contains those adapters.

**Middle — decisions and work:** Added a short status table grouping the frontend contracts, API/provider infrastructure, and local data/diagram artifacts as implemented in the worktree, with patient workflows, app persistence, and production gates listed as planned. Rewrote the diagnosis to describe the actual health/readiness and generic Responses endpoint, optional provider/data clients, and the missing authenticated session workflow. Kept the detailed clinical architecture as a target and separated source presence from runtime proof.

**End — outcome and verification:** The document now states that configured adapters and health probes do not establish an end-to-end patient workflow, and makes the remaining implementation explicit. `npm run diagrams:check`, `npm run schemas:check`, and `git diff --check -- docs/plangpt-modernization.md` passed. No live provider request or patient workflow was claimed.

**Future utility:** Future contributors can use the status table to choose the next unfinished project task without reimplementing existing contracts/adapters or mistaking a design diagram for shipped behavior.

**Project impact:** Observed: generated diagram/schema artifacts remain synchronized and the edited document passes whitespace validation. Expected: clearer delivered-versus-planned status should reduce duplicate effort and keep implementation claims aligned with repository evidence.

**Trigger / root cause:** Future contributors can use the status table to choose the next unfinished project task without reimplementing existing contracts/adapters or mistaking a design diagram for shipped behavior.

**Preventative rule:** Observed: generated diagram/schema artifacts remain synchronized and the edited document passes whitespace validation. Expected: clearer delivered-versus-planned status should reduce duplicate effort and keep implementation claims aligned with repository evidence.

<!-- curatormd:record_id=493227acd9bc806c2541e80ea4979977;content_sha256=410b0d0d2c99f6a1fd8751dd27c42fed2403c3aaa48435fd6de77f78dd0f3340 -->
<!-- curatormd:fingerprint=83d0e9dd6ed14e04aad3f8fbcda5aa5552f772830d599200f6cb231f5e7e0519 -->

## Persist additional active swap after OOM diagnosis

**Date:** 2026-09-30

**Lesson:** ## Persist additional active swap after OOM diagnosis

**Beginning — trigger and context:** Two VS Code renderer terminations were reported on the GPTMD host. The investigation needed to establish whether this was an extension fault or system memory pressure before changing editor configuration.

**Middle — decisions and work:** VS Code logs were correlated with kernel logs. The 03:22 and 06:20 kills occurred under Linux OOM pressure with only 72 kB and 252 kB of swap free; a separate renderer exit code 135 remained unexplained. The host had 8 GiB RAM and about 5 GiB swap. Added a secured 5 GiB /swapfile-extra, activated it, and persisted it through /etc/fstab.

**End — outcome and verification:** Active swap reached about 9.9 GiB and the new file was mode 600. findmnt verification reported no parse errors and systemd recognized the escaped swap unit. This mitigates memory pressure; it does not prove future OOMs are prevented or explain the separate code 135 crash.

**Future utility:** Future host troubleshooting can distinguish evidenced kernel OOM kills from unrelated renderer failures and reuse the verified active-plus-persistent swap recovery steps.

**Project impact:** Observed: two VS Code kills correlated with near-exhausted swap, and active swap increased from about 5 GiB to 9.9 GiB. Expected: additional headroom may reduce memory-pressure terminations; no long-term prevention measurement was made.

**Trigger / root cause:** Future host troubleshooting can distinguish evidenced kernel OOM kills from unrelated renderer failures and reuse the verified active-plus-persistent swap recovery steps.

**Preventative rule:** Observed: two VS Code kills correlated with near-exhausted swap, and active swap increased from about 5 GiB to 9.9 GiB. Expected: additional headroom may reduce memory-pressure terminations; no long-term prevention measurement was made.

<!-- curatormd:record_id=ef23afcce4bc2ccb7d9cf093af7ce47d;content_sha256=c5542d7424ae7c89d0a8c3558f535e2216fa2a0c0a6e03897ee60d8d65f2df2a -->
<!-- curatormd:fingerprint=ba24f2ae031b3cfe89f796bb1fc8e32152086abc6e3348cd2b69051de3c1dfce -->

## Diagnose Hermes system gateway health mismatch

**Date:** 2026-10-02

**Lesson:** ## Diagnose Hermes system gateway health mismatch

**Beginning — trigger and context:** The GPTMD status indicator reported Hermes and Codex unhealthy even though Codex authentication was configured through ChatGPT. The user-level profile status and system-managed Hermes gateway could report different states, so the extension warning needed to be checked against the actual service manager.

**Middle — decisions and work:** Confirmed that Codex and Hermes both had ChatGPT authentication and that the `gptmd-coding` profile binding was correct. A user-service gateway start was rejected because the installation is configured as a system service; the target was corrected after the CLI identified that configuration. Host-level status then confirmed the system gateway was running, while `hermes -p gptmd-coding status` in the restricted shell still reported the profile gateway stopped and the workspace indicator stayed unhealthy. The environment could not observe systemd directly because sudo was blocked by no-new-privileges.

**End — outcome and verification:** Codex health was confirmed and the host reported the system Hermes gateway running, but the workspace Hermes health indication remained unresolved because its check inspected user-level profile status. No application or extension code was changed in this event. The existing recovery probe `sudo hermes gateway status --system` provides the host-side check; status integration still needs a future fix if the mismatch recurs.

**Future utility:** Preserves the distinction between Hermes system and user gateway status and the host-side command needed to verify a system-managed service when a workspace health check runs inside a restricted shell.

**Project impact:** Observed: the system gateway was running and Codex health was healthy while the workspace Hermes indicator remained unhealthy. Expected: checking the configured service manager avoids misdiagnosing a running system service as stopped. No persistent health-check repair was implemented.

**Trigger / root cause:** Preserves the distinction between Hermes system and user gateway status and the host-side command needed to verify a system-managed service when a workspace health check runs inside a restricted shell.

**Preventative rule:** Observed: the system gateway was running and Codex health was healthy while the workspace Hermes indicator remained unhealthy. Expected: checking the configured service manager avoids misdiagnosing a running system service as stopped. No persistent health-check repair was implemented.

<!-- curatormd:record_id=b20a9cc19a624a0eb835fac1920e94c7;content_sha256=215659e3f018033c834c4462b0b25bc4a8b313d6ea0986cf6c910c50392e3266 -->
<!-- curatormd:fingerprint=71c9db6d6d1b89168e500c99a807e0d837f89275c48f2e702eedad4b7fd454e6 -->
