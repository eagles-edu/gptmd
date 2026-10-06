# GPTMD Modernization Companion Checklist

**Status (2026-10-06):** The worktree contains verified identity/bootstrap foundations, immutable PostgreSQL scenarios, RedisJSON active profile/session state, Redis Stream to PostgreSQL worker persistence, serialized transcript turns, and an unscored assessment submission. A local recovery verification now also confirms that accepted patient facts, disclosures, transcript utterances, assessment, and terminal state rebuild from PostgreSQL while the immutable scenario remains intact. Accepted exchanges project to learner/patient transcript utterances with speaker, timestamp, phase, modality, and turn ID; local repair/stop utterances and actual browser speech-synthesis delivery remain unpersisted. The PP response guide is checked against all canonical history fields and generates matched-field examples plus shared response policy for the turn prompt: direct answers are the default, and hesitation is occasional and case-specific. Free-text semantic consistency and educator review of actual model behavior remain open. Accepted history facts also persist their PP section and field ID together. The encounter presents name, date of birth, and reason for visit on a simulated chart to the left of the patient-image area. Body type is excluded from that chart and from patient-turn model context; the app uses it internally to select the portrait directory. Ten generated prototype portraits now load from the selected age/body directories; approval of their age, representation, and production suitability remains outstanding. New setup Conversations have their profile/answer-key items removed and the empty context verified before entering the turn lane. The configured PostgreSQL database contained no session or scenario rows on 2026-10-05, so no pre-safeguard provider contexts were application-referenced at that audit. Phase 3 remains in progress: educator rubric/case approval, cross-field age plausibility, full obstetric validation, exam/test findings, scoring, and actionable debrief remain open or deferred. Checkmarks mean the node’s behavior is implemented and covered by the cited code path and configured checks; a passed high-level gate does not complete later nodes. **Inventory:** 286 actionable nodes from the seven detailed modernization D2 maps. The overview flow is navigation and is not counted again. Each checkbox below has the same node ID as its D2 task, so the plan and checklist stay traceable.

## How to use this checklist

- A node is complete only when its behavior exists in the module boundary below, its acceptance evidence passes, and failure/recovery behavior is documented in the implementation. Dependency installation, healthy infrastructure, or a generic readiness endpoint alone does not complete a patient-workflow node.
- Keep items unchecked until the behavior is implemented and evidenced. Mark a node partially complete in its linked implementation notes; do not mark it complete based on design prose alone.
- The D2 files under `docs/diagrams/` remain the source for node wording and order. When a diagram node changes, update its checklist entry in the same change.

### Phase 2 storage boundary quick check

These summary boxes point to the detailed nodes below; they are not additional inventory nodes.

- [x] RedisJSON holds the active patient profile and session state (`d06`, `t28`).
- [x] PostgreSQL holds the immutable scenario (`d01`, `d03`).
- [x] Accepted-turn and disclosure events go through the Redis Stream worker into PostgreSQL (`d01`, `d05`, `t29`, `t30`, `t32`, `t34`).

## Existing foundations and evidence boundaries

| State | Foundation | Evidence boundary |
| --- | --- | --- |
| Present in source | Nuxt/Vue application shell, encounter UI, patient API contracts and generated schemas; Express API; OpenAI, PostgreSQL, and Redis client adapters. | Includes live session creation, structured scenario setup, RedisJSON patient/session state, serialized text turns, and a Redis Stream persistence worker. Orders/exams, assessment/debrief, archive/download lifecycle, and production deployment remain unimplemented. |
| Previously runtime-verified | Local PostgreSQL healthy, Redis returned `PONG`, API `/readyz` reported PostgreSQL/Redis ready and OpenAI configured; project-scoped filesystem/Redis/PostgreSQL MCPs were registered. | This evidence came from the prior setup pass and was not re-run while creating this checklist. Refresh it before relying on current runtime state. |
| Redis recovery checked 2026-09-30 | Running local Redis Stack 7.4.7 has append-only persistence set to sync every second, periodic snapshots enabled, a Docker named volume for `/data`, and healthy last-write/last-snapshot status. | This supports recovery after a Redis process/container restart while the host volume remains intact. The instance has no replica; the local volume does not protect against host/disk loss. A sudden failure can lose about the most recent second of Redis writes under the current policy. |
| Phase 2 gate (user-confirmed) | PostgreSQL migrations and constraints, RedisJSON live state, atomic accepted-turn/disclosure/terminal stream handoff, idempotent PostgreSQL event worker, Redis recovery, and local recovery checks. | The gate confirmation does not imply that every detailed node in sections 2–7 is complete. |
| User-reported setup work | OpenAI API setup and private `.env`, project-aligned MCPs, PostgreSQL creation, Redis Stack instantiation, and Nuxt/VS Code extension cleanup. | Keep these visible as completed setup work; do not confuse them with the clinical workflow nodes below. The VS Code crash investigation tied renderer termination to host OOM; it did not establish an extension as the cause. |

## Technology choices scrutinized

- **RedisJSON owns active profile/session state; PostgreSQL owns the immutable scenario and durable records.** The API reads and updates the active patient profile in RedisJSON. In the same Redis transaction, it appends the completed turn and one event per disclosed fact to a Redis Stream. A separate PostgreSQL worker copies stream entries into durable clinical history in turn/event-ordinal order and acknowledges each entry only after the database commit. Stable event IDs make retries safe. Redis persistence provides recovery for live state; PostgreSQL scenario and event rows provide the rebuild source.
- **Keep background work out of the response path.** The handler may wait only for authentication, model output, and the Redis read/write needed to produce and safely save the accepted patient turn. Saving the live profile, reply, retry key, and recovery event together is payload-critical state work; PostgreSQL persistence, metrics, archive creation/upload, notifications, analytics, and cleanup are not. Dispatch those side effects without awaiting them. The 5 ms measure is a ceiling for handoff overhead, not permission to wait for a worker or side service. JavaScript `async` code still delays the response if the handler awaits it.
- **Use dedicated workers with bounded queues.** PostgreSQL event persistence, usage accounting, download tracking, archives, and cleanup run in separate worker processes. CPU-heavy work such as compression may use a worker thread. Workers retry safely, and the PostgreSQL event writer acknowledges a stream entry only after the matching event commits. Monitor queue age and size; reject new sessions quickly before a queue fills rather than making an active learner wait. Keep pending stream entries until PostgreSQL confirms them, even if this means their retention can extend beyond the 20-minute Redis JSON session expiry during a database outage.
- **Choose behavior when the event queue is unavailable.** The learner response path must not wait on PostgreSQL. If Redis cannot save the live session and its recovery event, fail the turn quickly without returning a reply that cannot be retried safely. The current Redis AOF policy allows about one second of write loss after a sudden failure; the local Redis instance has no replica, so host-loss redundancy remains future work. Keep audio files out of Redis.
- **Redis Stack is not the only way to store JSON in Redis.** The current Redis Stack service supports it; Redis 8 also includes it. Keep the current setup until an upgrade has been checked for saving and reading session data, timed cleanup, and recovery. The existing `redis` Node package supports this, so no additional Redis package is called for.
- **PostgreSQL keeps the lasting event history and records.** Save clinical events, session records, terminal state, usage, download events, and outcomes with constraints and turn IDs. Point-in-time restore requires configured backups and archived change records; a healthy connection alone does not prove that recovery works.
- **Responses Conversations hold the provider's live model context.** Create one Conversation before generating the full patient profile, then pass that Conversation to each Responses call. Conversation items are supplied to later calls and new request/response items are appended automatically, so do not rebuild and resend the transcript. This removes application-side history assembly; it does not remove token use or make long histories free. Measure context size, input/cached tokens, latency, and cost. Keep PostgreSQL and Redis as the app-owned recovery source, following the [Assistants migration guide](https://developers.openai.com/api/docs/assistants/migration) and [Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create).
- **Use the event stream for cross-store work.** The Redis accepted-turn and disclosure events are queued with the active-state change, and terminal events are queued with completion/cancellation. Workers write terminal state and unique archive/cleanup jobs to PostgreSQL idempotently. Set Redis JSON expiry to an absolute terminal timestamp plus 20 minutes; the event stream has separate retention and is trimmed only after PostgreSQL confirms persistence.
- **Keep archive bytes outside Redis and PostgreSQL rows.** Use a private artifact-store adapter for the profile/transcript/debrief bundle and separately staged audio. PostgreSQL stores ownership, archive state, timestamps, and metrics. The API authorizes each download request through terminal time plus 72 hours and then denies new requests; mint short-lived download URLs on demand, capped at the remaining window. A transfer authorized before the cutoff may finish later; exact mid-transfer termination would require streaming through the API and stopping at the deadline. Object lifecycle cleanup can run asynchronously after that cutoff.

References: [Redis JSON data type](https://redis.io/docs/latest/develop/data-types/json/), [Redis Streams and consumer groups](https://redis.io/docs/latest/develop/data-types/streams/), [Redis 8 feature availability](https://redis.io/docs/latest/operate/rc/databases/configuration/advanced-capabilities/), [Redis key expiry](https://redis.io/docs/latest/develop/using-commands/keyspace/), [Redis persistence](https://redis.io/docs/latest/operate/oss_and_stack/management/persistence/), [Redis replication](https://redis.io/docs/latest/operate/oss_and_stack/management/replication/), [Redis latency](https://redis.io/docs/latest/operate/oss_and_stack/management/optimization/latency/), [node-redis JavaScript guide](https://redis.io/docs/latest/develop/clients/nodejs/), [PostgreSQL write-ahead logging](https://www.postgresql.org/docs/current/wal-intro.html), [S3 presigned URL expiry](https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html), and [S3 lifecycle cleanup](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lifecycle-mgmt.html).

## Functional module boundaries and interfaces

These are proposed TypeScript module boundaries for the detailed tasks. They fit beneath `services/api/src/modules/`; route handlers should validate/authenticate requests and delegate to these modules rather than owning clinical logic.

```text
modules/
  identity/ sessions/ setup/
  scenarios/ active-scenarios/ turns/
  history/ coverage/ assessment/ debrief/
  orders/ exams/ audio/ realtime/
  model-policy/ transcript/ mode-transitions/
  retention/ archives/ metrics/ observability/
  runtime/
```

| Functional module | Discrete responsibilities and subroutines | Internal TypeScript boundary |
| --- | --- | --- |
| 1. Identity and session bootstrap | Identity adapter authenticates users and builds `AuthContext`; authorization checks tenant, owner, role, entitlements, and quotas; `SessionService` creates and transitions opaque app sessions; `SetupService` enqueues idempotent setup, validates structured seeds, commits the immutable scenario, then pins provider and policy IDs. | `services/api/src/modules/identity/`, `sessions/`, and `setup/`. Interfaces: `IdentityProvider`, `SessionRepository`, `SetupQueue`, `ScenarioSeedRepository`. |
| 2. Scenario data and serialized turns | Redis JSON owns the live patient/session state, and a Redis Stream records each accepted turn in the same transaction; dedicated PostgreSQL workers persist events in order and acknowledge only after commit. `TurnOrchestrator` authenticates, serializes turns, enforces idempotency, builds the authorized model input, validates output, and returns without waiting for PostgreSQL. | `services/api/src/modules/scenarios/`, `active-scenarios/`, `turns/`, and `background-workers/`. Interfaces: `ScenarioRepository`, `ActiveScenarioJournal`, `TurnLock`, `IdempotencyRepository`, `TurnOrchestrator`, `PostgresEventWriter`. |
| 3. History, coverage, assessment, and debrief | History expansion matches a learner question to bounded seed cues and persists only validated patient-reported facts; coverage tracks asked, missing, sensitive, and irrelevant topics; assessment validates and stores the learner submission; scoring uses a versioned educator-reviewed rubric; debrief produces actionable feedback from the durable case and accepted facts. | `services/api/src/modules/history/`, `coverage/`, `assessment/`, and `debrief/`. Interfaces: `HistoryService`, `CoverageRepository`, `AssessmentService`, `ScoringQueue`, `DebriefService`. |
| 4. Clinical actions and audio | Order workflow authorizes requests and resolves only fixed scenario results; exam workflow enforces indication, consent, chaperone, completion, and supported findings; audio policy checks entitlement and consent; Realtime bridge authenticates each app session, reconciles transcript/action events, and restores from application state after disconnect. | `services/api/src/modules/orders/`, `exams/`, `audio/`, and `realtime/`. Interfaces: `OrderService`, `ExamService`, `AudioPolicy`, `RealtimeBridge`, `TranscriptReconciler`. |
| 5. Model and interaction policy | Resolve server-side model aliases from entitlements and budgets; pin model, tier, prompt, and policy versions at session start; keep Transcript and Full Audio modes independent from model tier; accept typed or recognized transcript input; transition modalities only through a checkpointed app-state rebuild. | `services/api/src/modules/model-policy/`, `transcript/`, and `mode-transitions/`. Interfaces: `ModelPolicyResolver`, `InteractionPolicy`, `TranscriptService`, `ModeTransitionService`. |
| 6. Retention, archive, and operations | A Redis terminal event is copied to PostgreSQL by a background worker, which commits an idempotent archive job; an archive worker waits until earlier session events are stored, then builds a private archive from durable records and separately staged audio. New downloads are denied after 72 hours while a previously authorized transfer may finish; Redis JSON expires at terminal time plus 20 minutes; event-stream entries remain until PostgreSQL confirms them. | `services/api/src/modules/retention/`, `archives/`, `metrics/`, `observability/`, and `background-workers/`. Interfaces: `ArchiveService`, `ArchiveArtifactStore`, `TerminalOutboxRepository`, `ActiveScenarioJournal`, `PostgresEventWriter`, `UsageRepository`, `DownloadEventRepository`, `RetentionPolicy`. |
| 7. Delivery and release gates | Compose and production topology include PostgreSQL and a Redis deployment with JSON capability; health gates cover both stores and archive dependencies; Redis Stack 7.4 may be upgraded to Redis 8 only after compatibility/recovery checks; secrets, network exposure, graceful shutdown, request policy, and redacted logs are enforced. | `services/api/src/modules/runtime/` plus deployment manifests and acceptance/evaluation suites. Interfaces: `DependencyReadiness`, `RuntimeLifecycle`, `DeploymentConfig`, `AcceptanceGate`. |

### Core persistence and archive interfaces

The domain types should be derived from the runtime-validated schemas. These narrow interfaces define ownership without prescribing a storage vendor for the 72-hour archive artifact:

```ts
export interface ActiveScenarioJournal {
  load(sessionId: SessionId): Promise<ActiveScenario | null>
  commitTurnAndQueueEvent(input: ActiveTurnCommit): Promise<CommittedActiveTurn>
  commitTerminalAndQueueEvent(input: ActiveTerminalCommit): Promise<void>
}

export interface PostgresEventWriter {
  persistBatch(events: SessionEvent[]): Promise<void>
  recordTerminalAndOutbox(record: TerminalSessionRecord, job: TerminalOutboxJob): Promise<void>
}

export interface EventStreamConsumer {
  acknowledge(eventIds: SessionEventId[]): Promise<void>
  retry(eventIds: SessionEventId[], nextAttemptAt: Date): Promise<void>
}

export interface PostgresRecordWriter {
  recordUsage(event: ProviderUsageEvent): Promise<void>
  recordDownload(event: DownloadEngagementEvent): Promise<void>
  recordOutcome(event: SessionOutcomeEvent): Promise<void>
}

export interface TerminalOutboxRepository {
  claimNext(): Promise<TerminalOutboxJob | null>
  complete(jobId: OutboxJobId): Promise<void>
  retry(jobId: OutboxJobId, nextAttemptAt: Date): Promise<void>
}

export interface ArchiveArtifactStore {
  writePrivate(archiveId: ArchiveId, artifact: SessionArchive): Promise<void>
  read(archiveId: ArchiveId): Promise<SessionArchive | null>
  createShortLivedReadUrl(archiveId: ArchiveId, expiresAt: Date): Promise<string>
  deleteExpired(archiveId: ArchiveId): Promise<void>
}

export interface ArchiveService {
  create(sessionId: SessionId, terminalEventId: TerminalEventId): Promise<ArchiveDescriptor>
  getDownload(sessionId: SessionId, clientId: ClientId): Promise<DownloadDescriptor>
  purgeExpired(now: Date): Promise<number>
}
```

Record download requests and outcomes by adding events to the background stream without delaying URL delivery. Treat URL issuance as a request/engagement event, not proof that bytes were downloaded; record completion from an API-proxied transfer or reconcile object-store access events when available. Use private objects, restrictive response headers, and short URL lifetimes because a signed URL is a bearer credential.

**Lifecycle invariant:** Redis JSON holds live patient/session state, and the Redis Stream records each accepted turn in the same transaction as its reply and retry key. This is the single payload-critical save needed for a correct, retryable response. The handler never waits for PostgreSQL or any other side worker. Dedicated workers persist stream entries, metrics, and archive jobs. They acknowledge events only after PostgreSQL confirms them, using event IDs so retries do not duplicate records. The archive worker waits for all earlier session events to be stored. Redis JSON expires 20 minutes after completion or cancellation; unconfirmed stream entries have separate retention. The API checks session ownership and denies new download requests after 72 hours. Background work must never hold a payload response; dispatch is nonblocking and its overhead stays below 5 ms.

## Acceptance gates shared by every module

- Request boundaries validate runtime data, authenticate the client, enforce tenant/session ownership, and return bounded errors without leaking scenario data.
- Every module follows the payload latency contract: do not await PostgreSQL, metrics, archives, notifications, analytics, cleanup, or worker completion from a learner-facing request. Side-work dispatch is nonblocking; measure its overhead against the 5 ms ceiling. The only write awaited for a patient turn is the Redis save of the live turn, reply, retry key, and recovery event as one payload-critical commit.
- Commit accepted live turns and their Redis Stream events together. Dedicated workers persist events to PostgreSQL in session order, use stable IDs to make retries safe, and acknowledge only after the commit.
- Bound every background queue, monitor age and size, and reject new work quickly before overload can block active learners or drop unpersisted events.
- Tests cover normal operation, duplicate requests, invalid/cross-tenant requests, dependency outage, timeout/retry, restart/recovery, and retention boundaries appropriate to the module.
- Scenario completion and cancellation enqueue a terminal event in Redis without waiting for PostgreSQL; workers persist the event and unique archive job, then build one archive after prior events are durable. Redis JSON expires at terminal time plus 20 minutes; new download requests are denied after 72 hours even if object deletion is delayed; URL expiry is shorter and never extends the application cutoff; a transfer authorized before cutoff may finish.
- PostgreSQL download/usage/outcome records survive archive purge. Audio capture and archive access follow explicit consent and retention policy.

## 1. Identity and session bootstrap

**Source:** `docs/diagrams/plangpt-modernization-identity-setup.d2`
**Boundary:** `identity/`, `sessions/`, and `setup/`.

### 1. Identity and session bootstrap

**Subroutines:** Identity adapter authenticates users and builds `AuthContext`; authorization checks tenant, owner, role, entitlements, and quotas; `SessionService` creates and transitions opaque app sessions; `SetupService` enqueues idempotent setup, validates structured seeds, commits the immutable scenario, then pins provider and policy IDs.

**Boundary:** `services/api/src/modules/identity/`, `sessions/`, and `setup/`.

**User sequence:** Complete `a01`–`a05` login and account resolution, then show `i01`–`i04` home-page destinations. `i05` opens the encounter. Run `i06`–`i08` preflight; after the user continues, create `sid` through `a06`–`a14`, then reserve `ppid` and Redis state before invoking setup. This puts session creation at Begin Visit, rather than creating an encounter session merely because the user logged in.

#### Signed-in home and visit entry

- [x] `i01` Show the signed-in home page after authentication
- [x] `i02` Link Instructions and History-Taking Overview
- [x] `i03` Show Account Status: usage · metrics · downloads · payment gateway (sections are present; the underlying data feeds remain open)
- [x] `i04` Provide Contact Us entry point
- [x] `i05` Begin Visit opens the encounter screen with account context

**Conversation-control method carried into the visit:** Treat conversation as a volley: each speaker helps the other repair a breakdown so the exchange can continue. Coach the learner through one step at a time: (1) ask for a repeat, repeating the request as many as three or four times when needed; (2) ask for louder, slower, or simpler speech; (3) ask for an unfamiliar word or phrase to be explained another way; (4) ask for spelling; and (5) ask for it to be written down in English if the earlier steps fail. The patient uses the same repair sequence when the learner is unclear. Writing is the final take-home fallback; preserve the original English wording in the encounter transcript and offer a direct text-file download. Translation is not part of this repair flow.

#### Encounter preflight and browser capabilities

- [x] `i06` Explain voice/transcript modes, browser speech processing, and local-data handling
- [ ] `i07` Use cross-browser real-time STT for the voice conversation; keep standard browser `SpeechRecognition` only as an optional, editable, explicit single-question convenience. Realtime transcription, explicit visit consent, tenant entitlement/privacy-approval gates, finite monthly grant quota, finalized-transcript-only turn submission, transcript fallback, and raw-audio non-persistence are implemented. The API keeps the ephemeral credential and provider call ID server-side while proxying the SDP handshake. Migration 017 stores each provider call's deadline; the PostgreSQL worker hangs it up after 15 minutes, retries failures with bounded backoff, and reclaims stale claims after restart. Client RMS silence detection sends `input_audio_buffer.commit` 700 ms after speech ends; unit and Chromium/Firefox/WebKit E2E tests verify this commit and the later seven-second finalized-transcript submission. The local `npm run dev` launcher starts the expiry worker, and API readiness checks the schema. Migration 009 defaults audio enablement and privacy approval to false and leaves the per-user monthly quota unset; the current local database has no tenant entitlement rows. Enabling this path requires tenant configuration for both gates and a finite quota. E2E uses synthetic audio energy and mocked provider transcripts; this does not verify physical microphone capture or live provider connectivity. `arecord -l` reports no capture soundcard in this environment, so real-microphone proof remains open. **Defer server-observed audio-duration metering:** the app does not observe trusted provider usage duration. OpenAI bills streaming transcription by audio duration; see [Realtime API costs](https://developers.openai.com/api/docs/guides/voice-latency-cost#realtime-api-costs).
- [x] `i08` Keep private profile · diagnosis · transcript · provider IDs out of browser storage

#### Authentication and account resolution

- [ ] `a01` Learner / instructor / customer administrator (membership roles are modeled; only learner encounter access is implemented, with instructor and customer-administrator workflows deferred)
- [x] `a02` Nuxt client requests OIDC sign-in (the Supabase client starts Google OAuth; the browser test checks the provider redirect)
- [ ] `a03` OIDC provider authenticates user (provider redirect is browser-tested, but the end-to-end Google callback/token exchange has not been verified against configured live OAuth credentials)
- [x] `a04` App auth adapter resolves local identity (the API validates Supabase ES256 access tokens through JWKS and maps `sub` to the application subject; unit coverage verifies this boundary)
- [ ] `a05` Load organization · customer · user · role (the API resolves subject, tenant, and active membership role; organization/customer profiles remain unmodeled)
- [x] `a06` After Begin Visit and preflight, create session · POST /api/sessions
- [x] `a07` Check tenant ownership and role (session access remains tenant/user scoped; active membership role is loaded and encounter endpoints reject non-learners)
- [x] `a08` Deny cross-tenant request without state disclosure
- [ ] `a09` Load model · audio · exam · order entitlements (tenant session/Responses entitlements and audio-transcription enablement, privacy approval, and finite monthly per-user session quota are implemented; model-tier, exam, and order entitlements remain open)
- [x] `a10` Check per-user and per-session quota (optional tenant-configured per-user monthly session/Responses limits and per-session response limits are reserved with tenant usage in one PostgreSQL transaction; NULL is unlimited and zero denies use)
- [x] `a11` Return bounded quota response
- [x] `a12` Create one opaque app sessionId
- [x] `a13` Bind session to customer · tenant · user
- [ ] `a14` Rotate HTTP-only · Secure · SameSite cookie (deferred until the API has a same-origin BFF or another server-owned session boundary; the current separate-origin browser bearer flow would need coordinated token refresh, CSRF, and cookie rotation design)
- [ ] `a15` On each request authenticate cookie or authorized socket ticket (deferred with `a14`; the API currently verifies the Supabase bearer token and rechecks tenant membership on each request, while no authenticated socket lane exists)
- [x] `a16` Recheck session owner · tenant · role · entitlement (the API resolves active membership and learner role on each encounter request; session reads, setup, and turns verify owner/tenant, and session entitlement is rechecked before access or generation)
- [x] `a17` Browser never sends API key · model ID · provider context ID

#### Idempotent setup lane and immutable synthetic-patient seed creation

- [x] `s01` POST /api/sessions/:sessionId/setup
- [x] `s02` Authenticate · authorize owner · check setup entitlement
- [x] `s03` Check setup idempotency key
- [x] `s04` Return previously committed seed and setup result
- [x] `s05` Enqueue within bounded setup capacity (bounded process-local queue; configurable active and waiting limits; single-replica scope documented)
- [x] `s06` Enforce setup concurrency · queue · timeout · retry budget (queue wait deadline, OpenAI request timeout/retries, and one scenario-validation retry are bounded)
- [x] `s07` Return pending / overload response without partial activation (full/expired requests return retryable 503 before scenario generation; session stays initializing and same-key retry is supported)
- [ ] `s08` Load versioned prompt · schema · rubric · model config (prompt, schema, and model are pinned; educator rubric is not yet wired and awaits educator-reviewed rubric content)
- [x] `s09` Create random scenario seed once; reuse it on retry (a separate 256-bit seed is stored on `app_sessions` and passed unchanged to each bounded Responses generation attempt in the new Conversation; it guides variation but does not promise deterministic model output)
- [x] `s10` Build strict PatientScenarioSeed structured-output request
- [x] `s11` Generate identity · symptoms · onset · relevant negatives (the PP includes dedicated onset and pain-detail fields; scenario generation keeps onset out of learner-visible `reasonForVisit` and marks the `miscellaneousDetailsNos` catchall unknown when relevant. When asked, the fictional patient may give an approximate onset estimate or a catchall detail; these are recorded as generated patient reports and reused for consistency, never back-calculated into exact chronology. Patient-turn cue matching gates disclosure to asked topics. Educator case review remains part of `s08`/`s16`.)
- [x] `s12` Generate history cues · medications · allergies · patient concerns (current scenario schema v5 includes explicit allergies and patientConcern history fields; concern details enter turn context only for matched concern questions, and accepted disclosures use the durable fact/event path. Educator rubric and case-by-case review remain open under `s08`/`s16`.)
- [x] `s13` Generate clinician-hidden diagnosis or explicitly unknown status
- [x] `s14` Generate fixed exam findings · supported test/result catalog
- [x] `s15` Generate fixed bounded personality traits and persona seed (five fixed persona fields have explicit length bounds; the persisted session variation seed guides generation and the accepted persona is stored in the immutable scenario for session stability)
- [ ] `s16` Attach educator-reviewed rubric and version references (deferred until educators provide and approve a versioned rubric; no rubric content is being invented)
- [x] `s17` Call Responses API for structured setup output inside the session Conversation
- [x] `s18` Validate strict versioned JSON Schema
- [x] `s19` Validate field and cross-field constraints in application code
- [x] `s20` Discard rejected Conversation; retry same setup identity in fresh context
- [x] `s21` Mark setup failed; keep session inactive (after a pre-commit setup failure, only the owning still-initializing session transitions to `failed`; the setup error remains the API result)
- [x] `s23` Create one OpenAI Conversation before full-profile generation
- [x] `s24` Return validated profile and Conversation ID together to setup coordinator after prompt
- [x] `s22` Persist immutable scenario in PostgreSQL; seed RedisJSON active profile · projection · Conversation binding; return learner-safe values
- [x] `s26` Derive the five setup variables from the validated full profile in application code
- [x] `s25` Mark server setup ready; pin model · mode · policy versions (Transcript mode is the only supported mode)

#### Patient identity reservation, client readiness, and turn continuity

- [x] `i09` Allocate opaque per-visit ppid; bind it to authenticated sid
- [x] `i10` Create Redis JSON session mapping and initializing patient-profile receptacle
- [x] `i11` Confirm client preflight and Redis reservation before setup-generation command
- [x] `i12` Resolve the same server-held Conversation ID from sid + ppid for every later turn
- [x] `i13` Return four setup values (name, DOB, body type, reason for visit) without diagnosis after Redis commit; show body type only as an internal image-directory selector
- [ ] `i14` Select portrait folder from derived age band/body type and preload selected assets (ten generated prototype portraits now exist at `portrait-prototype.webp`, one in each selected age/body directory. At the user's request, each was restaged in an opaque exam gown, seated on an exam table and facing the camera at full seated distance; the user approved the first image's composition. The app chooses the matching file internally and keeps body type off the learner-facing chart; the readiness browser test verifies the selected portrait loads before Enter Room enables. Keep this node open pending approval of all generated likenesses for age representation, body-type representation, and production use.)
- [x] `i15` Show amber while required work is pending; show green and enable Enter Room only when ready (setup and portrait loading keep Enter Room disabled; the configured browser test verifies the transition)

### 2. Scenario data and serialized turns

**Subroutines:** Redis stores live session state, the accepted reply, its retry key, and the recovery event in one payload-critical turn transaction; `TurnOrchestrator` serializes each session, enforces idempotency, builds authorized model input, and validates output. Dedicated consumers persist those events in order to PostgreSQL without delaying the response; event IDs make retries safe.

**Boundary:** `services/api/src/modules/scenarios/`, `active-scenarios/`, and `turns/`.

#### Data records, authority boundaries and retention

- [x] `d01` PostgreSQL is the application system of record for immutable scenarios and worker-persisted events
- [ ] `d02` Tenant · user · role · entitlement · quota records (tenant memberships with role, session/Responses entitlements, audio-transcription enablement/privacy approval/monthly session quota, and usage quotas exist. Defer customer/user profile fields until customer-owned data requirements are defined; the authenticated provider subject is sufficient for current learner access. Model-tier, exam, and order entitlements need an agreed capability catalog.)
- [x] `d03` Immutable versioned PatientScenarioSeed and hidden answer key (the runtime and session response pins accept only current scenario schema v5; patient-turn records use their separate schema v3; older and unknown versions are rejected without adaptation)
- [x] `d04` Append-only PatientFactExpansion ledger with source and turn ID (stored in append-only accepted-turn event payloads)
- [x] `d05` Append-only disclosure ledger with disclosed fact IDs (accepted-turn snapshot plus individual ordered disclosure events)
- [x] `d06` Encounter snapshot: phase · mode · status · current turn (RedisJSON live state; PostgreSQL recovery rebuilds from accepted events)
- [x] `d07` Coverage: pertinent topics asked · relevant · missing (history topics only)
- [ ] `d08` Orders: order time · status · fixed result reference (defer order writes and result release until `d15` defines the fixed per-scenario catalog and `d11` defines durable action events; current free-text test/result strings are not safe order references)
- [ ] `d09` Exams: consent · decline · chaperone · mode · completion (defer exam workflows until an educator-approved indication, consent, and chaperone protocol can be represented; no forced-exam policy is being inferred)
- [x] `d10` Assessment: learner summary · differential · rationale · plan (the four required learner fields are runtime-validated and persisted as an `assessment_submitted` event; scoring remains open under `c13`–`c15` until an educator-reviewed rubric exists)
- [ ] `d11` Event ledger: ordered append-only turns · actions · phase changes (accepted turns, disclosures, assessment phase changes, submissions, and terminal events are ordered and persisted; clinical action events remain open with orders and exams under `d08`–`d09`)
- [ ] `d12` Transcript: speaker · timestamp · phase · modality · turnId (accepted-turn events now project to ordered learner/patient utterance rows through `session_transcript`; learner modality records the client-reported source as typed input or finalized Realtime transcription, and patient output is labeled as the canonical text response. Both rows use the accepted-turn timestamp. Local repair/stop utterances and browser-observed speech-synthesis completion are outside the current event contract and are not persisted; full transcript coverage remains open pending ordered event IDs, turn association, retry, and event-ordinal rules for those events.)
- [x] `d13` Mark expansion epistemic source as patient-reported or seeded / verified
- [x] `d14` Patient-reported statement cannot become a lab or exam result (patient facts and clinical actions use separate schemas; turn generation cannot create actions)
- [ ] `d15` Results and findings resolve only from fixed scenario catalog (defer fixed results and order resolution until educators approve a per-scenario catalog and its release rules; current free-text test/result strings are not safe deterministic references)
- [x] `d16` Record schema · prompt · model · rubric versions for replay (session and immutable-scenario rows pin schema/prompt/model/policy versions; each durable accepted turn also stores its turn prompt/model/schema/policy pins and the rubric version field, explicitly null until an educator-reviewed rubric exists)
- [x] `d17` Keep answer key hidden until authorized instructor or debrief (no learner API exposes it; newly created setup Conversation items are cleared and verified before turns; the configured PostgreSQL database contained zero session and scenario rows on 2026-10-05, so no pre-safeguard provider contexts were application-referenced)

#### One serialized text turn: authorize, validate, commit, then deliver

- [ ] `t01` Build the basic voice conversation: there is no Send button in the main voice loop; automatically submit recognized learner speech after seven seconds of silence and carry it through one authenticated Responses API patient turn. The LED controls turn-taking: red means inactive, green means it is the learner’s turn to speak, yellow means the patient is processing or speaking. Wait for green before the next turn. “See you next time” ends voice conversation. Conversation is a volley: each speaker helps the other repair a breakdown so the exchange can continue. Coach the learner and patient through this ordered sequence, one step at a time: (1) ask for a repeat, repeating the request as many as three or four times when needed; (2) ask for louder, slower, or simpler speech; (3) ask for an unfamiliar word or phrase to be explained another way; (4) ask for spelling; and (5) if unresolved, ask for it to be written down in English. “Please write that down” shows the patient’s reply as a written English note in the transcript and offers a direct text-file download for take-home access. Preserve the original wording; translation is not part of this repair flow. This is voice conversation, not a text-entry flow. Cross-browser real-time STT is the target; standard browser recognition is only an optional editable single-question convenience. See [legacy flow audit](plangpt.md).

  The normal interaction is spoken patient conversation with clear turns; do not listen for a new learner turn over patient playback. Conversation repair is a mutual, ordered volley: repeat first (up to three or four attempts if needed), then louder/slower/simpler, explain the word or phrase another way, spell it, and finally write it down in English. Address one repair request at a time and move on only while understanding remains unresolved. “Please write that down” is the specific text-interface exception: show the patient’s original English reply as a written note in the encounter transcript and offer a direct text-file download for take-home access. Translation is not part of this repair flow. A text Send control is not part of the main voice loop. Optional standard browser `SpeechRecognition` may provide editable, explicit single-question dictation where supported; never use `webkitSpeechRecognition`, and do not mistake that limited convenience for cross-browser STT.

  The recommended target for consistent cross-browser, live short-question STT is OpenAI Realtime transcription over browser WebRTC, with a server-minted ephemeral session credential; send its finalized transcript through the existing serialized Responses API lane. Use file transcription for the occasional longer recording, and keep live audio active only during the encounter. Interim text must never trigger a patient turn. Acceptance evidence must show: no Send button in the primary voice loop; exactly one turn auto-submitted after seven seconds of silence; red → green → yellow → green LED turn sequence; no learner recognition while the patient is speaking; mutual use of repair strategies; stop phrase ends the loop; “Please write that down” displays the patient reply as a note. Reference: [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription), [speech-to-text](https://developers.openai.com/api/docs/guides/speech-to-text), and [audio pricing](https://developers.openai.com/api/docs/pricing#transcription-and-speech).

  The configured browser test verifies seven-second submission, one microphone track sender, red → green → yellow → green LED states, playback turn gating (including a disabled microphone track while the patient speaks), the spoken stop phrase, and written-note download. Real-microphone testing across target browsers and educator/model evaluation of the full mutual repair sequence remain open, so this compound node stays unchecked.
- [x] `t02` Generate client turnId / idempotency key
- [x] `t03` POST /api/sessions/:sessionId/turns { turnId, text }
- [x] `t04` Authenticate access token or cookie; check tenant · session owner · turn entitlement
- [x] `t05` Runtime-validate request body and text limits
- [x] `t06` Acquire per-session turn lock
- [x] `t07` Check committed turnId in idempotency ledger
- [x] `t08` Return same committed patient reply for duplicate turn
- [x] `t09` Validate current phase and selected interaction mode (history + pinned Transcript only)
- [x] `t10` Reject invalid phase or concurrent active turn
- [x] `t11` Keep clinician input in turn context until atomic commit
- [x] `t12` Load only this session's authorized model projection (new setup Conversation items are cleared and verified before the turn lane; each request then adds only cue-bounded data; pre-safeguard persisted contexts are unaudited)
- [x] `t13` Add phase · cue-matched seed facts · accepted expansions
- [x] `t14` Add disclosure boundaries · fixed personality · history coverage state
- [x] `t15` Add pinned turn prompt · schema · model · policy versions (rubric not yet available)
- [x] `t16` Call Responses with stored conversationId and current input
- [x] `t17` Do not also send previous_response_id
- [x] `t18` Inspect refusal · incomplete · timeout · provider error
- [x] `t19` Queue safe provider-failure audit asynchronously; do not invent reply (identifier-only audit metadata enters the Redis worker stream; failure paths return no invented patient reply)
- [x] `t20` Validate structured patient utterance and proposed expansions
- [ ] `t21` Check seed · prior facts · chronology · age plausibility (setup and accepted turns reject exact ISO and unambiguous English month-name last-menstrual-period dates before birth, after scenario/encounter time, or impossible on the calendar; relative/ambiguous prose and educator-defined age plausibility remain open)
- [ ] `t22` Check obstetric outcomes · parity · child count · complications (the PP now separates gravidity, `numberPriorPregnanciesReaching20Weeks` parity, pregnancy-level `numberPregnanciesWithLiveBirth`, infant-level `numberLiveBirths`, and current `numberChildren`. Multiple gestations count once per pregnancy and once per infant. The API rejects parity greater than completed gravidity and rejects fewer live-born infants than live-birth pregnancies. Do not derive parity or living children from outcome counts. The PP defines `numberChildren` as living children only when a case establishes that meaning, so do not impose a numeric cap against live-born infants yet. Pregnancy-by-pregnancy chronology and complication coherence need educator-reviewed cases; child-count semantics need a case-level definition. Keep this compound node open.)
- [ ] `t23` Protect diagnosis · deterministic results · rubric · disclosure rules (answer-key context is cleared and disclosure fields are checked; the fixed-result workflow and educator rubric remain open)
- [x] `t24` Retry against same saved patient profile and Conversation
- [x] `t25` Queue validation-failure audit asynchronously after bounded retries (bounded failure/recovery categories, turn IDs, and attempt counts persist through the Redis stream worker without retaining prompt or conversation text)
- [x] `t26` Prepare safe clarification when output remains invalid
- [x] `t27` Begin Redis live-state and event-stream transaction
- [x] `t28` Update accepted patient-reported facts in RedisJSON
- [x] `t29` Append disclosure events to Redis Stream (each disclosed field/fact pair is appended atomically with the accepted turn using a deterministic event ID and per-turn ordinal; the worker persists and acknowledges it in order)
- [x] `t30` Append patient reply · input · turn-complete event
- [x] `t31` Append phase and audit events for background workers (assessment phase/submission events and bounded turn failure/recovery audits persist through Redis and the PostgreSQL worker; failure audits contain only event type, a SHA-256 turn ID hash, and attempt count, and do not delay the response. Migration `014_session_turn_audits.sql` and `node scripts/verify-phase2-session-history.mjs` verify persistence)
- [x] `t32` Commit live state · reply · retry key · recovery event together
- [x] `t33` On Redis commit failure, return no unjournaled reply
- [x] `t34` Return reply without waiting for PostgreSQL
- [x] `t35` Is optional TTS enabled? (voice mode is a learner-selected preflight option; replies are spoken only after the learner starts the voice conversation. Transcript mode and inactive voice mode do not synthesize replies. The unit test covers both enabled and disabled states, and the voice preflight E2E observes spoken playback.)
- [ ] `t36` Stream speech synthesis separately (deferred: the app currently uses local browser SpeechSynthesis after the complete patient reply. Provider TTS would add billable output, so first define a separate speech entitlement/quota, explicit learner opt-in, server-side access to the accepted reply, and the required AI-generated-voice disclosure. OpenAI's [text-to-speech guide](https://developers.openai.com/api/docs/guides/text-to-speech) documents chunked streaming and requires clear disclosure that the voice is AI-generated.)
- [x] `t37` Wait until reply and enabled playback complete (voice mode waits for the patient API reply and browser speech-synthesis playback to finish or error before reenabling the microphone; the preflight E2E verifies the microphone stays disabled during playback)
- [x] `t38` Release lock and allow next learner turn

### 3. History, coverage, assessment, and debrief

**Subroutines:** History expansion matches a learner question to bounded seed cues and persists only validated patient-reported facts; coverage tracks asked, missing, sensitive, and irrelevant topics; assessment validates and stores the learner submission; scoring uses a versioned educator-reviewed rubric; debrief produces actionable feedback from the durable case and accepted facts.

**Boundary:** `services/api/src/modules/history/`, `coverage/`, `assessment/`, and `debrief/`.

#### Natural, bounded expansion of history only when the learner asks a relevant question

- [x] `h01` Learner asks symptom or history question
- [x] `h02` Find matching seed cue and existing fact expansions
- [x] `h03` Is a bounded history cue relevant to this question?
- [x] `h04` Answer naturally in the fixed patient personality
- [ ] `h05` Propose only details compatible with the seed and question (field eligibility and cue relevance are checked; A/B PP examples and clinician fidelity guidance reach the model only for question-matched fields present in the scenario. This improves generation constraints but does not validate generated free text for semantic compatibility, so the node remains open.)
- [x] `h06` Send utterance and proposal through turn validation
- [x] `h07` Append accepted fact to the correct history section (the PP response guide assigns every canonical history field to a section; accepted facts persist that section and field ID together in the turn/event ledger. Turn and event records must satisfy the current schema, including section metadata. The learner-facing chart remains ungrouped.)
- [x] `h08` Reuse accepted detail on later turns; never rewrite seed
- [x] `h09` No cue: answer from known facts without a profile dump (setup context is cleared; no unrelated history fields are sent)
- [x] `h10` Record each detail as fictional patient-reported history
- [x] `h11` Keep sensitive questions patient-centered and case-relevant (the shared PP policy reaches the live prompt: direct answers are the default, hesitation is occasional and case-specific, a clinician may explain relevance and invite later disclosure, and a continued decline is respected without pressure. Educator review of actual model behavior remains open.)

#### Coverage, assessment phase, post-session scoring, and debrief

- [x] `c01` Track pertinent symptoms · reproductive context · relevant history in the history-only coverage state
- [ ] `c02` Track exam / test findings · synthesis · differential · plan (deferred pending fixed, educator-approved exam/order catalogs and result rules: the profile currently has scenario-supported finding fields, but the learner workflow has no consent/decline/chaperone/completion actions or durable finding references, and the assessment captures only summary, differential, rationale, and plan. Do not invent exam/test actions or findings to fill this gap.)
- [x] `c03` Mark each matched history topic asked · missing · sensitive · not relevant
- [x] `c04` Update encounter coverage state in RedisJSON and accepted-turn events
- [x] `c05` Learner uses visible button or says begin assessment (the visible button and a spoken assessment cue both open the confirmation dialog; see `c07`)
- [x] `c06` Is the phase-change cue explicit and unambiguous? (visible and recognized spoken requests open a confirmation dialog that explains the phase change)
- [x] `c07` Ask learner to confirm an ambiguous spoken cue (spoken requests to begin or move to assessment open the same explicit phase-change dialog without sending the phrase to the patient; cancel resumes voice listening, while confirmation stops voice and calls the authenticated assessment-phase route. The voice preflight E2E verifies no patient turn is generated and that confirmation changes phase.)
- [x] `c08` Set phase to assessment after confirmation (Redis state transition and `phase_changed` event)
- [x] `c09` Submit summary · differential / diagnosis · rationale · plan (captures summary, differential, rationale, and plan; exam/test findings remain open under `c02`)
- [x] `c10` Runtime-validate assessment request (strict Zod request and persistence schemas)
- [x] `c11` Return field errors; keep assessment editable (422 field errors preserve the learner draft)
- [x] `c12` Persist submission and assessment-complete event (assessment event and terminal completion persist through the Redis Stream worker)
- [ ] `c13` Enqueue scoring in separate post-session capacity lane
- [ ] `c14` Score against educator-reviewed versioned case rubric (deferred until educators provide and approve a versioned rubric; scoring criteria and outputs must not be fabricated)
- [ ] `c15` Return actionable debrief after submission
- [x] `c16` Preserve immutable seed and accepted expansions (the PostgreSQL trigger rejects scenario updates; `node scripts/verify-phase2-session-history.mjs` confirmed that an accepted patient-reported fact and disclosure recover from PostgreSQL while the original seeded profile stays intact)

### 4. Clinical actions and audio

**Subroutines:** Order workflow authorizes requests and resolves only fixed scenario results; exam workflow enforces indication, consent, chaperone, completion, and supported findings; audio policy checks entitlement and consent; Realtime bridge authenticates each app session, reconciles transcript/action events, and restores from application state after disconnect.

**Boundary:** `services/api/src/modules/orders/`, `exams/`, `audio/`, and `realtime/`.

#### Fixed orders and results: model proposals cannot create application authority

- [ ] `o01` POST /api/sessions/:sessionId/orders
- [ ] `o02` Recheck session owner · phase · order entitlement
- [ ] `o03` Validate test against scenario-supported order catalog
- [ ] `o04` Reject unsupported test; do not create model-invented order
- [ ] `o05` Create app order ID and pending order record
- [ ] `o06` Wait until configured scenario result-release condition
- [ ] `o07` Return pending status through GET order resource
- [ ] `o08` Resolve deterministic result reference from immutable seed
- [ ] `o09` Release fixed result and append result event
- [ ] `o10` GET /api/sessions/:sessionId/orders/:orderId
- [ ] `o11` Model tool call may propose; only API authorizes order and result

#### Scenario-indicated, consent-aware abdominal and pelvic exam sequence

- [ ] `e01` POST /api/sessions/:sessionId/exams
- [ ] `e02` Recheck owner · active phase · scenario exam entitlement
- [ ] `e03` Is the requested exam indicated by this case?
- [ ] `e04` Decline / deny exam; record choice without forced examination
- [ ] `e05` Request and record explicit consent
- [ ] `e06` Patient declines or stops exam; record consent state
- [ ] `e07` Is chaperone state required by the scenario?
- [ ] `e08` Record chaperone offer and choice
- [ ] `e09` Enter separate abdominal or pelvic exam phase
- [ ] `e10` Record exam actions and phase transitions
- [ ] `e11` Was the authorized exam completed?
- [ ] `e12` Incomplete exam: return no findings
- [ ] `e13` Completed exam: resolve permitted findings from seed
- [ ] `e14` Append exam completion and finding-reference events

#### Full Audio: optional server-controlled Realtime bridge and ledger reconciliation

- [ ] `r01` Require prototype privacy / fidelity gate before enabling
- [ ] `r02` Check customer audio entitlement and retention setting
- [ ] `r03` Capture mic audio after explicit browser action
- [ ] `r04` Open authenticated WebSocket bound to one app session
- [ ] `r05` Relay media through server-controlled API bridge
- [ ] `r06` Create provider Realtime session server-side
- [ ] `r07` Store Realtime sessionId separately from Responses conversationId
- [ ] `r08` Project only authorized case information; keep answer key private
- [ ] `r09` Stream patient audio; preserve LED turn-taking
- [ ] `r10` Authorize requested action against encounter state machine
- [ ] `r11` Reconcile final learner and patient transcripts
- [ ] `r12` Reconcile phase cues and authorized action events
- [ ] `r13` Commit transcript and action events to app event ledger
- [ ] `r14` On disconnect, restore from app state and deduplicate turnId
- [ ] `r15` Is raw audio retention explicitly entitled and enabled?
- [ ] `r16` Discard raw audio
- [ ] `r17` Retain audio under customer-controlled policy
- [ ] `r18` If privacy gate fails, leave Full Audio unavailable

### 5. Model and interaction policy

**Subroutines:** Resolve server-side model aliases from entitlements and budgets; pin model, tier, prompt, and policy versions at session start; keep Transcript and Full Audio modes independent from model tier; accept typed or recognized transcript input; transition modalities only through a checkpointed app-state rebuild.

**Boundary:** `services/api/src/modules/model-policy/`, `transcript/`, and `mode-transitions/`.

#### Model tier and modality are independent policy choices

- [ ] `m01` Customer admin enables tier aliases and account budget
- [ ] `m02` Check learner entitlement and quota for requested tier
- [ ] `m03` Resolve alias to server-side model configuration
- [ ] `m04` Pin tier · model alias · policy version at session start
- [ ] `m05` Resolve setup / canon-generation model independently
- [ ] `m06` Default Luna; evaluate Terra / Sol on same cases
- [ ] `m07` Promote optional tier only for measured educator quality gain
- [ ] `m08` Select Transcript or Full Audio separately from model tier
- [ ] `m09` Keep tier stable for entire patient encounter

#### Transcript mode: current prototype behavior (not the target voice-first experience)

- [x] `v01` Keep voice capture as a browser input to the existing Transcript turn lane; no full-audio session mode or audio service is opened
- [x] `v02` User gesture starts browser microphone recognition
- [x] `v03` The current browser-recognition path produces a finalized question; it is browser-dependent and does not establish cross-browser STT
- [x] `v04` Typed text is available as an alternate path; it is not the primary encounter interaction
- [x] `v05` Display recognized or typed transcript and patient response
- [x] `v06` Send the recognized question over the authenticated session API
- [x] `v07` Process via serialized Responses turn lane
- [x] `v08` The current prototype speaks returned text with browser speech synthesis; legacy parity instead used OpenAI speech audio streamed over Socket.IO, so this implementation detail is not evidence that the target should replace legacy spoken replies
- [x] `v09` Do not receive or retain raw microphone audio in GPTMD

#### Optional modality switch: rebuild from canonical app state, not provider context IDs

- [ ] `x01` Learner / policy requests modality switch
- [ ] `x02` Is switching allowed during this session?
- [ ] `x03` Deny switch and continue current mode
- [ ] `x04` Commit event-ledger checkpoint
- [ ] `x05` Close old provider context
- [ ] `x06` Start new Responses Conversation or Realtime session
- [ ] `x07` Rebuild authorized transcript and state projection only
- [ ] `x08` Record provider type · new ID · mode transition event

### 6. Retention, archive, and operations

**Subroutines:** A Redis terminal event is processed by workers that write terminal state and unique archive work to PostgreSQL; the archive worker waits for earlier turns, then stores and verifies the private archive. The API denies new download requests after terminal time plus 72 hours while an already-authorized transfer may finish. Redis JSON active state expires at terminal time plus 20 minutes; stream entries remain until PostgreSQL confirms them. PostgreSQL retains client/session records, usage, download engagement, and outcomes.

**Boundary:** `services/api/src/modules/retention/`, `archives/`, `metrics/`, and `observability/`.

#### Retention and deletion lifecycle

- [ ] `p01` Load customer text / audio retention policy
- [ ] `p02` Is text retention allowed and within retention period?
- [ ] `p03` Store transcript text events for restore and debrief
- [ ] `p04` Expire or omit transcript projection under policy
- [ ] `p05` DELETE /api/sessions/:sessionId
- [ ] `p06` Authenticate owner or authorized customer administrator
- [ ] `p07` Delete app-owned session · seed · facts · ledgers · transcript
- [ ] `p08` Request provider-context deletion where supported by policy
- [ ] `p09` Purge explicitly retained raw audio
- [ ] `p10` Record minimal deletion status if policy requires it

#### Scenario termination, archive handoff, temporary-state expiry, and durable records

- [ ] `b01` Scenario completes or is cancelled
- [ ] `b02` Worker records terminal state and unique archive job in PostgreSQL
- [ ] `b03` Idempotent worker builds archive from PostgreSQL and retained audio
- [ ] `b04` Verify private archive contents and metadata before publishing
- [ ] `b05` Authorize download until terminal time +72 hours; mint short-lived URL
- [ ] `b06` Set RedisJSON absolute expiry at terminal time +20 minutes
- [ ] `b07` Persist session · stats · provider usage · downloads · outcomes in PostgreSQL
- [ ] `b08` Retry archive idempotently from PostgreSQL and retained audio source
- [ ] `b09` Deny downloads initiated after 72 hours; asynchronously delete expired artifact

#### Scale-out and latency controls

- [ ] `q01` Begin with one API replica and PostgreSQL durable transactions
- [ ] `q02` Require RedisJSON for live session state and Redis Streams for event handoff
- [ ] `q03` Measure cross-replica coordination and websocket needs
- [ ] `q04` Add extra Redis pub/sub and rate-limit state only when measured
- [ ] `q05` Reconcile absolute terminal +20-minute expiry through PostgreSQL outbox
- [ ] `q06` PostgreSQL stores durable clinical ledger · client records · metrics
- [ ] `q07` Bound setup queue · concurrency · timeout · retries
- [x] `q08` Reserve capacity for interactive turns (the shared in-process Responses scheduler caps provider calls at four, lets setup use at most two, prioritizes queued learner-facing work, and bounds each lane's wait; API contention tests prove a rejected turn reaches neither session quota/state work nor model generation. This reservation is per API process and not distributed across replicas.)
- [ ] `q09` Bound post-session scoring separately (deferred: no scoring job exists until `c14` has an educator-approved, versioned rubric and scoring behavior; add a separate bounded lane when that prerequisite is implemented, without consuming interactive-turn capacity)
- [x] `q10` Back-pressure requests and serialize each session (setup generation is bounded by the active/waiting queue limits and timeout; patient turns, assessment-phase changes, and assessment submissions share the per-session Redis lock, fail fast with 409 on contention, and never overlap model generation or session-state mutation)
- [ ] `q11` Scale stateless API across independent customer sessions (deferred: the current systemd unit starts one loopback API process, with no replicated ingress/deployment or cross-replica acceptance and load evidence. Session state is externalized to PostgreSQL/Redis, but provider admission limits are per process; define the multi-replica topology and account-wide admission behavior before claiming scale-out.)
- [ ] `q12` Add worker pool only if setup / scoring harms measured turn latency (deferred until setup-versus-turn load measurements show interference; no p50/p95 comparison exists, and post-session scoring has no implementation or educator-approved rubric yet. Keep the existing single event-persistence worker until evidence supports a pool.)
- [x] `q13` Keep one modular API when no measured interference exists (one Express app is built in `services/api/src/app.ts` and has one loopback listener in `services/api/src/server.ts`; session/profile/turn/state/capacity logic and the asynchronous PostgreSQL event worker are split into separate modules. No collected latency evidence currently justifies splitting the API; scale-out remains open under `q11`.)
- [x] `q14` Commit active state · reply · retry key · event in one Redis round trip (one Lua `EVAL` sets the active session and patient JSON, writes the reply under its idempotency key, and appends accepted-turn/disclosure events; the regression asserts these operations and payloads stay in the same Redis command)
- [ ] `q15` Dedicated workers persist events · metrics · archives asynchronously (the session-event worker persists clinical/audit events, accepted-turn OpenAI input/cached/cache-write/output/total token counts and duration, and every completed scenario-generation response's usage when token counts are present, including responses rejected by profile validation; accepted-turn usage shares its event transaction, and standalone setup usage uses the idempotent provider-response ID. Redis entries are acknowledged only after commit. Provider IDs and metering stay outside clinical session history. For `gpt-6-luna`, the response-reported service tier and cache counts drive a public-rate estimate, versioned as `openai-api-pricing-2026-10-06`; unsupported models or tiers keep cost null. These are estimates from the [OpenAI API pricing table](https://developers.openai.com/api/docs/pricing), not account-specific billed charges. The pay-as-you-go, prompt-caching, and Batch fit assessment is recorded in [GPTMD cost feature evaluation](OAI-API-COST/GPTMD-cost-feature-evaluation.md): scenario setup sends the full canonical PP JSON with an explicit GPT-6 cache breakpoint after the stable instructions/catalog and before the changing seed; the Zod output schema remains in place. Two synthetic setup responses reported 1,938/1,936 input tokens and 1,880 cached tokens each, verifying eligibility and reuse; there is no production/session hit-rate baseline yet. Patient turns retain stable-policy-first ordering. Batch remains deferred until an educator-approved rubric and reference set exist. Transient queue metrics are covered under `z12`. Provider failures or responses without usage and archive job processing remain open. Durable download metrics are deferred until server-owned archive artifacts and an authorized download endpoint exist; the current take-home note is generated and downloaded in the browser, so its text stays client-side and is not sent for metrics.)
- [ ] `q16` Never await side work; keep nonblocking handoff under 5 milliseconds (the PostgreSQL worker runs independently and is not awaited by learner routes; turn-audit events dispatch with `setImmediate` and their Redis Stream append is not awaited by the response. Accepted-turn, phase, assessment, and terminal routes expose atomic Redis state-plus-event `EVAL` duration through `Server-Timing`; the API also emits per-process, 30-second summaries with bounded p50/p95 upper bounds, maximum, and count at or above 5 ms for those commits and audit-event enqueue. The Redis measurement includes the payload-critical save as well as its event handoff, so it is an upper bound rather than isolated queue cost. Keep the node open until real workload measurements establish the target.)

#### Operational observability and performance evidence

- [x] `z01` Timestamp browser capture and transcript display (the client records the last recognized-segment receipt time and each transcript row's first rendered time in memory/DOM attributes; no patient-content telemetry is persisted, and API/provider/audio timing remains open)
- [x] `z02` Timestamp API queue and per-session lock wait (the API exposes setup-queue wait and Redis turn-lock acquisition-attempt durations through `Server-Timing`, including fail-fast overflow/contention; the lock does not poll or wait behind an active turn, and timings are not durably stored)
- [x] `z03` Timestamp Responses first token and completion (the `/api/openai/responses`, scenario-setup, and patient-turn streams report first output/refusal-text delta and completed-event durations through `Server-Timing`; structured patient outputs remain buffered and validated before delivery, with no partial response or patient content persisted)
- [ ] `z04` Timestamp TTS first byte / completion and playback end (browser speech-synthesis request/start/end marks are captured transiently in the encounter DOM; the current API exposes no generated-audio-byte event, so first-byte timing remains open)
- [ ] `z05` Timestamp WebSocket delivery and Realtime first audio (current voice path sends learner audio over browser WebRTC and receives finalized input-transcription events over its data channel; it has no app WebSocket relay or spoken Realtime response, so these metrics wait for the planned Full Audio bridge)
- [ ] `z06` Measure p50 / p95 first token · first audio · full turn
- [ ] `z07` Measure setup concurrency separately from active turns
- [x] `z08` Record provider usage · session cost · CPU · memory (q15 persists response-reported token/model/tier data and versioned public-rate cost estimates with the accepted-turn event; worker and estimator tests cover persistence, idempotency, unknown rates, and token categories. On 2026-10-06, the live API and PostgreSQL worker each emitted 30-second CPU/RSS/heap/external-memory samples without session or patient data; API sample: 0.66% of one core and 173,322,240 RSS bytes; worker sample: 0.57% and 160,067,584 RSS bytes, with zero event backlog. A separate non-stored, nonclinical Responses request returned `gpt-6-luna` default-tier usage (14 input, 0 cached/write, 16 output tokens); the versioned estimator calculated $0.0000094, matching the current [OpenAI pricing table](https://developers.openai.com/api/docs/pricing). This sample verifies provider-reported usage and rate math, not an account-billed receipt. The local app database had zero session and usage rows, so no learner-session aggregate was created; session-level persistence remains covered by tests.)
- [ ] `z09` Compare complete TTS · streamed clauses · Full Audio on same cases
- [x] `z10` Keep one active patient turn; never parallelize a session (Redis `SET NX` acquires one expiring per-session lock; the state-store test rejects a second owner, and the session-store test holds one generation open while a competing turn receives `turn_in_progress` without another model call)
- [ ] `z11` Measure side-work wait (zero target) and handoff overhead (<5 ms) (session state/event commit durations and asynchronous audit-stream enqueue duration are summarized every 30 seconds by operation without session IDs or patient content; each summary reports sample count, bounded p50/p95 ceilings, maximum, and samples at or above 5 ms. No representative runtime traffic has yet established the target.)
- [x] `z12` Track stream age · backlog size · PostgreSQL worker lag (every 30 seconds, the worker logs pending and undelivered counts, combined backlog, oldest pending age, processed count, and maximum event-time-to-PostgreSQL-commit lag; unit coverage checks the values, confirms no session ID or patient content is exposed, and verifies observer failures do not interrupt persistence/acknowledgement. These are transient operational logs, not historical aggregates; provider usage is persisted under `q15`, while download metrics await a server-owned artifact and authorization flow.)

### 7. Delivery and release gates

**Subroutines:** Compose and production topology include PostgreSQL and Redis with JSON capability; health gates cover both stores and archive dependencies; test Redis Stack 7.4 to Redis 8 migration before changing runtime; secrets, network exposure, graceful shutdown, request policy, and redacted logs are enforced; release gates require clinical review, security/reliability evidence, latency/cost budgets, and educator acceptance.

**Boundary:** `services/api/src/modules/runtime/` plus deployment manifests and acceptance/evaluation suites.

#### Local and production deployment requests

- [ ] `u01` Local Compose starts Nuxt · API · PostgreSQL · Redis · background workers
- [ ] `u02` Configure Redis event stream · background persistence · 20-minute expiry · 72-hour archive
- [ ] `u03` Expose only web entry point to host
- [ ] `u04` Bind PostgreSQL / Redis to private Compose network
- [ ] `u05` Keep credentials in ignored env file or secret manager
- [ ] `u06` Build immutable · pinned Nuxt and API images
- [ ] `u07` Terminate HTTPS at ingress proxy
- [ ] `u08` Route /api and SSE to Express API
- [ ] `u09` Route authenticated audio WebSocket to API
- [ ] `u10` Keep PostgreSQL / Redis private
- [ ] `u11` Configure health · readiness · graceful socket drain
- [ ] `u12` Enforce body size · origin / CSRF · rate limits
- [ ] `u13` Redact logs; do not log patient turns · keys · cookies · audio
- [ ] `u14` Add request and turn correlation IDs

#### Greenfield implementation sequence and explicit acceptance gates

- [ ] `g01` 1 · Define seed · expansion · event · phase · action · retention schemas
- [ ] `g02` Medical educators review sample cases and rubric
- [ ] `g03` 2 · Implement OIDC · tenant ownership · roles · entitlements · quotas
- [x] `g04` Verify cross-tenant session access is denied (API integration coverage returns not-found for foreign-owner reads; session-store regression coverage verifies that setup, turn, and audio-grant queries scope by both tenant and subject and stop before generation or credential issuance.)
- [ ] `g05` 3 · Add PostgreSQL constraints and idempotent structured setup
- [x] `g06` Verify setup retries preserve exactly the same seed (session reservation persists the 256-bit seed; setup passes that stored value into generation, bounded generation attempts reuse it, and concurrent duplicate setup requests share the same result. Covered by session-store, patient-profile, and API integration tests; the seed guides variation and does not promise deterministic model output.)
- [ ] `g07` 4 · Build serialized Responses turns · expansions · disclosure · reconnect
- [x] `g08` Verify accepted facts survive reconnect and remain consistent (the local PostgreSQL/Redis recovery verification drops the live keys, reconstructs an accepted patient-reported fact and disclosure from durable events, and confirms the immutable seeded profile remains intact.)
- [ ] `g09` 5 · Build fixed results · consent-aware exams · assessment · debrief
- [ ] `g10` Verify unsupported findings and results cannot be created
- [ ] `g11` 6 · Ship Transcript; prototype private server-bridged Full Audio
- [ ] `g12` Verify reconnect · LED turn-taking · transcript reconciliation · privacy
- [ ] `g13` 7 · Ship Nuxt / API with PostgreSQL · Redis JSON · archive lifecycle
- [ ] `g14` 8 · Educator evaluation · load tests · latency and cost budgets
- [ ] `g15` Do quality and performance evidence meet release criteria?
- [ ] `g16` Release after clinical · security · reliability gates pass


**Checklist inventory:** 286 of 286 detailed nodes represented; IDs and wording match the seven source maps.
