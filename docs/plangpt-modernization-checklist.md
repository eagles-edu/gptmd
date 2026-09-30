# GPTMD Modernization Companion Checklist

**Status:** Proposed target architecture; patient-session workflows are not implemented yet. **Inventory:** 286 actionable nodes from the seven detailed modernization D2 maps. The overview flow is navigation and is not counted again. Each checkbox below has the same node ID as its D2 task, so the plan and checklist stay traceable.

## How to use this checklist

- A node is complete only when its behavior exists in the module boundary below, its acceptance evidence passes, and failure/recovery behavior is documented. Dependency installation, healthy infrastructure, or a generic readiness endpoint alone does not complete a patient-workflow node.
- Keep items unchecked until the behavior is implemented and evidenced. Mark a node partially complete in its linked implementation notes; do not mark it complete based on design prose alone.
- The D2 files under `docs/diagrams/` remain the source for node wording and order. When a diagram node changes, update its checklist entry in the same change.

## Existing foundations and evidence boundaries

| State | Foundation | Evidence boundary |
| --- | --- | --- |
| Present in source | Nuxt/Vue application shell, encounter UI, patient API contracts and generated schemas; Express API health/readiness and generic Responses route; OpenAI, PostgreSQL, and Redis client adapters. | These are infrastructure and UI foundations. They do not implement authenticated sessions, scenario setup, clinical state writes, the 20-minute Redis JSON lifecycle, or the 72-hour archive. |
| Previously runtime-verified | Local PostgreSQL healthy, Redis returned `PONG`, API `/readyz` reported PostgreSQL/Redis ready and OpenAI configured; project-scoped filesystem/Redis/PostgreSQL MCPs were registered. | This evidence came from the prior setup pass and was not re-run while creating this checklist. Refresh it before relying on current runtime state. |
| Redis recovery checked 2026-09-30 | Running local Redis Stack 7.4.7 has append-only persistence set to sync every second, periodic snapshots enabled, a Docker named volume for `/data`, and healthy last-write/last-snapshot status. | This supports recovery after a Redis process/container restart while the host volume remains intact. The instance has no replica; the local volume does not protect against host/disk loss. A sudden failure can lose about the most recent second of Redis writes under the current policy. |
| User-reported setup work | OpenAI API setup and private `.env`, project-aligned MCPs, PostgreSQL creation, Redis Stack instantiation, and Nuxt/VS Code extension cleanup. | Keep these visible as completed setup work; do not confuse them with the clinical workflow nodes below. The VS Code crash investigation tied renderer termination to host OOM; it did not establish an extension as the cause. |

## Technology choices scrutinized

- **Redis handles the live session; PostgreSQL handles durable records.** The API reads and updates the live patient profile in Redis JSON. In the same Redis transaction, it appends the completed turn to a Redis Stream. A separate PostgreSQL worker copies stream entries into the clinical history and acknowledges each entry only after the database commit. Stable event IDs make retries safe. Redis saves and replicas provide recovery for live session data; PostgreSQL history is the independent rebuild source.
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

- [ ] `i01` Show the signed-in home page after authentication
- [ ] `i02` Link Instructions and History-Taking Overview
- [ ] `i03` Show Account Status: usage · metrics · downloads · payment gateway
- [ ] `i04` Provide Contact Us entry point
- [ ] `i05` Begin Visit opens the encounter screen with account context

#### Encounter preflight and browser capabilities

- [ ] `i06` Explain audio/text modes, microphone use, and local-data handling
- [ ] `i07` Request microphone access after explicit audio-mode action; preserve allowed text path if denied
- [ ] `i08` Keep private profile · diagnosis · transcript · provider IDs out of browser storage

#### Authentication and account resolution

- [ ] `a01` Learner / instructor / customer administrator
- [ ] `a02` Nuxt client requests OIDC sign-in
- [ ] `a03` OIDC provider authenticates user
- [ ] `a04` App auth adapter resolves local identity
- [ ] `a05` Load organization · customer · user · role
- [ ] `a06` After Begin Visit and preflight, create session · POST /api/sessions
- [ ] `a07` Check tenant ownership and role
- [ ] `a08` Deny cross-tenant request without state disclosure
- [ ] `a09` Load model · audio · exam · order entitlements
- [ ] `a10` Check per-user and per-session quota
- [ ] `a11` Return bounded quota response
- [ ] `a12` Create one opaque app sessionId
- [ ] `a13` Bind session to customer · tenant · user
- [ ] `a14` Rotate HTTP-only · Secure · SameSite cookie
- [ ] `a15` On each request authenticate cookie or authorized socket ticket
- [ ] `a16` Recheck session owner · tenant · role · entitlement
- [ ] `a17` Browser never sends API key · model ID · provider context ID

#### Idempotent setup lane and immutable synthetic-patient seed creation

- [ ] `s01` POST /api/sessions/:sessionId/setup
- [ ] `s02` Authenticate · authorize owner · check setup entitlement
- [ ] `s03` Check setup idempotency key
- [ ] `s04` Return previously committed seed and setup result
- [ ] `s05` Enqueue within bounded setup capacity
- [ ] `s06` Enforce setup concurrency · queue · timeout · retry budget
- [ ] `s07` Return pending / overload response without partial activation
- [ ] `s08` Load versioned prompt · schema · rubric · model config
- [ ] `s09` Create random scenario seed once; reuse it on retry
- [ ] `s10` Build strict PatientScenarioSeed structured-output request
- [ ] `s11` Generate identity · symptoms · onset · relevant negatives
- [ ] `s12` Generate history cues · medications · allergies · patient concerns
- [ ] `s13` Generate clinician-hidden diagnosis or explicitly unknown status
- [ ] `s14` Generate fixed exam findings · supported test/result catalog
- [ ] `s15` Generate fixed bounded personality traits and persona seed
- [ ] `s16` Attach educator-reviewed rubric and version references
- [ ] `s17` Call Responses API for structured setup output inside the session Conversation
- [ ] `s18` Validate strict versioned JSON Schema
- [ ] `s19` Validate field and cross-field constraints in application code
- [ ] `s20` Discard rejected Conversation; retry same setup identity in fresh context
- [ ] `s21` Mark setup failed; keep session inactive
- [ ] `s23` Create one OpenAI Conversation before full-profile generation
- [ ] `s24` Return validated profile and Conversation ID together to setup coordinator after prompt
- [ ] `s22` Save profile · internal five-value projection · Conversation binding to Redis JSON; enqueue PostgreSQL persistence
- [ ] `s26` Derive the five setup variables from the validated full profile in application code
- [ ] `s25` Mark server setup ready; pin model · mode · policy versions

#### Patient identity reservation, client readiness, and turn continuity

- [ ] `i09` Allocate opaque per-visit ppid; bind it to authenticated sid
- [ ] `i10` Create Redis JSON session mapping and initializing patient-profile receptacle
- [ ] `i11` Confirm client preflight and Redis reservation before setup-generation command
- [ ] `i12` Resolve the same server-held Conversation ID from sid + ppid for every later turn
- [ ] `i13` Return client-safe four-value profile sans diagnosis, if any, after Redis commit
- [ ] `i14` Select portrait folder from derived age band/body type and preload selected assets
- [ ] `i15` Show amber while required work is pending; show green and enable Enter Room only when ready

### 2. Scenario data and serialized turns

**Subroutines:** Redis stores live session state, the accepted reply, its retry key, and the recovery event in one payload-critical turn transaction; `TurnOrchestrator` serializes each session, enforces idempotency, builds authorized model input, and validates output. Dedicated consumers persist those events in order to PostgreSQL without delaying the response; event IDs make retries safe.

**Boundary:** `services/api/src/modules/scenarios/`, `active-scenarios/`, and `turns/`.

#### Data records, authority boundaries and retention

- [ ] `d01` PostgreSQL is the application system of record
- [ ] `d02` Tenant · user · role · entitlement · quota records
- [ ] `d03` Immutable versioned PatientScenarioSeed and hidden answer key
- [ ] `d04` Append-only PatientFactExpansion ledger with source and turn ID
- [ ] `d05` Append-only disclosure ledger with disclosed fact IDs
- [ ] `d06` Encounter snapshot: phase · mode · status · current turn
- [ ] `d07` Coverage: pertinent topics asked · relevant · missing
- [ ] `d08` Orders: order time · status · fixed result reference
- [ ] `d09` Exams: consent · decline · chaperone · mode · completion
- [ ] `d10` Assessment: learner summary · differential · rationale · plan
- [ ] `d11` Event ledger: ordered append-only turns · actions · phase changes
- [ ] `d12` Transcript: speaker · timestamp · phase · modality · turnId
- [ ] `d13` Mark expansion epistemic source as patient-reported or seeded / verified
- [ ] `d14` Patient-reported statement cannot become a lab or exam result
- [ ] `d15` Results and findings resolve only from fixed scenario catalog
- [ ] `d16` Record schema · prompt · model · rubric versions for replay
- [ ] `d17` Keep answer key hidden until authorized instructor or debrief

#### One serialized text turn: authorize, validate, commit, then deliver

- [ ] `t01` Learner types text or uses browser speech recognition
- [ ] `t02` Generate client turnId / idempotency key
- [ ] `t03` POST /api/sessions/:sessionId/turns { turnId, text }
- [ ] `t04` Authenticate cookie · tenant · session owner · turn entitlement
- [ ] `t05` Runtime-validate request body and text limits
- [ ] `t06` Acquire per-session turn lock
- [ ] `t07` Check committed turnId in idempotency ledger
- [ ] `t08` Return same committed patient reply for duplicate turn
- [ ] `t09` Validate current phase and selected interaction mode
- [ ] `t10` Reject invalid phase or concurrent active turn
- [ ] `t11` Keep clinician input in turn context until atomic commit
- [ ] `t12` Load only this session's authorized model projection
- [ ] `t13` Add phase · relevant seed facts · accepted expansions
- [ ] `t14` Add disclosure boundaries · fixed personality · coverage state
- [ ] `t15` Add pinned prompt · schema · model · policy versions
- [ ] `t16` Call Responses with stored conversationId and current input
- [ ] `t17` Do not also send previous_response_id
- [ ] `t18` Inspect refusal · incomplete · timeout · provider error
- [ ] `t19` Queue safe provider-failure audit asynchronously; do not invent reply
- [ ] `t20` Validate structured patient utterance and proposed expansions
- [ ] `t21` Check seed · prior facts · chronology · age plausibility
- [ ] `t22` Check obstetric outcomes · parity · child count · complications
- [ ] `t23` Protect diagnosis · deterministic results · rubric · disclosure rules
- [ ] `t24` Retry against same saved patient profile
- [ ] `t25` Queue validation-failure audit asynchronously after bounded retries
- [ ] `t26` Prepare safe clarification when output remains invalid
- [ ] `t27` Begin Redis live-state and event-stream transaction
- [ ] `t28` Update accepted patient-reported facts in RedisJSON
- [ ] `t29` Append disclosure events to Redis Stream
- [ ] `t30` Append patient reply · input · turn-complete event
- [ ] `t31` Append phase and audit events for background workers
- [ ] `t32` Commit live state · reply · retry key · recovery event together
- [ ] `t33` On Redis commit failure, return no unjournaled reply
- [ ] `t34` Return reply without waiting for PostgreSQL
- [ ] `t35` Is optional TTS enabled?
- [ ] `t36` Stream speech synthesis separately
- [ ] `t37` Wait until reply and enabled playback complete
- [ ] `t38` Release lock and allow next learner turn

### 3. History, coverage, assessment, and debrief

**Subroutines:** History expansion matches a learner question to bounded seed cues and persists only validated patient-reported facts; coverage tracks asked, missing, sensitive, and irrelevant topics; assessment validates and stores the learner submission; scoring uses a versioned educator-reviewed rubric; debrief produces actionable feedback from the durable case and accepted facts.

**Boundary:** `services/api/src/modules/history/`, `coverage/`, `assessment/`, and `debrief/`.

#### Natural, bounded expansion of history only when the learner asks a relevant question

- [ ] `h01` Learner asks symptom or history question
- [ ] `h02` Find matching seed cue and existing fact expansions
- [ ] `h03` Is a bounded history cue relevant to this question?
- [ ] `h04` Answer naturally in the fixed patient personality
- [ ] `h05` Propose only details compatible with the seed and question
- [ ] `h06` Send utterance and proposal through turn validation
- [ ] `h07` Append accepted fact to the correct history section
- [ ] `h08` Reuse accepted detail on later turns; never rewrite seed
- [ ] `h09` No cue: answer from known facts without a profile dump
- [ ] `h10` Record each detail as fictional patient-reported history
- [ ] `h11` Keep sensitive questions patient-centered and case-relevant

#### Coverage, assessment phase, post-session scoring, and debrief

- [ ] `c01` Track pertinent symptoms · reproductive context · relevant history
- [ ] `c02` Track exam / test findings · synthesis · differential · plan
- [ ] `c03` Mark each topic asked · missing · sensitive · not relevant
- [ ] `c04` Update encounter coverage state
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
- [ ] `r09` Stream audio; support turn-taking and barge-in
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

#### Transcript mode: auditable typed / transcribed turns and optional TTS

- [ ] `v01` Fix Transcript mode at session start
- [ ] `v02` User gesture requests browser microphone permission
- [ ] `v03` Browser speech recognition produces text
- [ ] `v04` Typed text remains an alternate input
- [ ] `v05` Display recognized or typed transcript
- [ ] `v06` Send text over authenticated HTTPS
- [ ] `v07` Process via serialized Responses turn lane
- [ ] `v08` Return text; optionally stream TTS separately
- [ ] `v09` Do not retain raw microphone audio by default

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
- [ ] `g12` Verify reconnect · barge-in · transcript reconciliation · privacy
- [ ] `g13` 7 · Ship Nuxt / API with PostgreSQL · Redis JSON · archive lifecycle
- [ ] `g14` 8 · Educator evaluation · load tests · latency and cost budgets
- [ ] `g15` Do quality and performance evidence meet release criteria?
- [ ] `g16` Release after clinical · security · reliability gates pass


**Checklist inventory:** 286 of 286 detailed nodes represented; IDs and wording match the seven source maps.
