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

## Preserve scene orientation and confidentiality cues in room images

**Date:** 2026-10-06

**Lesson:** A request to depict an exam-room entry door means the viewer is in the hallway unless the user says otherwise. Reversing the camera into the room changes the scene. Preserve the accepted camera side and composition, then inspect the whole frame against each explicit request before replacing the app asset. Check every visible door, including doors in the background: when they belong to the same room, repeat the exact room label (for example, “EXAM ROOM 4”) and use the same confidentiality treatment. Keep every patient chart fully concealed in a closed opaque jacket, with no patient information visible; do not mistake a bare panel or an open holder for a confidentiality jacket.

## Exercise the Realtime transcription commit boundary

**Date:** 2026-10-06

**Lesson:** A mocked `conversation.item.input_audio_transcription.completed` event can make a voice test pass even when the browser never commits its input audio. With Realtime transcription and `turn_detection: null`, use client-side speech detection to send `input_audio_buffer.commit` after speech ends. Test the microphone-energy-to-commit boundary, the silence threshold, one commit per utterance, and re-arming for the next utterance. Keep synthetic audio tests distinct from live microphone and provider verification.

## Delete rejected scenario content before deleting its Conversation

**Date:** 2026-10-06

**Lesson:** OpenAI Conversation deletion leaves its items behind. When setup generation fails or returns an invalid profile, delete and verify every Conversation item first, then delete the empty Conversation. If provider cleanup fails, persist only the Conversation ID for a retry worker; do not retain the profile or prompt in the cleanup queue. Keep the valid session Conversation only after setup items, including the answer key, have been cleared and verified.

## Separate OneDash site projects from shared host telemetry

**Date:** 2026-10-12

**Lesson:** ## Separate OneDash site projects from shared host telemetry

**Beginning — trigger and context:** The user considered deleting two OneDash setups and configuring sites manually, then asked to inspect /home. The initial repository-only search found no OneDash site configuration, so the scope shifted to host-level project and service state before recommending removal.

**Middle — decisions and work:** Inspection identified two OneDash Projects entries for eaglesvn.club and obgyn.eaglesvn.club under the shared /home/onedash account, not two independent agents. The desktop icon was only a browser shortcut. The OneDash-managed Nginx routes had concrete problems: the eaglesvn.club OpenLiteSpeed vhost referenced a missing vhconf.conf while only a disabled copy existed, and obgyn.eaglesvn.club routed to unused port 8089. Both sites-enabled links targeted missing files, and the proposed manual webroots did not exist. Separately, the host had a running OneDash telemetry agent with Vector and vmagent; /opt/onedash-otel had no active service. The recommendation was to build and validate manual Nginx/OpenLiteSpeed site routes first, remove the two Project entries afterward, and decide separately whether to stop telemetry. Keep acme.sh independent and preserve /home/onedash data and credentials.

**End — outcome and verification:** The thread ended with a concrete diagnosis and staged migration advice. No files or services were changed and neither OneDash Project was deleted. The on-disk findings establish broken or stale route configuration, but do not prove which configuration the already-running Nginx process had loaded.

**Rationale:** This is a verified host-configuration investigation and recovery plan; it preserves the limits of disk evidence and records that no destructive action occurred.

**Future utility:** For future host changes, identify project records, shared agents, and site data separately; validate replacement routes before removing management entries, and treat telemetry cleanup as a separate decision.

**Project impact:** Observed: the user now has evidence separating site-management entries from the shared monitoring agent and knows which route and webroot prerequisites are broken. Expected: staging manual routes before deletion reduces the chance of losing site data or telemetry during migration.

**Trigger / root cause:** For future host changes, identify project records, shared agents, and site data separately; validate replacement routes before removing management entries, and treat telemetry cleanup as a separate decision.

**Preventative rule:** Observed: the user now has evidence separating site-management entries from the shared monitoring agent and knows which route and webroot prerequisites are broken. Expected: staging manual routes before deletion reduces the chance of losing site data or telemetry during migration.

<!-- curatormd:record_id=42a62a53ac2ca01fd0e0964e790a80d0;content_sha256=ab84df24bf6fad2f296c39ec8f5593f34e3e686e2cc97f92e15bb662fc7d84d9 -->
<!-- curatormd:fingerprint=6bff13caeb7ed814da349a029286bfefb3a78d2368d8460dd7a33aa6c89bb868 -->

## Bound CuratorMD transcript reads to prevent Codex host OOM

**Date:** 2026-10-14

**Lesson:** ## Bound CuratorMD transcript reads to prevent Codex host OOM

**Beginning — trigger and context:** The user reported that a shared resource failure blanked the Codex panel and then crashed VS Code. Kernel logs showed repeated OOM kills of Python near 4.8 to 5 GiB, and the pending CuratorMD source transcript was about 1.25 GB.

**Middle — decisions and work:** Inspection found sde_cues_read loaded and decoded the entire transcript before slicing each requested page. The CuratorMD reader was changed to stream bounded UTF-8 pages using a sparse index, and a regression test was added for large-file paging and Unicode boundaries. The fix was installed into the active plugin cache. The actual 1.246 GB transcript page was read with about 30 MiB maximum RSS. The Codex session and 15 non-pending CuratorMD transcripts were compressed, hash verified, and their active copies pruned; a verified archive of the still-pending large CuratorMD source was also created.

**End — outcome and verification:** The reader fix and regression passed the CuratorMD test and static-check suite, and the real large-file paging probe succeeded without swap. Archives were verified before pruning. The large source copy remained available because its cue had not yet been fully reviewed. In the follow-up investigation, Hermes was found configured to launch an older installation from the GPTMD workspace; Codex config was updated to the current Hermes checkout with an explicit working directory, and direct MCP initialization succeeded with all six tools.

**Rationale:** This preserves the verified memory failure mechanism, the remediation and large-file proof, plus the recoverable cleanup path so future CuratorMD reviews do not recreate the host OOM.

**Future utility:** Preserve the reproducible OOM diagnosis, bounded-reader fix, and archive-verification procedure for later incidents.

**Project impact:** Observed: the old full-file read path correlated with Python OOM kills; bounded paging of the 1.246 GB source used about 30 MiB RSS. The archive cleanup reclaimed about 1.04 GB. The Hermes corrected launch initialized successfully in a direct stdio probe. Expected: bounded transcript paging lowers memory pressure, while an explicit Hermes executable and cwd avoid the observed package-shadowing failure.

**Follow-up:** The active VS Code Codex process needs its MCP configuration reloaded before it uses the corrected Hermes launch. Reauthorize Supabase separately; its OAuth refresh failure was not the editor OOM cause.

**Trigger / root cause:** Preserve the reproducible OOM diagnosis, bounded-reader fix, and archive-verification procedure for later incidents.

**Preventative rule:** Observed: the old full-file read path correlated with Python OOM kills; bounded paging of the 1.246 GB source used about 30 MiB RSS. The archive cleanup reclaimed about 1.04 GB. The Hermes corrected launch initialized successfully in a direct stdio probe. Expected: bounded transcript paging lowers memory pressure, while an explicit Hermes executable and cwd avoid the observed package-shadowing failure.

<!-- curatormd:record_id=164859fc61481d0cea4674761efb9072;content_sha256=2429b8c54ed270ba92f0b9d0dca367417f03d7cca8d7e47cf967de52027d1ce9 -->
<!-- curatormd:fingerprint=ccddd59961e98b4eb71bab68508a080f5aa8adc3fcb1ff2fea81de07fa374e73 -->

## Prevent VS Code OOM from CuratorMD transcript reads

**Date:** 2026-10-14

**Lesson:** ## Prevent VS Code OOM from CuratorMD transcript reads

**Beginning — trigger and context:** The user reported a shared-resource failure that greyed the Codex panel and crashed VS Code. Kernel logs showed Python MCP workers OOM-killed near 4.8 to 5 GiB while a pending CuratorMD transcript was about 1.25 GB; Supabase OAuth refresh and Hermes startup warnings also appeared and needed separate diagnosis.

**Middle — decisions and work:** The CuratorMD reader had been loading the whole transcript before returning each page. It was changed to stream bounded UTF-8 pages through a sparse character-to-byte index, with regression coverage rejecting whole-file reads and checking Unicode page boundaries. A 40,000-character page from the 1.246-billion-character source then used about 30 MiB RSS without swap. Hermes was a separate startup issue: Codex launched v0.21.4 from the GPTMD workspace, where its tools directory shadowed Hermes' package. The launch configuration was corrected to use the newer Hermes checkout and its own working directory; a direct launch initialized and listed all six tools. The large raw source was compressed and hash-verified before the live copy was pruned.

**End — outcome and verification:** The OOM cause and bounded-reader repair were verified against the large transcript, the full CuratorMD suite and Python static checks passed, and the crash-related cues were closed. The already-running VS Code Codex process still needed an MCP restart or window reload to consume the Hermes launch change. Supabase reauthorization remained open; its OAuth error and the CuratorMD resources/list warning were not the crash cause.

**Future utility:** Future crash investigations can distinguish kernel OOM evidence from unrelated MCP startup warnings, and CuratorMD can page large UTF-8 transcripts without loading them whole.

**Project impact:** Observed: Linux had OOM-killed Python workers near 5 GiB; after repair, a page from the 1.246-billion-character transcript used about 30 MiB RSS with no swap, and Hermes initialized all six tools. Expected: streaming reads and scoped Hermes launch settings reduce repeat OOM and import-collision failures.

**Trigger / root cause:** Future crash investigations can distinguish kernel OOM evidence from unrelated MCP startup warnings, and CuratorMD can page large UTF-8 transcripts without loading them whole.

**Preventative rule:** Observed: Linux had OOM-killed Python workers near 5 GiB; after repair, a page from the 1.246-billion-character transcript used about 30 MiB RSS with no swap, and Hermes initialized all six tools. Expected: streaming reads and scoped Hermes launch settings reduce repeat OOM and import-collision failures.

<!-- curatormd:record_id=57f0c765f837ac4f54017cbe9e419251;content_sha256=a7312a64405c98a048880f4bc6eb2d5a195594e6211ca1ce44b556335e27da2c -->
<!-- curatormd:fingerprint=5db31d652014555fc3221b737a33e2ee9244c22583cfeec24b1faf1073a6c954 -->
