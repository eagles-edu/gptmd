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
