# GPTMD phased implementation checklist

**Status:** Implementation checklist; workflow items remain unchecked unless implementation evidence is recorded. Use the [modernization companion checklist](plangpt-modernization-checklist.md) for the complete 286-node task inventory and detailed acceptance evidence. This file tracks phase-level progress and implementation order; it does not replace those node-level tasks.

## Goal and completion criteria

Build the authenticated patient-session workflow on the existing Nuxt client and separate Express API. Redis serves the live patient/session state and rapid recovery. PostgreSQL stores durable client/session history, usage, download activity, and outcomes. The learner-facing response must never wait for background work.

The workflow is complete only when its required checklist nodes are implemented, the latency and recovery gates below pass, and the end-to-end scenario lifecycle is demonstrated. Existing packages, healthy services, API readiness, and design documents are foundations, not completion evidence.

## Architecture rules for every task

1. **Keep the live encounter in Redis.** Redis JSON holds the active patient profile, session progress, and accepted turn state. Redis persistence currently allows about one second of write loss after a sudden failure; this is the accepted initial recovery window. The local Redis instance has no replica, so host-loss redundancy is future deployment work.
2. **Keep durable records in PostgreSQL.** Store completed clinical events and session records, plus provider usage, download engagement, and success/outcome tracking. Write compact events and periodic snapshots as useful; do not rewrite the full patient profile for every turn.
3. **Do not make the learner wait for side work.** At every request and workflow node, do not wait for PostgreSQL writes, metrics, archive generation or upload, notifications, analytics, cleanup, or worker completion. Dispatch side work asynchronously to dedicated workers through bounded queues. Handoff must be nonblocking, with overhead below 5 ms; this is not time the request may spend waiting for a side operation.
4. **Wait only for payload-critical work.** A turn may wait for authorization, the model response, required current Redis state, and one Redis commit containing the accepted live state, patient reply, retry key, and recovery event. This saves the response and state needed to continue or retry the encounter; it is not an analytics or reporting write. If that Redis commit fails, do not return an unjournaled reply.
5. **Make retries safe and ordered.** Give every accepted turn a stable ID. Workers persist events in session order, make PostgreSQL writes idempotent, and acknowledge a Redis Stream event only after the corresponding database commit succeeds. Keep unconfirmed events beyond the Redis JSON expiry when necessary; monitor their age and volume.
6. **Bound load and fail quickly.** Set limits for every queue and active worker pool. Alert before capacity is exhausted; reject new setup/session work promptly rather than allowing background backlog to stall active turns. Preserve already accepted turns for retry/recovery.
7. **Keep the two retention clocks separate.** On completion or cancellation, expire Redis JSON at the terminal time plus 20 minutes. Keep the profile, transcript, captured audio, and debrief archive available for authorized download until 72 hours after the terminal time. Deny new download requests after that cutoff; clean up archive objects asynchronously.
8. **Keep evidence honest.** Mark a task complete only with implementation evidence. Label measured behavior, prior setup, user-reported work, and proposed behavior separately. Do not claim clinical validity from software checks.
9. **Keep browser storage limited.** Do not put the private patient profile, diagnosis, transcript, or provider IDs in local storage. Keep browser storage for non-sensitive preferences; use the authenticated session cookie and server-side state for encounter identity and recovery.

## Existing foundation

| Area | Current evidence | Still required |
| --- | --- | --- |
| Client and API | Nuxt/Vue encounter shell, typed patient API contracts, Express health/readiness routes, generic Responses endpoint. | Authenticated session, setup, turn, clinical-action, assessment, and archive routes. |
| Providers and data clients | OpenAI, PostgreSQL, and Redis Node clients are installed; local PostgreSQL and Redis Stack were previously reported healthy; API readiness checked their connections. | Application schemas, migrations, workflow writes, outage/recovery behavior, and verified patient-session use. |
| Redis recovery | Local Redis Stack 7.4.7 uses AOF every-second sync, periodic snapshots, and a named `/data` volume; there is no replica. | Recovery exercise, stream/backlog monitoring, capacity limits, and later host-loss redundancy. |
| Setup and tooling | Private `.env`, project-scoped MCPs, and reported Nuxt/editor remediation. | Keep credentials private; do not treat tooling or editor health as workflow completion. |

These foundations are context for sequencing. They do not complete any patient-workflow node in the [companion checklist](plangpt-modernization-checklist.md).

## Implementation sequence

Complete the phases in order where they establish shared contracts or data ownership. Within each phase, use the matching IDs in the companion checklist and keep its acceptance evidence with the change.

### Phase 1 — Contracts, identity, and session bootstrap

- [x] **1A — Inventory canonical patient-profile fields and seed inputs.** Treat `services/api/catalog/patient-profile.json` as the canonical full-profile field list; separately identify active GPTMD inputs, Nuxt008's visible setup, historical generator choices, and examples/fixtures that are not live seeds.
- [x] **1B — Generate and validate the full patient profile in provider context.** The API module creates a Responses Conversation before generation; requests a strict structured profile using the canonical field catalog, including only case-relevant history entries; validates schema, dates, counts, and age/reproductive consistency; and retries a rejected profile at most once in a fresh Conversation. The authenticated setup route now commits the validated profile and Conversation binding to PostgreSQL with its immutable scenario snapshot.
- [x] **1C — Derive the setup profile from that scenario.** `services/api/src/patient-setup.ts` preserves the canonical names `fullName`, `dateOfBirth`, `bodyType`, `reasonForVisit`, and `diagnosis` in the private setup record. The learner-safe response uses the same names and omits `diagnosis`. No second model call or field renaming is used.
- [x] Define runtime-validated schemas for the immutable patient scenario, patient-reported fact expansions, session state, turns, clinical actions, terminal events, and archive status.
- [x] Implement authentication, tenant/session ownership checks, entitlements, quotas, and opaque application session IDs. `services/api/src/auth.ts` validates issuer- and audience-bound HS256 bearer tokens; PostgreSQL membership and entitlement checks gate API use; monthly session/response limits and active-session limits are reserved transactionally; session IDs are 256-bit random base64url values and reads require matching owner and tenant. Database provisioning and identity-provider token issuance remain deployment setup.
- [x] Make scenario setup idempotent. `POST /api/sessions/:sessionId/setup` requires an `Idempotency-Key`; PostgreSQL locks the owned session while generating, validates and saves one immutable profile plus digest and provider Conversation binding, and marks the session `ready` in the same commit. Matching retries return the saved learner-safe result; a different key conflicts. Session creation pins prompt, configured model, schema, and policy versions, and setup uses those stored versions.
- [x] Keep provider Conversation IDs internal and tied to the authenticated application session. The ID is stored only in the private `patient_scenarios` row and is omitted from HTTP responses.
- [ ] **1D — Build the signed-in home and account entry points.** Present Instructions, History-Taking Overview, Account Status (usage, metrics, downloads, and payment gateway), Contact Us, and Begin Visit. Preserve authentication and account context when opening an encounter. The signed-in UI and Supabase Auth integration are implemented; the local Auth-only Docker stack is healthy and the Google authorization start was verified. Full browser sign-in and GPTMD tenant membership provisioning remain before end-to-end sign-in is complete.
- [ ] **1E — Add encounter preflight and permission handling.** Show a clear consent/readiness modal. Request microphone access from an explicit user action for audio use; microphone denial must retain a usable transcript path when permitted. Explain client-side storage honestly: local storage is not a sensitive-session vault, and any browser persistence request is separate from microphone access.
- [ ] **1F — Coordinate patient setup and readiness.** Allocate opaque `sid` (app session) and per-visit `ppid` (synthetic patient profile) identifiers; initialize the Redis JSON patient receptacle and bind it to the session; only then trigger setup generation. After the prompt returns a validated profile with its Conversation ID, save that ID against both identifiers and resolve the same Conversation for later turns. Store the complete private profile and internal five-value projection in Redis; return the client-safe values sans diagnosis, if any. Select and preload the matching image assets, report readiness, keep the LED amber while required steps are pending, and turn it green and enable Enter Room only when ready.

**Phase gate:**

- [ ] Repeated setup requests produce one stable scenario; unauthorized or cross-tenant access returns no patient data.
- [ ] A setup retry cannot create a second active `sid`/`ppid` pairing or expose the private profile or provider Conversation ID to the browser.
- [ ] The Enter Room action stays disabled until profile, Redis state, required image assets, and the selected audio/input mode are ready; text-only use can proceed without microphone permission.

#### 1A — Canonical patient-profile fields and existing seed inventory

[`services/api/catalog/patient-profile.json`](../services/api/catalog/patient-profile.json) is the canonical, evolving catalog of possible full patient-profile fields; it may grow as requirements are clarified. It is not a requirement to populate every field for every patient. For each added field, define its meaning, data type, and required/optional/inapplicable behavior, then decide whether the patient-profile schema version or stored data needs migration. Preserve the catalog; select and require fields according to each scenario's clinical relevance. Represent a relevant negative (for example, no alcohol use) separately from unknown or not yet elicited information, and omit or mark fields that do not apply. Do not invent personal history just to fill the catalog. This inventory separates canonical profile fields from actual seed values, historical source material, and illustrative records. **The 1B generator now runs through the authenticated, idempotent setup route and saves the accepted scenario in PostgreSQL before session activation.**

**Current GPTMD runtime inputs and examples**

- **Actual generation seeds:** none found. Cases are generated from the canonical field catalog rather than checked-in runtime seed records.
- **Current response contract:** `fullName`, `dateOfBirth`, `bodyType`, and `reasonForVisit`. It is the learner-safe subset of the private scenario and omits `diagnosis`.
- **Nuxt008 historical setup request:** the earlier client used `patientName`, `patientDob`, `patientBodytype`, `patientReason`, and `patientDiagnosis`. These are legacy names, not current GPTMD contract fields. Its backend is absent from the Nuxt008 repository, so the client does not show whether that backend generated a complete profile first.
- **Current test fixture:** Ari Nguyen · DOB 1990-01-01 · average · pelvic pain. This is test data, not an active scenario seed.
- **Checked-in JSON placeholder:** Example Patient · DOB 1990-04-15 · average · irregular menstrual cycles. This is an incomplete example, not a generated case.

**Historical generator options documented in `docs/plangpt.md`**

- **Identity:** choose a first and last name from finite lists; the documentation does not enumerate the names. Choose age 20–57, derive a DOB, and choose body type `average` or `heavy`.
- **Complaint/diagnosis pairs:** irregular menstrual bleeding → abnormal uterine bleeding; pelvic pain → endometriosis; missed period and nausea → early intrauterine pregnancy; vaginal itching/discharge → vaginitis; painful urination/urgency → urinary tract infection.
- **Profile content requested by the historical prompt:** medical, lifestyle, gynecologic, obstetric, psychological/psychosocial, medication/pharmacological, and family histories; comorbidities; patient concern; and communication traits such as mood, maturity, verbosity, education, and willingness to volunteer information.

**Historical examples, not generator seeds**

- Jane Doe · DOB 1985-05-15 · average · PCOS · irregular periods.
- Emily Clark · DOB 1985-07-23 · average · PCOS · irregular cycles and abdominal discomfort.

These examples appear in legacy notes; they do not prove either patient was selected by a runtime generator. The age range 20–57 is also only historical behavior and cannot constrain the target profile, which must validate age-dependent facts such as a 16-year-old not being menopausal and a 75-year-old not being pregnant.

**1A finding:** GPTMD currently has no live patient-profile seed inputs. `services/api/catalog/patient-profile.json` defines the canonical detailed patient-profile fields; the historical prompt documents some broad history categories but is not an exhaustive schema and does not supersede that list. Recoverable historical seed values are the name-list/age/body-type rules and five complaint/diagnosis pairs above. Nuxt008 confirms the five-field frontend/image-selection boundary but does not establish its backend generation order. The target must generate and validate the complete canonical profile first, then derive that five-field projection from it.

#### 1B — Generate and validate the full patient profile

The generator first creates the **complete private patient profile**: identity, a clinically coherent current case, the histories relevant to that case, patient beliefs, supported exam/test findings, diagnosis or explicitly unknown status, and stable communication traits. The field catalog in `services/api/catalog/patient-profile.json` does not mean every case needs every field. Define which fields are required, optional, or inapplicable for each scenario; distinguish an explicit negative from unknown information; track “not yet elicited” in encounter disclosure state rather than treating it as a profile value; and never invent unrelated personal history to fill a field. Create the session's OpenAI Conversation before generation, then generate the profile as a structured Responses result in that conversation so the provider retains the scenario for later turns. Validate the profile as one case before activating the session. Save the same full profile as the app-owned canonical record in PostgreSQL and its active copy in Redis; the OpenAI Conversation is model context, not the app's ownership or recovery database. Do not construct the visible variables independently or let them disagree with the profile.

The private scenario contract uses canonical names `fullName`, `dateOfBirth`, `bodyType`, `reasonForVisit`, and `diagnosis`; the learner response has the same four public names and omits `diagnosis`. `services/api/src/patient-profile.ts` mirrors the canonical history field list and `docs/schemas/patient-scenario-profile.schema.json` is generated from its strict runtime schema. The authenticated setup route selects public fields without renaming them. The generator returns only after validation succeeds; on a rejected result it abandons that Conversation and retries once with a new one. Provider and validation errors preserve abandoned Conversation IDs for a later policy-controlled cleanup path. Conversation deletion does not itself erase its items. `POST /api/sessions/:sessionId/setup` saves one validated immutable snapshot and its provider Conversation binding in PostgreSQL before marking the session ready; its idempotency key makes matching retries return the saved result.

Age and reproductive facts must be checked together using age calculated from DOB at the session's fixed start time. Reject or regenerate contradictory cases: a 16-year-old must not be seeded as menopausal, and a 75-year-old must not be seeded as pregnant. Historical pregnancies remain possible only when their ages and timeline are coherent. Validate complaint, diagnosis, history, and supported results against each other before any patient response is generated.

#### 1C — Derive five setup variables and enter the image-selection lane

After the complete profile passes validation, derive these five values directly from it in application code, following Nuxt008's five-value setup boundary. `services/api/src/patient-setup.ts` implements this projection from the accepted `PatientScenarioProfile`; it also maps the internal projection to the four-field learner response. The authenticated setup route persists the immutable scenario before returning the learner projection.

1. `fullName`
2. `dateOfBirth` (ISO `YYYY-MM-DD`)
3. `bodyType`
4. `reasonForVisit` (chief complaint)
5. `diagnosis` (if any)

Treat this as a selection from the validated profile, not a second model request or a second set of names. That avoids a second model round trip, additional output/input tokens, and mismatched demographics. The five-value private setup record feeds server-side setup and image selection. Image selection uses `dateOfBirth` to calculate the age band and `bodyType` to select the matching portrait directory. The client response contains the same first four fields and omits private `diagnosis`.

#### 1D — Signed-in home and account entry points

The Nuxt client has home entry points for Instructions (`/tutorial`), History-Taking Overview (`/history-taking`), Account Status (`/account`), Contact Us (`/contact`), and Begin Visit (`/encounter`). Google sign-in uses self-hosted Supabase Auth over the official Docker Compose stack with the Nuxt SSR-cookie integration and PKCE. The encounter and account routes require a signed-in user when the Supabase endpoint is configured. The client sends its access token to the Express API; the API resolves active workspace membership in GPTMD PostgreSQL and checks each requested workspace. Account Status lets users sign out and select among multiple workspaces, and reserves sections for usage, metrics, downloads, and payment access. It reports unavailable account data honestly; HTTPS hosted checkout links appear only when the corresponding `NUXT_PUBLIC_PAYMENT_CHECKOUT_6_MONTH_URL` or `NUXT_PUBLIC_PAYMENT_CHECKOUT_12_MONTH_URL` is configured, and the billing portal link appears only when `NUXT_PUBLIC_PAYMENT_PORTAL_URL` is configured. Checkout links do not activate workspace access because payment confirmation is not connected yet. Contact uses the optional `NUXT_PUBLIC_SUPPORT_EMAIL`. Account and encounter data are not written to browser storage.

**Payment direction:** Offer prepaid 6- and 12-month access terms. The customer must initiate each renewal; do not automatically charge off-session. Google Pay (GPay) is the planned primary online checkout method, with a phone-scannable QR payment option for local customers and PayPal to be added later. Select a provider that supports one-time Google Pay checkout and local QR payments with reliable server-side payment confirmation. Generate a unique QR/invoice per renewal and extend access only after confirmed payment. The payment provider and renewal checkout flow remain unselected.

**Implementation boundary:** the signed-in application path is implemented, including Supabase token handoff and server-side membership checks. The self-hosted Supabase stack has Google OAuth configured, and the authorization start was verified to redirect to Google with the expected callback; full browser sign-in and GPTMD tenant membership provisioning remain unverified. Account usage summaries, learning metrics, downloads, and billing services remain unimplemented and are shown as unavailable. Payment direction is prepaid 6- and 12-month terms with customer-initiated renewal, GPay first, local phone QR, and PayPal later. The account UI accepts HTTPS hosted checkout links per term, but provider selection, actual checkout configuration, payment confirmation, renewal reminders, and entitlement expiry/extension remain to be implemented. Do not treat a Google identity alone as an active GPTpatient workspace.

#### 1E — Encounter preflight, consent, and browser capabilities

When the encounter opens, explain the selected interaction mode and show its readiness state. Ask for microphone access only when the user chooses an audio mode and from a clear user action; if access is denied, keep transcript/text input available when that mode is allowed. Do not present local storage as a browser permission equivalent to microphone access: ordinary web storage has no such prompt. Use it only for non-sensitive preferences. Never store the patient profile, diagnosis, transcript, audio, or provider IDs in local storage. If persistent browser storage is useful for an explicitly supported offline preference, `navigator.storage.persist()` is a distinct, best-effort request and does not authorize storing clinical session data. See [microphone access](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) and [persistent browser storage](https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/persist).

#### 1F — Bind session, patient profile, provider context, and readiness

Use `sid` for the opaque authenticated application session and `ppid` for the opaque synthetic patient profile created for that visit. `ppid` is not a person's login identity or a reusable real-patient identifier. The authenticated `sid` owns the visit; Redis keeps a session-to-`ppid` binding and a Redis JSON profile receptacle keyed by the per-visit `ppid`. Initialize both with an `initializing` state and an idempotency key before setup generation. Do not expose either private profile data or provider IDs to the browser.

The authenticated setup route validates the application session and owner, then the PostgreSQL session row lock serializes duplicate setup requests. The generator creates the OpenAI Conversation, sends the pinned structured setup prompt, validates the response, and returns the accepted profile and its `conversationId` together. The route saves the immutable scenario, digest, and private Conversation binding, then marks the session ready in the same database commit. Matching retries return that saved result. A rejected profile is retried in a fresh Conversation, and only the successful attempt's ID is bound to the active profile. `responseId` is request/result metadata; `conversationId` is the continuity handle. Redis mirroring and `ppid` allocation remain follow-up work.

When a valid profile and its Conversation ID return together, derive the learner-safe profile from the validated source and save the immutable scenario, digest, version pins, and Conversation binding in the same PostgreSQL transaction as the session's `ready` transition. Return only the four client-safe values, sans diagnosis. Redis mirroring and portrait selection remain follow-up work. Keep the diagnosis, complete profile, and provider Conversation ID server-side. The readiness coordinator reports which prerequisites are pending; show amber while setup, Redis, image loading, or the selected audio/input mode is pending, and green only when all required components are ready. Enable Enter Room only in that ready state. Microphone readiness is required for a selected audio mode, but it must not block an allowed text-only visit. Other non-payload work stays asynchronous under the project's response-latency rule.

#### Provider persistence and cost/performance

The [Assistants migration guide](https://developers.openai.com/api/docs/assistants/migration) directs new interactions to use Conversations with Responses; its mapping is thread to conversation and run to response. It also says prior history must come from messages stored by the application. The [conversation state guide](https://developers.openai.com/api/docs/guides/conversation-state) describes a Conversation as a durable provider-side object that stores items and can be reused across Responses calls. For each new app session, create that Conversation before profile generation and generate the full profile inside it. This gives later patient turns the same provider context, but it does not replace GPTMD's own database or recovery history: PostgreSQL owns durable application records, Redis owns the active low-latency copy, and the provider Conversation is model context.

Generate the full profile once. Derive the five setup values locally; a second model call only to extract them would add a round trip and token cost without adding useful information. Stateful Conversations remove manual history assembly; they do not make prior context free. Conversation items are prepended to the next Response, so the full profile and accepted history continue to contribute input tokens and can grow toward the model's context limit. Keep the profile concise and structured, record input, output, cached-token use, latency, and estimated cost per session, and benchmark realistic short and long encounters against the selected model's current [pricing](https://developers.openai.com/api/docs/pricing). Prompt caching may lower charges for repeated eligible prefixes, but does not remove the profile from context or eliminate its latency, retention, and privacy considerations. If context management or compaction is needed, rebuild it only from the app-owned scenario and event history. A failed profile validation must not leave a bad scenario in the active Conversation: abandon that provider context and retry in a fresh one within a bounded policy.

### Phase 2 — Redis live state and PostgreSQL durable history

- [ ] Define PostgreSQL migrations and constraints for customer/session records, immutable scenario references, ordered session events, usage, download engagement, and outcomes.
- [ ] Implement Redis JSON storage for active patient/session state and a Redis Stream for accepted-turn and terminal events. Commit the live state, accepted reply, retry key, and recovery event atomically in one Redis request.
- [ ] Implement a PostgreSQL event worker that reads the stream, persists events in order and idempotently, and acknowledges only after commit.
- [ ] Add recovery from Redis persistence and rebuild of active state from PostgreSQL history when Redis state is missing. Document the accepted one-second Redis loss window and verify the local recovery path.

**Phase gate:**

- [ ] A repeated turn ID returns the saved reply without a duplicate event. A worker retry cannot duplicate database records. A Redis restart and a PostgreSQL outage have documented, exercised recovery paths.

### Phase 3 — Serialized patient turns and history-taking

- [ ] Implement the turn lock and idempotency handling per session. Build model input only from the authorized scenario, accepted facts, disclosure state, and current encounter phase.
- [ ] Validate model output and proposed fact expansions against the immutable scenario, prior accepted facts, chronology, and fixed test/exam results.
- [ ] Save the accepted reply and all state required for the next turn in the single Redis commit. Return without waiting for PostgreSQL or a background worker.
- [ ] Persist transcript, coverage, disclosure, and assessment events through workers. Keep model failure and validation-failure audits asynchronous.

**Phase gate:**

- [ ] Turns remain serialized within a session; retries return the same accepted reply; one session cannot read another session’s facts; no unvalidated model fact becomes canonical.

### Phase 4 — Orders, exams, assessment, and debrief

- [ ] Implement authorized orders and exams against fixed scenario catalogs, including consent, decline, chaperone, completion, and supported findings.
- [ ] Track pertinent history coverage without forcing irrelevant or sensitive questions.
- [ ] Validate learner assessment submission; score against a versioned, educator-reviewed rubric; generate debrief from durable scenario and accepted event history.
- [ ] Keep answer keys hidden until an authorized instructor view or the permitted debrief stage.

**Phase gate:**

- [ ] Results and findings come only from the fixed scenario; patient-reported claims cannot become confirmed tests or exam findings; assessment and debrief are reproducible from saved records.

### Phase 5 — Transcript, speech, and Full Audio

- [ ] Keep transcript mode as the initial text path and make optional speech synthesis independent of event persistence.
- [ ] Add consent and entitlement checks for audio. Bind each real-time connection to one authenticated application session.
- [ ] Reconcile transcript, phase, and action events with Redis session state; persist them to PostgreSQL asynchronously.
- [ ] Recover from reconnects without losing accepted encounter state or applying an action twice.

**Phase gate:**

- [ ] Text and audio modes use the same patient/session state machine; browser reconnect and provider disconnect do not duplicate turns or expose another session.

### Phase 6 — Completion, archives, and records

- [ ] On completion or cancellation, atomically record terminal state in Redis, set the absolute 20-minute Redis JSON expiry, and queue the terminal event without waiting for PostgreSQL.
- [ ] Have background workers persist the terminal event and create one idempotent archive job. Build the private profile, transcript, audio, and debrief archive only after all earlier session events are durable.
- [ ] Authorize each download through terminal time plus 72 hours, issue short-lived URLs within the remaining window, and record request versus completed transfer as separate events.
- [ ] Keep client/session records, usage, download activity, and outcomes in PostgreSQL after temporary Redis state and archive objects expire.

**Phase gate:**

- [ ] No archive is marked ready before content and metadata checks pass; no new download is authorized after the cutoff; cleanup delays do not extend access.

### Phase 7 — Workers, back-pressure, and observability

- [ ] Run PostgreSQL persistence, usage/download recording, archive work, and cleanup in dedicated background workers. Use worker threads only for CPU-heavy work such as compression.
- [ ] Bound queues and retries; monitor queue age, size, worker lag, Redis memory, stream retention, and database availability.
- [ ] Instrument learner-visible stages separately from background handoff and worker completion. A handler must never await background completion.
- [ ] Reject new work quickly at configured high-water marks; keep accepted work recoverable and alert on unconfirmed events.

**Phase gate:**

- [ ] For every request path, demonstrate zero waiting on side work. Keep measured nonblocking handoff overhead below 5 ms. Report model, network, lock, and payload-critical Redis timings separately from background work.

### Phase 8 — Deployment and release

- [ ] Keep Nuxt and the Express API as separate deployables. Keep PostgreSQL and Redis private and backend-only; configure secrets, named volumes, health/readiness, graceful shutdown, and backups.
- [ ] Test the Redis Stack 7.4 to Redis 8 upgrade separately before adopting it. Confirm JSON/Streams behavior, persistence, expiry, and recovery before changing the runtime.
- [ ] Complete clinical educator review, security and privacy review, load/back-pressure checks, recovery exercises, and retention acceptance before release.

**Phase gate:**

- [ ] Production-like verification covers service restart, Redis data recovery, PostgreSQL outage and catch-up, worker retry, duplicate turns, queue overload, 20-minute active-state expiry, and the 72-hour archive access boundary.

## Cross-phase acceptance rules

- [ ] Keep all 286 detailed node IDs and labels aligned with the seven focused D2 maps; use the overview flow for navigation, not duplicate work.
- [ ] Enforce zero waiting on non-payload operations in every user-facing request; verify that handlers do not await side-work promises.
- [ ] Give every durable write an owner, stable identifier, idempotent retry behavior, and recovery path; give every queue capacity and age monitoring.
- [ ] Separate application implementation evidence from infrastructure readiness and clinical educator approval.
- [ ] Run focused checks for changed behavior, then `npm run check` for application changes. For documentation-only plan changes, verify links and node references without claiming application tests ran.

## Source documents

- [Modernization design and rationale](plangpt-modernization.md)
- [286-node implementation companion checklist](plangpt-modernization-checklist.md)
- [Editable D2 diagrams](diagrams/)
- [Current versus proposed implementation status](plangpt-modernization.md#status-at-a-glance)
