# GPTMD Modernization Companion Checklist

**Status (2026-10-03):** The worktree contains verified identity/bootstrap foundations, immutable PostgreSQL scenarios, RedisJSON active profile/session state, Redis Stream to PostgreSQL worker persistence, and a bounded serialized transcript history turn. New setup Conversations have their profile/answer-key items removed and the empty context verified before entering the turn lane; legacy Conversation contexts created before this safeguard have not been audited. Phase 3 remains in progress: chronology and full obstetric validation, first-class disclosure/phase/audit events, and assessment transitions are still open. Checkmarks mean the node’s behavior is implemented and covered by the cited code path and configured checks; a passed high-level gate does not complete later nodes. **Inventory:** 286 actionable nodes from the seven detailed modernization D2 maps. The overview flow is navigation and is not counted again. Each checkbox below has the same node ID as its D2 task, so the plan and checklist stay traceable.

## How to use this checklist

- A node is complete only when its behavior exists in the module boundary below, its acceptance evidence passes, and failure/recovery behavior is documented in the implementation. Dependency installation, healthy infrastructure, or a generic readiness endpoint alone does not complete a patient-workflow node.
- Keep items unchecked until the behavior is implemented and evidenced. Mark a node partially complete in its linked implementation notes; do not mark it complete based on design prose alone.
- The D2 files under `docs/diagrams/` remain the source for node wording and order. When a diagram node changes, update its checklist entry in the same change.

### Phase 2 storage boundary quick check

These summary boxes point to the detailed nodes below; they are not additional inventory nodes.

- [x] RedisJSON holds the active patient profile and session state (`d06`, `t28`).
- [x] PostgreSQL holds the immutable scenario (`d01`, `d03`).
- [x] Accepted-turn events go through the Redis Stream worker into PostgreSQL (`d01`, `t30`, `t32`, `t34`).

## Existing foundations and evidence boundaries

| State | Foundation | Evidence boundary |
| --- | --- | --- |
| Present in source | Nuxt/Vue application shell, encounter UI, patient API contracts and generated schemas; Express API; OpenAI, PostgreSQL, and Redis client adapters. | Includes live session creation, structured scenario setup, RedisJSON patient/session state, serialized text turns, and a Redis Stream persistence worker. Orders/exams, assessment/debrief, archive/download lifecycle, and production deployment remain unimplemented. |
| Previously runtime-verified | Local PostgreSQL healthy, Redis returned `PONG`, API `/readyz` reported PostgreSQL/Redis ready and OpenAI configured; project-scoped filesystem/Redis/PostgreSQL MCPs were registered. | This evidence came from the prior setup pass and was not re-run while creating this checklist. Refresh it before relying on current runtime state. |
| Redis recovery checked 2026-09-30 | Running local Redis Stack 7.4.7 has append-only persistence set to sync every second, periodic snapshots enabled, a Docker named volume for `/data`, and healthy last-write/last-snapshot status. | This supports recovery after a Redis process/container restart while the host volume remains intact. The instance has no replica; the local volume does not protect against host/disk loss. A sudden failure can lose about the most recent second of Redis writes under the current policy. |
| Phase 2 gate (user-confirmed) | PostgreSQL migrations and constraints, RedisJSON live state, atomic accepted-turn/terminal stream handoff, idempotent PostgreSQL event worker, Redis recovery, and local recovery checks. | The gate confirmation does not imply that every detailed node in sections 2–7 is complete. |
| User-reported setup work | OpenAI API setup and private `.env`, project-aligned MCPs, PostgreSQL creation, Redis Stack instantiation, and Nuxt/VS Code extension cleanup. | Keep these visible as completed setup work; do not confuse them with the clinical workflow nodes below. The VS Code crash investigation tied renderer termination to host OOM; it did not establish an extension as the cause. |

## Technology choices scrutinized

- **RedisJSON owns active profile/session state; PostgreSQL owns the immutable scenario and durable records.** The API reads and updates the active patient profile in RedisJSON. In the same Redis transaction, it appends the completed turn to a Redis Stream. A separate PostgreSQL worker copies stream entries into durable clinical history and acknowledges each entry only after the database commit. Stable event IDs make retries safe. Redis persistence provides recovery for live state; PostgreSQL scenario and event rows provide the rebuild source.
- **Keep background work out of the response path.** The handler may wait only for authentication, model output, and the Redis read/write needed to produce and safely save the accepted patient turn. Saving the live profile, reply, retry key, and recovery event together is payload-critical state work; PostgreSQL persistence, metrics, archive creation/upload, notifications, analytics, and cleanup are not. Dispatch those side effects without awaiting them. The 5 ms measure is a ceiling for handoff overhead, not permission to wait for a worker or side service. JavaScript `async` code still delays the response if the handler awaits it.
- **Use dedicated workers with bounded queues.** PostgreSQL event persistence, usage accounting, download tracking, archives, and cleanup run in separate worker processes. CPU-heavy work such as compression may use a worker thread. Workers retry safely, and the PostgreSQL event writer acknowledges a stream entry only after the matching event commits. Monitor queue age and size; reject new sessions quickly before a queue fills rather than making an active learner wait. Keep pending stream entries until PostgreSQL confirms them, even if this means their retention can extend beyond the 20-minute Redis JSON session expiry during a database outage.
- **Choose behavior when the event queue is unavailable.** The learner response path must not wait on PostgreSQL. If Redis cannot save the live session and its recovery event, fail the turn quickly without returning a reply that cannot be retried safely. The current Redis AOF policy allows about one second of write loss after a sudden failure; the local Redis instance has no replica, so host-loss redundancy remains future work. Keep audio files out of Redis.
- **Redis Stack is not the only way to store JSON in Redis.** The current Redis Stack service supports it; Redis 8 also includes it. Keep the current setup until an upgrade has been checked for saving and reading session data, timed cleanup, and recovery. The existing `redis` Node package supports this, so no additional Redis package is called for.
- **PostgreSQL keeps the lasting event history and records.** Save clinical events, session records, terminal state, usage, download events, and outcomes with constraints and turn IDs. Point-in-time restore requires configured backups and archived change records; a healthy connection alone does not prove that recovery works.
- **Responses Conversations hold the provider's live model context.** Create one Conversation before generating the full patient profile, then pass that Conversation to each Responses call. Conversation items are supplied to later calls and new request/response items are appended automatically, so do not rebuild and resend the transcript. This removes application-side history assembly; it does not remove token use or make long histories free. Measure context size, input/cached tokens, latency, and cost. Keep PostgreSQL and Redis as the app-owned recovery source, following the [Assistants migration guide](https://developers.openai.com/api/docs/assistants/migration) and [Responses create reference](https://developers.openai.com/api/reference/resources/responses/methods/create).
- **Use the event stream for cross-store work.** The Redis turn/terminal event is queued with the active-state change. Workers write terminal state and unique archive/cleanup jobs to PostgreSQL idempotently. Set Redis JSON expiry to an absolute terminal timestamp plus 20 minutes; the event stream has separate retention and is trimmed only after PostgreSQL confirms persistence.
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
- [ ] `i07` Use cross-browser real-time STT for the voice conversation; keep standard browser `SpeechRecognition` only as an optional, editable, explicit single-question convenience. Preserve Transcript mode when the STT provider is unsupported or unavailable. Current voice loop still uses standard browser recognition, so this target remains open.
- [x] `i08` Keep private profile · diagnosis · transcript · provider IDs out of browser storage

#### Authentication and account resolution

- [ ] `a01` Learner / instructor / customer administrator
- [ ] `a02` Nuxt client requests OIDC sign-in
- [ ] `a03` OIDC provider authenticates user
- [ ] `a04` App auth adapter resolves local identity
- [ ] `a05` Load organization · customer · user · role
- [x] `a06` After Begin Visit and preflight, create session · POST /api/sessions
- [ ] `a07` Check tenant ownership and role
- [x] `a08` Deny cross-tenant request without state disclosure
- [ ] `a09` Load model · audio · exam · order entitlements
- [ ] `a10` Check per-user and per-session quota
- [x] `a11` Return bounded quota response
- [x] `a12` Create one opaque app sessionId
- [x] `a13` Bind session to customer · tenant · user
- [ ] `a14` Rotate HTTP-only · Secure · SameSite cookie
- [ ] `a15` On each request authenticate cookie or authorized socket ticket
- [ ] `a16` Recheck session owner · tenant · role · entitlement
- [x] `a17` Browser never sends API key · model ID · provider context ID

#### Idempotent setup lane and immutable synthetic-patient seed creation

- [x] `s01` POST /api/sessions/:sessionId/setup
- [x] `s02` Authenticate · authorize owner · check setup entitlement
- [x] `s03` Check setup idempotency key
- [x] `s04` Return previously committed seed and setup result
- [ ] `s05` Enqueue within bounded setup capacity
- [ ] `s06` Enforce setup concurrency · queue · timeout · retry budget
- [ ] `s07` Return pending / overload response without partial activation
- [ ] `s08` Load versioned prompt · schema · rubric · model config (prompt, schema, and model are pinned; educator rubric is not yet wired)
- [x] `s09` Create random scenario seed once; reuse it on retry
- [x] `s10` Build strict PatientScenarioSeed structured-output request
- [ ] `s11` Generate identity · symptoms · onset · relevant negatives
- [ ] `s12` Generate history cues · medications · allergies · patient concerns
- [x] `s13` Generate clinician-hidden diagnosis or explicitly unknown status
- [x] `s14` Generate fixed exam findings · supported test/result catalog
- [ ] `s15` Generate fixed bounded personality traits and persona seed (traits exist; a stable persona seed is not modeled)
- [ ] `s16` Attach educator-reviewed rubric and version references
- [x] `s17` Call Responses API for structured setup output inside the session Conversation
- [x] `s18` Validate strict versioned JSON Schema
- [x] `s19` Validate field and cross-field constraints in application code
- [x] `s20` Discard rejected Conversation; retry same setup identity in fresh context
- [ ] `s21` Mark setup failed; keep session inactive
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
- [x] `i13` Return client-safe four-value profile sans diagnosis, if any, after Redis commit
- [ ] `i14` Select portrait folder from derived age band/body type and preload selected assets
- [ ] `i15` Show amber while required work is pending; show green and enable Enter Room only when ready

### 2. Scenario data and serialized turns

**Subroutines:** Redis stores live session state, the accepted reply, its retry key, and the recovery event in one payload-critical turn transaction; `TurnOrchestrator` serializes each session, enforces idempotency, builds authorized model input, and validates output. Dedicated consumers persist those events in order to PostgreSQL without delaying the response; event IDs make retries safe.

**Boundary:** `services/api/src/modules/scenarios/`, `active-scenarios/`, and `turns/`.

#### Data records, authority boundaries and retention

- [x] `d01` PostgreSQL is the application system of record for immutable scenarios and worker-persisted events
- [ ] `d02` Tenant · user · role · entitlement · quota records
- [x] `d03` Immutable versioned PatientScenarioSeed and hidden answer key
- [x] `d04` Append-only PatientFactExpansion ledger with source and turn ID (stored in append-only accepted-turn event payloads)
- [x] `d05` Append-only disclosure ledger with disclosed fact IDs (stored in accepted-turn payloads; no separate disclosure event yet)
- [x] `d06` Encounter snapshot: phase · mode · status · current turn (RedisJSON live state; PostgreSQL recovery rebuilds from accepted events)
- [x] `d07` Coverage: pertinent topics asked · relevant · missing (history topics only)
- [ ] `d08` Orders: order time · status · fixed result reference
- [ ] `d09` Exams: consent · decline · chaperone · mode · completion
- [ ] `d10` Assessment: learner summary · differential · rationale · plan
- [ ] `d11` Event ledger: ordered append-only turns · actions · phase changes
- [ ] `d12` Transcript: speaker · timestamp · phase · modality · turnId
- [x] `d13` Mark expansion epistemic source as patient-reported or seeded / verified
- [x] `d14` Patient-reported statement cannot become a lab or exam result (patient facts and clinical actions use separate schemas; turn generation cannot create actions)
- [ ] `d15` Results and findings resolve only from fixed scenario catalog
- [ ] `d16` Record schema · prompt · model · rubric versions for replay
- [x] `d17` Keep answer key hidden until authorized instructor or debrief (no learner API exposes it; newly created setup Conversation items are cleared before turns; pre-safeguard persisted provider contexts are unaudited)

#### One serialized text turn: authorize, validate, commit, then deliver

- [ ] `t01` Build the basic voice conversation: there is no Send button in the main voice loop; automatically submit recognized learner speech after seven seconds of silence and carry it through one authenticated Responses API patient turn. The LED controls turn-taking: red means inactive, green means it is the learner’s turn to speak, yellow means the patient is processing or speaking. Wait for green before the next turn. “See you next time” ends voice conversation. Conversation is a volley: each speaker helps the other repair a breakdown so the exchange can continue. Coach the learner and patient through this ordered sequence, one step at a time: (1) ask for a repeat, repeating the request as many as three or four times when needed; (2) ask for louder, slower, or simpler speech; (3) ask for an unfamiliar word or phrase to be explained another way; (4) ask for spelling; and (5) if unresolved, ask for it to be written down in English. “Please write that down” shows the patient’s reply as a written English note in the transcript and offers a direct text-file download for take-home access. Preserve the original wording; translation is not part of this repair flow. This is voice conversation, not a text-entry flow. Cross-browser real-time STT is the target; standard browser recognition is only an optional editable single-question convenience. See [legacy flow audit](plangpt.md).

  The normal interaction is spoken patient conversation with clear turns; do not listen for a new learner turn over patient playback. Conversation repair is a mutual, ordered volley: repeat first (up to three or four attempts if needed), then louder/slower/simpler, explain the word or phrase another way, spell it, and finally write it down in English. Address one repair request at a time and move on only while understanding remains unresolved. “Please write that down” is the specific text-interface exception: show the patient’s original English reply as a written note in the encounter transcript and offer a direct text-file download for take-home access. Translation is not part of this repair flow. A text Send control is not part of the main voice loop. Optional standard browser `SpeechRecognition` may provide editable, explicit single-question dictation where supported; never use `webkitSpeechRecognition`, and do not mistake that limited convenience for cross-browser STT.

  The recommended target for consistent cross-browser, live short-question STT is OpenAI Realtime transcription over browser WebRTC, with a server-minted ephemeral session credential; send its finalized transcript through the existing serialized Responses API lane. Use file transcription for the occasional longer recording, and keep live audio active only during the encounter. Interim text must never trigger a patient turn. Acceptance evidence must show: no Send button in the primary voice loop; exactly one turn auto-submitted after seven seconds of silence; red → green → yellow → green LED turn sequence; no learner recognition while the patient is speaking; mutual use of repair strategies; stop phrase ends the loop; “Please write that down” displays the patient reply as a note. Reference: [Realtime transcription](https://developers.openai.com/api/docs/guides/realtime-transcription), [speech-to-text](https://developers.openai.com/api/docs/guides/speech-to-text), and [audio pricing](https://developers.openai.com/api/docs/pricing#transcription-and-speech).
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
- [x] `t19` Queue safe provider-failure audit asynchronously; do not invent reply
- [x] `t20` Validate structured patient utterance and proposed expansions
- [ ] `t21` Check seed · prior facts · chronology · age plausibility
- [ ] `t22` Check obstetric outcomes · parity · child count · complications (implemented subset: non-negative count checks and completed-outcome totals account for an active pregnancy; chronology, age plausibility, child-count consistency, and complications remain open)
- [ ] `t23` Protect diagnosis · deterministic results · rubric · disclosure rules (answer-key context is cleared and disclosure fields are checked; the fixed-result workflow and educator rubric remain open)
- [x] `t24` Retry against same saved patient profile and Conversation
- [x] `t25` Queue validation-failure audit asynchronously after bounded retries
- [x] `t26` Prepare safe clarification when output remains invalid
- [x] `t27` Begin Redis live-state and event-stream transaction
- [x] `t28` Update accepted patient-reported facts in RedisJSON
- [ ] `t29` Append disclosure events to Redis Stream
- [x] `t30` Append patient reply · input · turn-complete event
- [ ] `t31` Append phase and audit events for background workers
- [x] `t32` Commit live state · reply · retry key · recovery event together
- [x] `t33` On Redis commit failure, return no unjournaled reply
- [x] `t34` Return reply without waiting for PostgreSQL
- [ ] `t35` Is optional TTS enabled?
- [ ] `t36` Stream speech synthesis separately
- [ ] `t37` Wait until reply and enabled playback complete
- [x] `t38` Release lock and allow next learner turn

### 3. History, coverage, assessment, and debrief

**Subroutines:** History expansion matches a learner question to bounded seed cues and persists only validated patient-reported facts; coverage tracks asked, missing, sensitive, and irrelevant topics; assessment validates and stores the learner submission; scoring uses a versioned educator-reviewed rubric; debrief produces actionable feedback from the durable case and accepted facts.

**Boundary:** `services/api/src/modules/history/`, `coverage/`, `assessment/`, and `debrief/`.

#### Natural, bounded expansion of history only when the learner asks a relevant question

- [x] `h01` Learner asks symptom or history question
- [x] `h02` Find matching seed cue and existing fact expansions
- [x] `h03` Is a bounded history cue relevant to this question?
- [x] `h04` Answer naturally in the fixed patient personality
- [ ] `h05` Propose only details compatible with the seed and question (field eligibility and cue relevance are checked; free-text semantic consistency is not)
- [x] `h06` Send utterance and proposal through turn validation
- [ ] `h07` Append accepted fact to the correct history section (facts retain their field ID in the event ledger; grouped history sections are not modeled)
- [x] `h08` Reuse accepted detail on later turns; never rewrite seed
- [x] `h09` No cue: answer from known facts without a profile dump (setup context is cleared; no unrelated history fields are sent)
- [x] `h10` Record each detail as fictional patient-reported history
- [x] `h11` Keep sensitive questions patient-centered and case-relevant (the turn prompt requires respectful, nonjudgmental answers, permits refusal, and forbids pressure after a refusal; educator review of model behavior remains open)

#### Coverage, assessment phase, post-session scoring, and debrief

- [x] `c01` Track pertinent symptoms · reproductive context · relevant history in the history-only coverage state
- [ ] `c02` Track exam / test findings · synthesis · differential · plan
- [x] `c03` Mark each matched history topic asked · missing · sensitive · not relevant
- [x] `c04` Update encounter coverage state in RedisJSON and accepted-turn events
- [ ] `c05` Learner uses visible button or says begin assessment
- [ ] `c06` Is the phase-change cue explicit and unambiguous?
- [ ] `c07` Ask learner to confirm an ambiguous spoken cue
- [ ] `c08` Set phase to assessment after confirmation
- [ ] `c09` Submit summary · differential / diagnosis · rationale · plan
- [ ] `c10` Runtime-validate assessment request
- [ ] `c11` Return field errors; keep assessment editable
- [ ] `c12` Persist submission and assessment-complete event
- [ ] `c13` Enqueue scoring in separate post-session capacity lane
- [ ] `c14` Score against educator-reviewed versioned case rubric
- [ ] `c15` Return actionable debrief after submission
- [ ] `c16` Preserve immutable seed and accepted expansions

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
- [ ] `q08` Reserve capacity for interactive turns
- [ ] `q09` Bound post-session scoring separately
- [ ] `q10` Back-pressure requests and serialize each session
- [ ] `q11` Scale stateless API across independent customer sessions
- [ ] `q12` Add worker pool only if setup / scoring harms measured turn latency
- [ ] `q13` Keep one modular API when no measured interference exists
- [ ] `q14` Commit active state · reply · retry key · event in one Redis round trip
- [ ] `q15` Dedicated workers persist events · metrics · archives asynchronously
- [ ] `q16` Never await side work; keep nonblocking handoff under 5 milliseconds

#### Operational observability and performance evidence

- [ ] `z01` Timestamp browser capture and transcript display
- [ ] `z02` Timestamp API queue and per-session lock wait
- [ ] `z03` Timestamp Responses first token and completion
- [ ] `z04` Timestamp TTS first byte / completion and playback end
- [ ] `z05` Timestamp WebSocket delivery and Realtime first audio
- [ ] `z06` Measure p50 / p95 first token · first audio · full turn
- [ ] `z07` Measure setup concurrency separately from active turns
- [ ] `z08` Record provider usage · session cost · CPU · memory
- [ ] `z09` Compare complete TTS · streamed clauses · Full Audio on same cases
- [ ] `z10` Keep one active patient turn; never parallelize a session
- [ ] `z11` Measure side-work wait (zero target) and handoff overhead (<5 ms)
- [ ] `z12` Track stream age · backlog size · PostgreSQL worker lag

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
- [ ] `g04` Verify cross-tenant session access is denied
- [ ] `g05` 3 · Add PostgreSQL constraints and idempotent structured setup
- [ ] `g06` Verify setup retries preserve exactly the same seed
- [ ] `g07` 4 · Build serialized Responses turns · expansions · disclosure · reconnect
- [ ] `g08` Verify accepted facts survive reconnect and remain consistent
- [ ] `g09` 5 · Build fixed results · consent-aware exams · assessment · debrief
- [ ] `g10` Verify unsupported findings and results cannot be created
- [ ] `g11` 6 · Ship Transcript; prototype private server-bridged Full Audio
- [ ] `g12` Verify reconnect · LED turn-taking · transcript reconciliation · privacy
- [ ] `g13` 7 · Ship Nuxt / API with PostgreSQL · Redis JSON · archive lifecycle
- [ ] `g14` 8 · Educator evaluation · load tests · latency and cost budgets
- [ ] `g15` Do quality and performance evidence meet release criteria?
- [ ] `g16` Release after clinical · security · reliability gates pass


**Checklist inventory:** 286 of 286 detailed nodes represented; IDs and wording match the seven source maps.
