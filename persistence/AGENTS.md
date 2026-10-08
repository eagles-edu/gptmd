# Active project rules

- Treat this file and the other three files in `persistence/` as the project knowledge contract.
- Begin each development task with a concise summary and success criteria, then complete the five stages in order: troubleshooting, remediation plan, implementation, testing, completion.
- Keep durable knowledge concise, verified, and actionable. Put historical explanation in `HISTORY.md`.
- Use the OpenAI developer documentation MCP server for OpenAI product, API, plugin, or Codex questions.
- Never record credentials, tokens, private keys, connection strings, personal data, or raw transcripts.
- Keep `.curatormd/native-inbox/` temporary and redacted. It is not canonical knowledge and must not be committed.
- Use an absolute project root when calling CuratorMD. It must resolve to this Git worktree root and contain `persistence/`.
- Every bug fix requires a regression test that fails for the original defect and passes for the repair. Cover behavior and the diagnostic or boundary that exposed it; do not settle for smoke tests.
- Run `npm run check` after application changes. It runs lint, style and HTML validation, Vue-aware type checking, unit and browser tests, API compilation, and a warning-free production build.
- Keep the Express API as a separate service under `services/api/`; do not merge its runtime into Nuxt without an explicit architecture decision.
- Leave curation changes uncommitted for human review. CuratorMD must never add, commit, push, deploy, migrate, or delete project data.
- When an operation errors, analyze the cause and continue with safe repair and verification; if blocked, report the cause, a concrete repair plan, and manual and automatic healing paths.
- For SDE curation, inspect the full relevant thread and preserve substantive project meaning. Scrub secrets only; never promote cue-word fragments or generic filler, and never persist raw prompts, responses, tool arguments, or full transcripts.
- Shape one complete SDE proposal as beginning (trigger and context), middle (decisions and work), and end (outcome and verification); keep all three parts in the same candidate.
- On a failed CuratorMD approval, preserve the prepared transaction and all current persistence edits. Use automatic recovery or the documented manual recovery path; never reset or overwrite a knowledge file to bypass the conflict guard.
- Keep Hermes local-only: the dashboard binds to `127.0.0.1:9119`, and no public firewall rule is required.

- ## Build the Nuxt encounter frontend

**Beginning — trigger and context:** The modernization work needed a working GPTMD client shell rather than a blank Nuxt starter, while keeping the Express API as a separate service and carrying forward the useful encounter workflow.

**Middle — decisions and work:** The client was organized as a Nuxt 4 encounter application with a shared layout, header and footer, patient encounter screen, patient imagery and font assets, and About, Commands, Help, and Tutorial pages. Session, setup, and turn data use typed runtime-checked contracts. The encounter route is client-rendered while the public information pages are prerendered. Unused legacy content components were removed, including one that rendered raw HTML. The theme work added light and dark Vuetify palettes, a header toggle, cookie-backed preference state, and theme-aware interface colors.

**End — outcome and verification:** At the end of the implementation thread, production build, lint, style lint, and Playwright checks for theme switching, cookie persistence, desktop and mobile rendering, and browser errors were reported passing. A local preview returned HTTP 200. The saved preference is applied client-side on prerendered pages, so those pages can initially render in light mode. The later build warning repair moved the four imported font files into app assets and disabled Nuxt debug instrumentation; `npm run build` then passed without the unresolved-font or duplicate Vuetify timing warnings.

**Rationale:** Describe implemented UI behavior separately from the design-only patient and encounter model.

**Future utility:** Provides the current frontend structure, route-rendering split, contract boundary, and theme behavior for future GPTMD UI and API integration work.

**Project impact:** The verified client shell and automated theme checks improve the basis for interface changes. Backend integration and clinical validation remain separate work; no clinical outcome was tested.
  - **Why:** Provides the current frontend structure, route-rendering split, contract boundary, and theme behavior for future GPTMD UI and API integration work.

<!-- curatormd:record_id=756501e8efef5502fd2c1fbc78312e91;content_sha256=64673915a009cc78bc19510083c43bceb2eec1a1b540a54fe41e8b84614a430d -->
<!-- curatormd:fingerprint=cd620788fc39cc8a2615e2de0c3db3220a707c1bc3d4edd5c62a21651794daf3 -->

- ## Define GPTMD’s clinical session model

**Beginning — trigger and context:** GPTMD was being rebuilt as a clean-slate medical training application. The legacy repositories offered evidence about existing workflows, but should not constrain the new design. The project needed a coherent account of how patient facts, disclosure, encounter progress, and model context relate.

**Middle — decisions and work:** The modernization plan and system diagrams were revised around an immutable patient canon owned by one authenticated customer session, with encounter state tracked separately through history coverage, disclosures, exams, orders and results, assessment, transcript, and an append-only event ledger. The design distinguishes GPTMD’s database record from optional provider conversation context; it also covers customer and instructor roles, transcript and audio modes, retention controls, scenario-specific history rubrics, natural history-taking, consistent pregnancy outcomes, and bounded unpredictability where compatible details may vary between sessions but stay stable once established. Model tiers are framed as cost and quality choices rather than clinically validated rankings.

**End — outcome and verification:** The historical project account, modernization plan, and system diagrams were updated. The thread reports SVG parsing, outcome-count checks, and documentation whitespace checks passing. This is a design reference; the proposed data model and clinical workflow were not implemented or clinically validated in that work.

**Rationale:** Keep the dated design decisions and their verification limits together; link to the plan and diagrams rather than treating planned behavior as current application behavior.

**Future utility:** Gives future implementation work a shared reference for patient truth, encounter state, disclosure behavior, roles, and scenario consistency.

**Project impact:** Expected to reduce conflicting requirements and contradictory patient/session data during implementation. No clinical or runtime quality improvement was measured because the design remains unimplemented.
  - **Why:** Gives future implementation work a shared reference for patient truth, encounter state, disclosure behavior, roles, and scenario consistency.

<!-- curatormd:record_id=818d99faaee1ab94ad80ddb743eca112;content_sha256=56b8ad7ce4f4a152d98d6947a7a4364bd726fe6aa12b602e627c6dbd165a3af4 -->
<!-- curatormd:fingerprint=fe62491f1a82d9331748062ba2edb74a70aee029483a5a6c91bba5c454f286ef -->

- ## Provision GPTMD API and local data services

**Beginning — trigger and context:** The modernization plan needed a usable local API foundation and project-aligned data tools before patient-session workflows could be built.

**Middle — decisions and work:** Installed the OpenAI, PostgreSQL, and Redis Node clients; added a loopback-only Responses endpoint and a launcher that loads credentials from the ignored mode-0600 `.env`. Registered project-scoped filesystem, Redis, and PostgreSQL MCPs; the PostgreSQL MCP uses a non-superuser read-only role. Created the local PostgreSQL Compose service and connected the API to the existing Redis Stack.

**End — outcome and verification:** Dependency inventory confirmed openai 7.25.0, pg 8.23.0, and Redis Node.js client 6.2.1. PostgreSQL was healthy, Redis returned PONG, and the API `/readyz` reported Redis and PostgreSQL ready and OpenAI configured. No live OpenAI request was made; patient-session routes, Conversations, and application-data writes remain planned.

**Future utility:** This records the reproducible local API/data boundary and credential handling so future work can build patient workflows on verified services without confusing infrastructure readiness with product completion.

**Project impact:** Observed: API readiness succeeded against both local data services with OpenAI configured. Expected: project-scoped MCPs and local services shorten integration work; no patient workflow or provider response quality was tested.
  - **Why:** This records the reproducible local API/data boundary and credential handling so future work can build patient workflows on verified services without confusing infrastructure readiness with product completion.

<!-- curatormd:record_id=accb9e17ad623e7022b4c27260f38906;content_sha256=2535a05682478c1251035895c5faa87009be70648791a82fd173f415fd3e2b3e -->
<!-- curatormd:fingerprint=321cb942943dd7c65db1fe99e01b3369af6b47ff0646ea9f4fba6a4085f1332e -->

- ## Add encounter preflight and permission handling

**Beginning — trigger and context:** The GPTMD phase plan requested the signed-in home/account entry points (1D) and encounter preflight/permission handling (1E). Review confirmed the home, account, auth guard, and Google OAuth start paths already existed and were covered by browser checks, while full Google browser sign-in and GPTMD workspace membership provisioning remained unverified. The encounter needed a clear fictional-training consent and readiness gate, explicit microphone permission behavior, and accurate browser-storage messaging before users could continue.

**Middle — decisions and work:** Added a persistent preflight dialog in app/components/PatientEncounter.vue. It explains that the encounter is fictional training, requires confirmation to continue, offers transcript mode without microphone access, and explains audio is not connected yet. Selecting audio does not request access; a separate button calls getUserMedia. A successful check immediately stops every returned track and returns to transcript mode; denial and unavailable media devices also retain transcript mode. The dialog explains local storage is not a secure session vault, this app does not save account or encounter data there, and persistent-storage requests are separate. Added an isolated Playwright auth fixture/config and wired the preflight browser cases into the project E2E command. Mobile screenshot review found the storage explanation competing with pinned consent controls; the card content was made scrollable while the controls stay reachable, and the test now scrolls the explanation into view and checks it does not overlap the controls. Stylelint rejected a :deep() selector during that repair, so it was replaced with a class on the Vuetify card-text element. Updated the task list to mark 1E complete while leaving 1D pending external sign-in and membership verification.

**End — outcome and verification:** The final npm run check passed, including lint, style lint, HTML validation, Nuxt and TypeScript checks, 43 Vitest tests, API/schema/diagram checks, production build, 7 standard Playwright cases, and 2 preflight cases covering microphone denial and grant/track-stop behavior. git diff --check passed, and desktop/mobile screenshots were reviewed; the mobile capture shows the full storage explanation and consent controls without overlap. The signed-in home/account links, route guards, and Google authorization start are verified by the standard browser suite, but real Google browser sign-in, tenant provisioning, account reporting, payment activation, and audio conversations remain incomplete.

**Future utility:** Provides a reusable consent and capability pattern for future encounter modes: request microphone access only after an explicit action, release acquired tracks immediately when no audio capture is implemented, preserve transcript access after permission failure, and keep storage explanations separate from browser permission prompts. The dedicated browser fixture exercises both grant and denial without depending on a real identity provider.

**Project impact:** Observed: all configured static, unit, build, and browser checks passed, including mobile verification that consent controls remain reachable while the storage explanation is readable. Expected: the explicit consent and permission path reduces accidental permission requests and makes the available transcript fallback clear. Audio conversation support and full account provisioning were not verified or implemented by this change.

**Follow-up:** Complete 1D only after validating a real Google sign-in and GPTMD workspace membership path; connect account reporting/payment confirmation and audio conversations in their planned phases.
  - **Why:** Provides a reusable consent and capability pattern for future encounter modes: request microphone access only after an explicit action, release acquired tracks immediately when no audio capture is implemented, preserve transcript access after permission failure, and keep storage explanations separate from browser permission prompts. The dedicated browser fixture exercises both grant and denial without depending on a real identity provider.

<!-- curatormd:record_id=9efb741dfbf511e17ea2082c15c4f3d8;content_sha256=6cb1063abf269ba2953c50756cefa9cb4ba10438f447210bc85d89a01c9f4a93 -->
<!-- curatormd:fingerprint=57c9041e7198cd21686070353831301a56c983fbdf042b188f37d7a1e319510c -->

- ## Carry workspace choice into encounter startup

**Beginning — trigger and context:** GPTMD task 1D remained open because the account and signed-in home did not yet carry the selected workspace into encounter creation. Account data and tenant membership come from external authentication and workspace services, so unavailable states had to remain explicit.

**Middle — decisions and work:** Updated the signed-in home to show identity and workspace access, and added workspace selection on Account Status without exposing raw tenant IDs. Carried the selected workspace through the home page's Begin Visit action into the session-creation request. Made workspace lookup retryable and cleared the stale choose-workspace alert when selection changed. Added browser coverage for navigation, the selected workspace handoff, and responsive home/account states; repaired the test fixture to hydrate authentication from the public home before entering protected routes.

**End — outcome and verification:** The required project checks passed, including 45 unit tests, production build, 11 standard Playwright cases, and 2 encounter preflight cases. Desktop and mobile captures were reviewed after the live alert-state fix. The application-side workspace selection path is implemented; real browser sign-in, tenant membership provisioning, account reporting, and payment activation remain unverified or planned.

**Future utility:** Defines how GPTMD preserves a chosen workspace across account, signed-in home, and encounter startup while keeping internal tenant identifiers out of the interface.

**Project impact:** Observed: the selected workspace reaches the session request in browser coverage, workspace lookup can be retried, and the stale selection warning clears. Expected: carrying workspace context prevents starting an encounter against an unintended membership. Real identity-provider sign-in and tenant provisioning were not verified.
  - **Why:** Defines how GPTMD preserves a chosen workspace across account, signed-in home, and encounter startup while keeping internal tenant identifiers out of the interface.

<!-- curatormd:record_id=6465b6318e2804e11fd175a57fcb021f;content_sha256=345ca8f48c891c1984e2c6a72d3be0bc1c149e28b36f6554c6e6e6c14a87fb03 -->
<!-- curatormd:fingerprint=b69877cdd03b7e41ce937dc5e218932df0237c367000eea9bd93280fdc62764d -->

- ## Build a bounded bilingual checkout preview

**Beginning — trigger and context:** GPTMD's merchant-readiness work needed a usable checkout journey that could be reviewed before ACB2Pay sandbox credentials arrived. The existing screen was only a mockup and included unsupported Google Pay and security claims; no payment API or order submission was connected.

**Middle — decisions and work:** Implemented a bilingual flow for plan selection, adding one plan to a visible cart, entering contact and billing-address details, selecting digital workspace delivery, acknowledging linked policies, and continuing to an ACB2Pay handoff screen. Buyer details remain in page memory and are not submitted. The Pay action never reports a successful order or payment. Updated checkout and account wording to remove unsupported Google Pay claims, matched the app's light/dark theme, and added browser coverage for cart count, validation, consent, navigation, and the handoff. Visual checks caught and corrected missing input type, theme contrast, and mobile layout issues.

**End — outcome and verification:** The completed project check passed and desktop/mobile captures were reviewed in light and dark themes. Browser coverage confirms the cart changes from zero to one and the flow reaches the handoff without claiming payment success. The handoff is still a preview; ACB2Pay credentials, a real payment request, order persistence, taxes, and production checkout remain unimplemented.

**Future utility:** Gives future payment integration a tested buyer-facing flow and a clear boundary between collecting preview data and actually submitting an order or charging a customer.

**Project impact:** Observed: the bilingual cart-to-handoff flow passed browser and project checks in desktop/mobile and light/dark presentations. Expected: explicit no-payment status and in-memory-only buyer details prevent the preview from implying a completed transaction. No payment processing or order creation was tested.
  - **Why:** Gives future payment integration a tested buyer-facing flow and a clear boundary between collecting preview data and actually submitting an order or charging a customer.

<!-- curatormd:record_id=cead4389f41b87c64b978416137b17b3;content_sha256=61b8d124f7921d980cd48b437cad7ec8c2b911da6740b4ac7f22990908f6e831 -->
<!-- curatormd:fingerprint=aa3eb2b3ffe84c54c3019749411ea86cb1986d835c63ce8256698d8f40e8f027 -->

- ## Add bilingual GPTMD policy pages

**Beginning — trigger and context:** GPTMD needed public privacy, terms, service-provision, and refund information for its planned merchant review. The existing application had account and checkout demo surfaces, but the policy drafts included unsupported claims about payment providers, automatic activation, email delivery, and refund timing.

**Middle — decisions and work:** Added four bilingual policy routes and linked them from the site footer. Rewrote docs/ec0mmvn.md to separate verified application behavior from unresolved launch requirements. Wording states that live checkout and recurring billing are not configured and avoids promising ACB or Google Pay processing, automatic access activation, confirmation emails, or a specific refund deadline. Added browser coverage for bilingual content, navigation, and mobile overflow, then corrected route-title mismatches found by the checks.

**End — outcome and verification:** The complete project check passed lint, style lint, HTML validation, Nuxt and TypeScript checks, 43 unit tests, API compilation, schema and diagram checks, and a warning-free production build. All four policy routes were prerendered; the eight standard Chromium browser tests and two encounter preflight tests passed after the title fixes. This records the implemented policy surface, not legal approval or payment readiness.

**Future utility:** Gives future GPTMD work a maintained set of public policy routes and a source document that distinguishes implemented behavior from merchant launch requirements.

**Project impact:** Observed: four policy pages render and navigate successfully on desktop and mobile, and the production build and browser checks passed. Expected: keeping policy wording aligned with actual payment and account behavior reduces unsupported customer-facing claims. No legal or regulatory approval was established.
  - **Why:** Gives future GPTMD work a maintained set of public policy routes and a source document that distinguishes implemented behavior from merchant launch requirements.

<!-- curatormd:record_id=b8570a97efe0e1f23e39c0319040e785;content_sha256=445688ee93490c47e214bc2e5d293ff41318503181d35d4026887d2babe64b48 -->
<!-- curatormd:fingerprint=ece621b3f5742933f71ccdd5245f2a89497c84d2a907b91660ec2329672a1fc4 -->

- ## Add verified MoIT merchant readiness details

**Beginning — trigger and context:** GPTMD's gov.vn merchant-readiness document mixed required review steps with unverified claims about payment behavior and storefront compliance. The app had no verified merchant profile details or complaint route, and unknown routes needed proper server-side 404 handling.

**Middle — decisions and work:** Rewrote docs/ecommvn-2.md as a readiness matrix that separates documented requirements, current app behavior, and external blockers. Added a configurable merchant-information footer that appears only when all required legal and contact fields are supplied, and shows an MoIT confirmation link only for a configured HTTPS URL. Added complaint guidance to /contact, made the checkout preview explicit that no payment succeeds, and added regression coverage for merchant fields and true HTTP 404 responses. The likely storefront hostname resolved but returned HTTP 403 for tested routes, which was recorded as an access blocker rather than changing bot protection.

**End — outcome and verification:** The merchant details, contact path, checkout wording, and server-side 404 behavior were implemented and exercised by the project checks. The readiness document distinguishes online.gov.vn as the MoIT portal from the storefront domain and identifies remaining bank, merchant-profile, and production-access steps. The site was not submitted or approved by MoIT, and production accessibility remains unverified.

**Future utility:** Provides a fact-checked readiness checklist and a guarded merchant-information configuration pattern that future launch work can complete without displaying partial or invented company details.

**Project impact:** Observed: configured merchant fields and the 404 path have regression coverage, and the storefront's tested 403 response is documented. Expected: the explicit readiness matrix and conditional fields reduce false compliance claims. No government approval or bank integration was verified.
  - **Why:** Provides a fact-checked readiness checklist and a guarded merchant-information configuration pattern that future launch work can complete without displaying partial or invented company details.

<!-- curatormd:record_id=f4ad2d48c0ed3bf03632f4f03bfaeb55;content_sha256=331deb8d1a7424c3f10b4edffa8355aaf1f56aa7820df1b9a3ee6ba32837b3fd -->
<!-- curatormd:fingerprint=94d934c55ba20c47257b8577b2df4a4a56dc073ae460af1e674051915e603b1d -->

- ## Add ordered voice repair and written take-home notes

**Beginning — trigger and context:** The voice encounter needed to preserve GPTMD's clear LED-controlled speaking turns while giving the learner and patient a practical sequence for repairing misunderstandings.

**Middle — decisions and work:** Implemented a voice-turn buffer that submits finalized speech after seven seconds of silence, stops recognition during patient playback, and reopens the learner turn when playback ends. The red, green, and yellow LED communicates inactive, learner, and patient-processing states. Both sides use the ordered repair sequence: repeat, louder/slower/simpler, explain another way, spell, then write it down in English. The patient's written reply stays in the transcript and can be downloaded. Added respectful, nonjudgmental handling for sensitive history questions and acceptance of learner refusals.

**End — outcome and verification:** `npm run check` passed with 85 unit tests and 15 browser tests; desktop and mobile captures were reviewed, and the browser test verified the downloadable note contents. The flow still uses standard browser speech recognition; cross-browser Realtime transcription and a real-microphone smoke test remained open.

**Future utility:** Preserves the agreed turn timing, LED state meanings, reciprocal repair sequence, and take-home note behavior for later transcription-provider work without changing the learner's encounter rhythm.

**Project impact:** Observed: mocked browser coverage verified seven-second auto-send, playback turn-taking, repair behavior, and downloaded note content. Expected: the ordered repair flow supports communication recovery and leaves the learner with the patient's exact English note.
  - **Why:** Preserves the agreed turn timing, LED state meanings, reciprocal repair sequence, and take-home note behavior for later transcription-provider work without changing the learner's encounter rhythm.

<!-- curatormd:record_id=47ab9016befc54e005c150019a4cbcac;content_sha256=1790d87f5496fdb45d15b1a4e666660f8d2071069a39b2c86d86aebc4eccd3f2 -->
<!-- curatormd:fingerprint=b8fcaaea76e7264fd4c810da9b35caf8db587de1078741107d87a0c07d212584 -->

- ## Persist ordered session events through Redis streams

**Beginning — trigger and context:** Phase 2 required durable session records and a safe path from Redis live state to PostgreSQL history, including retry handling and recovery when live Redis JSON was missing.

**Middle — decisions and work:** Added migration 004 for ordered append-only session events, provider usage, owner-bound download engagement, and terminal outcomes. Implemented an atomic Redis transaction that commits live JSON, the accepted reply and retry key, and the recovery stream event. A separate PostgreSQL worker persists events in order and idempotently, acknowledging only after commit. Missing Redis state can be rebuilt from PostgreSQL history; the README records the roughly one-second AOF loss window.

**End — outcome and verification:** `npm run verify:phase2` passed retries, worker persistence, terminal outcomes, and reconstruction after deleting test state. `npm run check` passed with 57 unit tests, 14 browser tests, and the production build. The stream was empty after verification. Redis process-restart and live PostgreSQL outage exercises were still open at the end of this thread.

**Future utility:** Records the two-store ownership boundary, atomic handoff, idempotent worker rule, and recovery path needed for later session, archive, and retention features.

**Project impact:** Observed: local verification covered retry, persistence, terminal, and missing-state recovery paths. Expected: stream-based persistence avoids waiting on PostgreSQL in the learner response path while preserving ordered durable events.
  - **Why:** Records the two-store ownership boundary, atomic handoff, idempotent worker rule, and recovery path needed for later session, archive, and retention features.

<!-- curatormd:record_id=58c32ff3fbb651767a22cec5d7a6f075;content_sha256=9cd39f8a97fdf896cf684c307c3de28f86c65db2e93d63379ae4bad2b419e7b2 -->
<!-- curatormd:fingerprint=f0d16b2ca556b95cf749ec21bfbcda49d702344f95bba916ea91ae74dd1ec090 -->

- ## Coordinate patient setup and portrait readiness

**Beginning — trigger and context:** The 1F setup work needed one stable application session and patient-profile identity across PostgreSQL, Redis, and the provider Conversation, while keeping the room unavailable until setup and portrait loading finished.

**Middle — decisions and work:** Allocated a distinct per-visit patient-profile ID and initialized its Redis bindings before generation. PostgreSQL stores the immutable profile and Conversation ID; after commit, Redis receives the profile, private setup projection, digest, schema version, and Conversation binding. Matching retries restore the Redis mirror from the saved scenario. The browser receives learner-safe fields and waits for backend, transcript, and selected portrait readiness before enabling Enter Room.

**End — outcome and verification:** The task list marks 1F complete. `npm run check` passed with 52 unit tests, API and production builds, schema and diagram checks, and 14 browser tests; desktop and mobile screenshots were reviewed. Live PostgreSQL, Redis, and OpenAI setup was not exercised in this thread, and migration 003 was still required in the configured database.

**Future utility:** Preserves the session/profile ownership boundary and the retry/readiness sequence so later encounter work does not activate a partial profile or expose diagnosis and provider identifiers.

**Project impact:** Observed: configured checks and desktop/mobile review passed. Expected: the shared IDs and readiness gate reduce setup mismatches and prevent entry before required data and assets are ready.

**Follow-up:** Apply migration 003 to the target database and verify setup against the configured PostgreSQL, Redis, and OpenAI services.
  - **Why:** Preserves the session/profile ownership boundary and the retry/readiness sequence so later encounter work does not activate a partial profile or expose diagnosis and provider identifiers.

<!-- curatormd:record_id=e47d8231e000942925f950a8e917eccf;content_sha256=017f06364e4d799df2611a0e9ed68915f2e201c75ecb979189c02547587ddb51 -->
<!-- curatormd:fingerprint=3dc91bda6d7be440f582d80b12826c82e880fb56b32544a620c3a72dcd687100 -->

- ## Validate obstetric outcome totals against gravidity

**Beginning — trigger and context:** Phase 3 work exposed a gap in generated scenario and accepted history validation: pregnancy outcome totals could conflict with gravidity and current pregnancy status.

**Middle — decisions and work:** Added consistency checks so generated profiles and accepted history expansions reconcile completed outcomes with gravidity, leaving the active pregnancy without a completed outcome when the patient is currently pregnant. Impossible partial totals are rejected. Updated the detailed task list, companion checklist, and modernization plan; the broader Phase 3 checklist audit kept chronology, semantic fact checks, fixed results, rubric, and assessment work open.

**End — outcome and verification:** Regression tests reproduced the former invalid totals and passed after the repair. `npm run check` passed with 75 unit tests, production build, and 14 browser tests; `git diff --check` was clean. The Phase 3 gate remained open for chronology, age plausibility, child-count consistency, complications, and other unfinished workflow items.

**Future utility:** Gives future scenario and history validation a single rule for completed obstetric outcomes and the active pregnancy, and records which neighboring consistency checks still need implementation.

**Project impact:** Observed: invalid partial totals were rejected by regression coverage and the configured project checks passed. Expected: consistent gravidity and outcome counts reduce contradictory patient histories.
  - **Why:** Gives future scenario and history validation a single rule for completed obstetric outcomes and the active pregnancy, and records which neighboring consistency checks still need implementation.

<!-- curatormd:record_id=e6e8856abdc547e5485c41fa9630723e;content_sha256=526338f3efd1953dacecc0f003d83317f0cae8f3059ec50ead69b819ba094af3 -->
<!-- curatormd:fingerprint=db280bcb10dde5addcedd003c6ae96406667351bba5248e8e88cef7728964609 -->

- ## Enforce Current-Only Session and Scenario Schemas

**Beginning — trigger and context:** While continuing the line-by-line modernization checklist audit, the user clarified that GPTMD is a refactored first-generation system and must not add compatibility fallbacks for older code. Inspection then found that turn records could still be projected with legacy defaults and that scenario schema versions 1 and 2 were accepted even though current setup creates version 3. The task was to make stored and recovered session data follow the current contracts, while keeping the broader checklist and externally dependent work open.

**Middle — decisions and work:** Removed legacy fallback/default behavior for omitted transcript modality/phase, session mode, and assessment state. Updated the transcript view and added migration 016 so databases that had already applied migration 015 receive the strict projection. Changed immutable-scenario and Redis live-state validation to require the current schema version 3, updated the generated schema and verifier/tests, and added an explicit PostgreSQL recovery check that rejects unsupported stored versions instead of reconstructing them into Redis. Existing unsupported rows are left untouched and must be recreated under v3. Updated the `d03` checklist evidence. The current-version checks reject versions 1, 2, and 4.

**End — outcome and verification:** Migration 016 was applied in the temporary PostgreSQL recovery verification. `npm run verify:phase2` passed, confirming ordered transcript rows retain required phase and modality, event persistence and assessment recovery work, and cleanup succeeds. `npm run check` passed with 137 unit tests, 33 standard E2E tests and 15 preflight E2E tests across Chromium, Firefox and WebKit, plus lint, type checks, API build, generated schema and diagram checks, and production build. `git diff --check` passed. Unsupported persisted scenarios remain unchanged and need recreation under schema v3; the broader modernization checklist remains in progress, including real-microphone verification.

**Rationale:** The user explicitly chose a clean first-generation contract. Keeping strict schema enforcement and the migration step together prevents later cleanup from reintroducing compatibility behavior and distinguishes an unsupported stored row from a missing Redis projection.

**Future utility:** Gives future work one current session and scenario contract, the migration path for strict transcript projection on databases that already ran migration 015, and a tested recovery rule that leaves unsupported stored scenarios untouched instead of silently adapting them.

**Project impact:** Observed: current runtime validation rejects missing legacy fields and unsupported scenario versions, PostgreSQL recovery fails closed for unsupported records, and the project verification gate passed. Expected: strict first-generation contracts prevent silent defaults from changing the meaning of stored transcript/session data and stop old scenario records from re-entering active Redis state.

**Follow-up:** Recreate any persisted scenario rows with schema versions other than 3 before they are used by the current runtime; keep educator rubric, clinical action catalogs, live Google sign-in verification and real microphone/provider verification marked incomplete until their stated prerequisites are met.
  - **Why:** Gives future work one current session and scenario contract, the migration path for strict transcript projection on databases that already ran migration 015, and a tested recovery rule that leaves unsupported stored scenarios untouched instead of silently adapting them.

<!-- curatormd:record_id=1a0284f6eaaf6cccd0b7743b04ca523e;content_sha256=aa672f56ee39a0065c53c3d4b83147c1a6b2ebf620029889151ed586375c3490 -->
<!-- curatormd:fingerprint=2e354e66a1afd6e320a947a15c2f6831cbc94790cec04dc5f81d896955b963d3 -->

- ## Expanded GPTMD current-state architecture in IcePanel

**Beginning — trigger and context:** The user requested a complete recreation of GPTMD's current project state in IcePanel, then asked for more detail and additional levels. The existing model had a useful top-level skeleton but sparse deep views and stale status labels.

**Middle — decisions and work:** Compared the saved IcePanel landscape against the GPTMD repository's current routes, data model, and worktree. Corrected implemented versus future statuses, added Supabase Auth, expanded the C4 model to 13 diagrams covering system context, application and data flow, Nuxt and Express components, and nine focused workflows for identity and quotas, setup, turns, persistence, assessment, transcription, and client flows. IcePanel's API rejected component-under-component ownership with HTTP 422, so components stayed at the valid application level. Attempts to save zoomOverrides timed out; finer process views were kept as separate app-level diagrams exposed through the relevant application's child-diagram list. Removed superseded baseline copies and reread the saved remote diagrams and connections.

**End — outcome and verification:** Verified the saved remote model contains 13 diagrams with no broken diagram connections. Updated routes and persistence statuses and included Supabase Auth. Organization/customer profile fields, instructor/admin workflows, clinical orders/exams, rubric scoring, and full audio encounters remain marked future or incomplete. No repository source files were changed. IcePanel zoom override saving remained unavailable due to request timeouts.

**Future utility:** Future project work can use the verified 13-diagram IcePanel landscape as a current architecture reference and preserve its C4 constraint: components belong to applications, while finer process detail is represented in separate linked diagrams when zoom overrides cannot be saved.

**Project impact:** Observed outcome: the remote architecture model now represents current implemented GPTMD state at more levels, with known incomplete capabilities explicitly retained as future/incomplete. This improves architecture review and navigation while avoiding unsupported C4 ownership relationships.
  - **Why:** Future project work can use the verified 13-diagram IcePanel landscape as a current architecture reference and preserve its C4 constraint: components belong to applications, while finer process detail is represented in separate linked diagrams when zoom overrides cannot be saved.

<!-- curatormd:record_id=38a6cd453c3bec2b71836ec98c4f7f2d;content_sha256=d6d08fc468ebc0e2b70d83172231b0cfecd0b1ab3bb48b15ee362c2c870f2cc9 -->
<!-- curatormd:fingerprint=c387ec7e4e31e1ebabeafd4588b8cf7a6109edda6bc5c75508664d37c0e61999 -->

- ## Bounded scenario setup and consented Realtime transcription

**Beginning — trigger and context:** The GPTMD modernization checklist left scenario setup without back-pressure and voice interaction dependent on browser speech recognition. The implementation needed bounded retries and a cross-browser transcription path while preserving the user's chosen reuse of the existing server-side OPENAI_API_KEY.

**Middle — decisions and work:** Added a bounded process-local setup queue with configurable active and waiting limits, queue deadlines, provider timeouts/retries, and retryable overload responses that leave sessions initializing for same-key retry. Added Realtime transcription using short-lived client secrets, default-off audio, tenant enablement and privacy approval, finite monthly grant quota, visit-level consent, and finalized text submission; GPTMD does not persist raw audio. Migration 009 was applied locally, and the queue's single-replica scope and client-side 15-minute audio limit were recorded.

**End — outcome and verification:** The earlier pass reported npm run check, local readiness for PostgreSQL, Redis, OpenAI configuration, and authentication, plus desktop/mobile review. Real microphones across target browsers and server-side duration observation remained open; this proposal preserves those limits rather than treating browser tests as microphone evidence.

**Rationale:** This records the user's existing-key decision, the deployment scope of the queue, consent/privacy boundaries, and the remaining microphone verification so later checklist work does not repeat setup or overstate validation.

**Future utility:** Future work can resume microphone compatibility and usage enforcement checks from the established setup queue and transcription contract.

**Project impact:** Observed: the checklist implementation had bounded setup admission and an explicit consented Realtime transcription route, with automated checks and local readiness passing. Expected: overload and provider failures are less likely to leave partially activated sessions, and audio handling is clearer to learners.
  - **Why:** Future work can resume microphone compatibility and usage enforcement checks from the established setup queue and transcription contract.

<!-- curatormd:record_id=1d062cfff84f5e3c5fea0a600100898e;content_sha256=d67d083b57a80f2ccae41616e5852853526c70b16e7d685493efc91b3ae7566c -->
<!-- curatormd:fingerprint=0f0edf693ec181233d75a2a7a75fd6df071b1c7298b74af236687e26dea3bf56 -->

- ## Start the GPTMD development stack with one command

**Beginning — trigger and context:** The user asked to make `npm run dev` a one-click GPTMD startup because the frontend, API, and local data services had separate startup requirements. The success criteria were one npm command, visible logs, and clean shutdown of child processes.

**Middle — decisions and work:** Reviewed the repository startup guidance and found that `npm run dev` launched Nuxt only, while PostgreSQL and the API had separate scripts and Redis Stack was an existing external prerequisite. Updated `scripts/dev.mjs` and package scripts so `npm run dev` starts PostgreSQL, waits for API readiness on port 4000, and then starts Nuxt on port 3000; retained `npm run dev:web` for frontend-only use. Documented Redis and first-time migration prerequisites. An initial launch exposed a port race where Nuxt could take port 4000; startup ordering was corrected so the API binds first.

**End — outcome and verification:** Ran `npm run dev`; the API readiness endpoint and Nuxt page both returned HTTP 200. Verified Ctrl+C stops the API and Nuxt while PostgreSQL remains running. The session reported an existing Nuxt DevTools/Vite warning, and Redis Stack plus documented first-time migrations remain prerequisites.

**Future utility:** Provides the current one-command local development workflow, the service startup order, the frontend-only command, and the external Redis and database migration prerequisites.

**Project impact:** Observed: one command launched the API and Nuxt successfully, both endpoints returned HTTP 200, and Ctrl+C stopped both development servers. Expected: startup ordering and readiness waiting reduce port conflicts and make local setup repeatable.
  - **Why:** Provides the current one-command local development workflow, the service startup order, the frontend-only command, and the external Redis and database migration prerequisites.

<!-- curatormd:record_id=0eda8b096ace82e03860603ed38ecaee;content_sha256=a4ea65bd877477db24a192582abb034a591de2b9656a5bc0bde8a9516630c79a -->
<!-- curatormd:fingerprint=894ffeaea1c8f5f4885f6cead9ef7a00c78866be4728b086f0ccd548b0fb6fcd -->

- ## Strengthen scenario chronology and cleanup

**Beginning — trigger and context:** The ongoing line-one modernization audit found clinical consistency gaps in the scenario setup and patient-turn paths, alongside a privacy risk when provider setup failed. The success condition was to complete changes supported by the existing patient-profile and persistence contracts, keep educator-dependent behavior open, and verify each implemented slice.

**Middle — decisions and work:** Extended t21 validation across generated setup profiles and accepted patient disclosures to reject explicit LMP and symptom-onset dates before birth or after the scenario/encounter date. Added bounded exact relative-day handling while leaving unsupported approximate, weekday, and cycle-relative phrases uninterpreted. Strengthened t22 PP-defined pregnancy/live-birth count invariants and corrected the unqualified parity cue so it does not also disclose living-child count. For t23, failed or rejected setup Conversations have their items deleted and verified before Conversation deletion; cleanup failures enqueue only the Conversation ID in PostgreSQL for bounded worker retries. Added migration 019 and updated checklist evidence. The separate cache review kept the complete PP catalog intact, placed the variable scenario seed after the cache boundary, and measured two warm synthetic setup calls.

**End — outcome and verification:** The latest full npm run check passed with 183 unit tests, 33 browser tests, 15 preflight tests across Chromium, Firefox, and WebKit, and a warning-free production build; git diff --check and the Phase 2 migration verifier passed. Migration 019 was applied to local PostgreSQL. The API was not running for live readiness verification. t21 remains open for broader onset prose and educator-defined age rules; t22 remains open for pregnancy-by-pregnancy chronology, complications, and child-count meaning; t23 remains open for fixed-result workflow and educator-approved rubric. The modernization checklist remains in progress.

**Rationale:** The implementation follows existing schema and persistence contracts without inventing new PP fields or clinical semantics.

**Future utility:** Preserves the implemented chronology boundaries, PP-defined invariant, privacy cleanup sequence, and the exact limits that future checklist work must respect.

**Project impact:** Observed: unit, browser, preflight, migration, and diff checks passed for the implemented slices. Expected: rejecting impossible dates/counts reduces scenario contradictions, and retryable Conversation cleanup reduces persistence of failed setup data. Clinical chronology and rubric correctness remain unverified until educator-reviewed cases are available.

**Follow-up:** Continue the checklist in order. Obtain educator-reviewed chronology/rubric cases and live provider/microphone evidence before closing dependent nodes.
  - **Why:** Preserves the implemented chronology boundaries, PP-defined invariant, privacy cleanup sequence, and the exact limits that future checklist work must respect.

<!-- curatormd:record_id=3b2a61010745ff2f49443612714dd433;content_sha256=c9780463ee8d2aaa97ff77ab5339b43aadb6ecbb7c70cb7b2e9c224ea58c22c4 -->
<!-- curatormd:fingerprint=57eba1bce9d8eb851b17e96f78f8054e3e7cdaeeabf6ef0a593e494c1bfcc4e0 -->
