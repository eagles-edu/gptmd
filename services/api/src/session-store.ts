import { createHash, randomBytes, randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { AuthenticatedPrincipal, TenantMembership, TenantRole } from './auth.ts'
import {
  ImmutablePatientScenarioSchema,
  SessionStateSchema,
  SessionVersionPinsSchema,
  SessionTurnSchema,
  SessionAuditEventSchema,
  AssessmentSubmissionSchema,
  AssessmentDraftFieldsSchema,
  AssessmentFieldsSchema,
  LocalTranscriptUtteranceSchema,
  TerminalEventSchema,
  type AssessmentFields,
  type AssessmentDraftFields,
  type AssessmentSubmission,
  type ProviderUsageSample,
  type SessionTurn,
  type TerminalEvent,
  type LearnerInputModality,
  type LocalTranscriptUtterance,
  type LocalUtteranceRequest
} from './session-contracts.ts'
import {
  PATIENT_SCENARIO_POLICY_VERSION,
  PATIENT_SCENARIO_PROMPT_VERSION,
  PATIENT_SCENARIO_SCHEMA_VERSION,
  PatientScenarioProfileSchema,
  isPatientScenarioConsistent,
  type GeneratedPatientScenario,
  type PatientScenarioVersionPins
} from './patient-profile.ts'
import {
  derivePatientSetup,
  toLearnerPatientProfile,
  type LearnerPatientProfile
} from './patient-setup.ts'
import { canonicalJsonStringify } from './canonical-json.ts'
import type { LivePatientState, PatientStateStore, SessionCommitTimingRecorder } from './patient-state-store.ts'
import {
  createSessionIdentityBinding,
  fingerprintScenario,
  SessionIdentityBindingSchema,
  verifySessionIdentityBinding,
  type SessionIdentityBinding
} from './session-identity.ts'
import { PATIENT_TURN_SCHEMA_VERSION } from './session-contracts.ts'
import {
  validatePatientTurnOutput,
  PATIENT_TURN_POLICY_VERSION,
  PATIENT_TURN_PROMPT_VERSION,
  type AcceptedPatientTurnContent,
  type PatientTurnGenerationContext
} from './patient-turn.ts'

export type QuotaFeature = 'sessions' | 'responses'
export type SessionStatus = 'initializing' | 'failed' | 'ready' | 'active' | 'completed' | 'cancelled'
export type SessionRecord = {
  sessionId: string
  status: SessionStatus
  createdAt: string
  updatedAt: string
  versions: PatientScenarioVersionPins
}
export type CurrentEncounterRecord = {
  sessionId: string
  status: 'initializing' | 'ready' | 'active'
  createdAt: string
  updatedAt: string
  versions: PatientScenarioVersionPins
  patient: LearnerPatientProfile | null
  phase: 'history' | 'assessment' | 'debrief' | null
  currentTurnSequence: number
  transcript: Array<Pick<SessionTurn,
    'turnId' | 'sequence' | 'acceptedAt' | 'phase' | 'learnerModality' | 'learnerMessage' | 'patientResponse'
  >>
  localUtterances: LocalTranscriptUtterance[]
  assessmentDraft: {
    revision: number
    fields: AssessmentDraftFields
    updatedAt: string
  } | null
  assessment: {
    assessmentId: string
    fields: AssessmentFields
    submittedAt: string
  } | null
}

export type PatientScenarioSetupResult = {
  sessionId: string
  status: 'ready'
  createdAt: string
  patient: ReturnType<typeof toLearnerPatientProfile>
  versions: PatientScenarioVersionPins
  readiness: { profile: true; redis: true; conversation: true }
}

export type ScenarioSetupResult =
  | PatientScenarioSetupResult
  | 'not_found'
  | 'idempotency_conflict'
  | 'invalid_state'
  | 'version_unavailable'
  | 'state_unavailable'
  | 'entitlement_denied'

export type StoreResult = 'allowed' | 'membership_missing' | 'entitlement_denied' | 'quota_exceeded'
export type PatientTurnResult =
  | { status: 'accepted' | 'duplicate'; turnId: string; sequence: number; patientResponse: string }
  | 'not_found'
  | 'not_ready'
  | 'turn_in_progress'
  | 'conflict'
  | 'missing_state'
  | 'provider_error'
  | 'validation_error'
  | 'membership_missing'
  | 'entitlement_denied'
  | 'quota_exceeded'
export type AssessmentResult =
  | { assessmentId: string; status: 'unscored'; submittedAt: string }
  | 'not_found'
  | 'not_ready'
  | 'turn_in_progress'
  | 'state_unavailable'
  | 'phase_conflict'
export type AssessmentDraftRecord = {
  revision: number
  fields: AssessmentDraftFields
  updatedAt: string
}
export type AssessmentDraftSaveResult = AssessmentDraftRecord
  | 'not_found'
  | 'not_ready'
  | 'turn_in_progress'
  | 'state_unavailable'
  | 'phase_conflict'
export type LocalUtteranceResult = LocalTranscriptUtterance
  | 'not_found'
  | 'not_ready'
  | 'turn_in_progress'
  | 'state_unavailable'
  | 'phase_conflict'

export interface SessionStore {
  getActiveMemberships(subjectId: string): Promise<TenantMembership[]>
  consumeQuota(principal: AuthenticatedPrincipal, feature: QuotaFeature, sessionId?: string): Promise<StoreResult>
  createAudioTranscriptionGrant(
    principal: AuthenticatedPrincipal,
    sessionId: string,
    consentVersion: string
  ): Promise<StoreResult | { grantId: string }>
  recordAudioProviderSession(grantId: string, providerSessionId: string, providerCallId: string): Promise<void>
  createSession(
    principal: AuthenticatedPrincipal,
    versions: PatientScenarioVersionPins
  ): Promise<SessionRecord | StoreResult>
  setupScenario(
    principal: AuthenticatedPrincipal,
    sessionId: string,
    idempotencyKey: string,
    generateScenario: (
      versions: PatientScenarioVersionPins,
      asOf: Date,
      scenarioSeed: string,
      recordProviderUsage: (usage: ProviderUsageSample) => Promise<void>
    ) => Promise<GeneratedPatientScenario>
  ): Promise<ScenarioSetupResult>
  submitPatientTurn(
    principal: AuthenticatedPrincipal,
    sessionId: string,
    turnId: string,
    learnerMessage: string,
    generateTurn: (context: PatientTurnGenerationContext) => Promise<{
      responseId: string
      output: unknown
      providerUsage: ProviderUsageSample | null
    }>,
    learnerModality?: LearnerInputModality,
    onLockAttemptMeasured?: (waitMs: number) => void,
    recordCommitTiming?: SessionCommitTimingRecorder
  ): Promise<PatientTurnResult>
  beginAssessment(principal: AuthenticatedPrincipal, sessionId: string, recordCommitTiming?: SessionCommitTimingRecorder): Promise<'not_found' | 'not_ready' | 'turn_in_progress' | 'state_unavailable' | 'phase_conflict' | 'assessment'>
  saveAssessmentDraft(
    principal: AuthenticatedPrincipal,
    sessionId: string,
    revision: number,
    fields: AssessmentDraftFields
  ): Promise<AssessmentDraftSaveResult>
  recordLocalUtterance(
    principal: AuthenticatedPrincipal,
    sessionId: string,
    input: LocalUtteranceRequest
  ): Promise<LocalUtteranceResult>
  submitAssessment(
    principal: AuthenticatedPrincipal,
    sessionId: string,
    assessmentId: string,
    fields: AssessmentFields,
    recordCommitTiming?: SessionCommitTimingRecorder
  ): Promise<AssessmentResult>
  getOwnedSession(
    principal: AuthenticatedPrincipal,
    sessionId: string
  ): Promise<SessionRecord | null>
  getCurrentOwnedEncounter(principal: AuthenticatedPrincipal): Promise<CurrentEncounterRecord | null>
  ensureLiveState?(principal: AuthenticatedPrincipal, sessionId: string): Promise<void>
}

type EntitlementRow = {
  enabled: boolean
  monthly_quota: number | null
  monthly_user_quota?: number | null
  session_quota?: number | null
  max_active_sessions?: number | null
}

type SetupSessionRow = {
  session_id: string
  patient_profile_id: string | null
  scenario_seed: string | null
  status: SessionStatus
  created_at: Date
  setup_idempotency_key_hash: string | null
  prompt_version: string
  model_version: string
  schema_version: number
  policy_version: string
  sessions_enabled?: boolean | null
}

type ScenarioRow = {
  scenario_id: string
  created_at: Date
  profile_digest: string
  profile_json: unknown
  provider_conversation_id: string
}

const toVersionPins = (row: Pick<SetupSessionRow,
  'prompt_version' | 'model_version' | 'schema_version' | 'policy_version'
>): PatientScenarioVersionPins => SessionVersionPinsSchema.parse({
  promptVersion: row.prompt_version,
  modelVersion: row.model_version,
  schemaVersion: row.schema_version,
  policyVersion: row.policy_version
})

function toSetupResponse(
  sessionId: string,
  scenario: ReturnType<typeof ImmutablePatientScenarioSchema.parse>,
  versions: PatientScenarioVersionPins
): PatientScenarioSetupResult {
  return {
    sessionId,
    status: 'ready',
    createdAt: scenario.createdAt,
    patient: toLearnerPatientProfile(derivePatientSetup(scenario.profile)),
    versions,
    readiness: { profile: true, redis: true, conversation: true }
  }
}

async function persistSessionIdentityBinding(
  client: PoolClient,
  binding: SessionIdentityBinding
): Promise<void> {
  const saved = await client.query(
    `INSERT INTO session_identity_binding (
       session_id, tenant_id, subject_id, patient_profile_id, provider_conversation_id,
       scenario_fingerprint, schema_version
     ) VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (session_id) DO UPDATE
       SET last_verification_status = session_identity_binding.last_verification_status
       WHERE session_identity_binding.tenant_id = EXCLUDED.tenant_id
         AND session_identity_binding.subject_id = EXCLUDED.subject_id
         AND session_identity_binding.patient_profile_id = EXCLUDED.patient_profile_id
         AND session_identity_binding.provider_conversation_id = EXCLUDED.provider_conversation_id
         AND session_identity_binding.scenario_fingerprint = EXCLUDED.scenario_fingerprint
         AND session_identity_binding.schema_version = EXCLUDED.schema_version
     RETURNING session_id`,
    [
      binding.sessionId, binding.tenantId, binding.subjectId, binding.patientProfileId,
      binding.providerConversationId, binding.scenarioFingerprint, binding.schemaVersion
    ]
  )
  if (saved.rowCount !== 1) {
    throw new Error('Session identity binding does not match the immutable patient scenario')
  }
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK')
  } catch {
    // Preserve the original transaction error.
  }
}

function hashSessionIdForLog(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 16)
}

function queueTurnAudit(
  stateStore: PatientStateStore | null,
  eventType: 'patient_turn_model_failure' | 'patient_turn_validation_failure' |
    'patient_turn_recovered_after_validation_retry' | 'patient_turn_lock_release_failure',
  sessionId: string,
  turnId: string,
  attemptCount = 1,
  recordHandoffTiming?: SessionCommitTimingRecorder
): void {
  const event = SessionAuditEventSchema.parse({
    eventId: randomUUID(), sessionId, eventType, occurredAt: new Date().toISOString(),
    payload: { turnIdHash: createHash('sha256').update(turnId).digest('hex'), attemptCount }
  })
  const turnIdHash = event.payload.turnIdHash
  const enqueueStartedAt = performance.now()
  const reportHandoffTiming = () => {
    try {
      recordHandoffTiming?.('audit_event_enqueue', Math.max(0, performance.now() - enqueueStartedAt))
    } catch {
      // Observability must not affect the learner-facing response or audit enqueue.
    }
  }
  setImmediate(() => {
    if (!stateStore?.appendAuditEvent) {
      reportHandoffTiming()
      console.warn(JSON.stringify({ event: 'session_turn_audit_enqueue_unavailable', sessionIdHash: hashSessionIdForLog(sessionId), turnIdHash, eventType }))
      return
    }
    try {
      void stateStore.appendAuditEvent(event).then(
        () => reportHandoffTiming(),
        () => {
          reportHandoffTiming()
          console.warn(JSON.stringify({ event: 'session_turn_audit_enqueue_failed', sessionIdHash: hashSessionIdForLog(sessionId), turnIdHash, eventType }))
        }
      )
    } catch {
      reportHandoffTiming()
      console.warn(JSON.stringify({ event: 'session_turn_audit_enqueue_failed', sessionIdHash: hashSessionIdForLog(sessionId), turnIdHash, eventType }))
    }
  })
}

async function releaseSessionMutationLock(
  stateStore: PatientStateStore,
  sessionId: string,
  lockToken: string,
  operation: 'assessment_phase' | 'assessment_submission' | 'local_utterance'
): Promise<void> {
  try {
    await stateStore.releaseTurnLock(sessionId, lockToken)
  } catch {
    console.warn(JSON.stringify({ event: 'session_mutation_lock_release_failed', sessionIdHash: hashSessionIdForLog(sessionId), operation }))
  }
}

export function createPostgresSessionStore(
  pool: Pool,
  patientStateStore: PatientStateStore | null = null,
  options: { recordHandoffTiming?: SessionCommitTimingRecorder } = {}
): SessionStore {
  return {
    async getActiveMemberships(subjectId) {
      const result = await pool.query<{ tenant_id: string; role: TenantRole }>(
        `SELECT tenant_id, role FROM tenant_memberships
         WHERE subject_id = $1 AND status = 'active'
         ORDER BY tenant_id`,
        [subjectId]
      )
      return result.rows.map((row) => ({ tenantId: row.tenant_id, role: row.role }))
    },

    async consumeQuota(principal, feature, sessionId) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const entitlement = await client.query<EntitlementRow>(
          `SELECT ${feature === 'sessions'
            ? 'sessions_enabled AS enabled, monthly_session_quota AS monthly_quota, monthly_session_quota_per_user AS monthly_user_quota, NULL::integer AS session_quota'
            : 'responses_enabled AS enabled, monthly_response_quota AS monthly_quota, monthly_response_quota_per_user AS monthly_user_quota, response_quota_per_session AS session_quota'}
           FROM tenant_entitlements e
           JOIN tenant_memberships m USING (tenant_id)
           WHERE e.tenant_id = $1 AND m.subject_id = $2
             AND m.status = 'active'
           FOR UPDATE OF e`,
          [principal.tenantId, principal.subjectId]
        )
        const row = entitlement.rows[0]
        if (!row) {
          await client.query('ROLLBACK')
          return 'membership_missing'
        }
        if (!row.enabled) {
          await client.query('ROLLBACK')
          return 'entitlement_denied'
        }
        const reserved = await reserveMonthlyQuota(client, principal.tenantId, feature, row.monthly_quota)
        if (!reserved) {
          await client.query('ROLLBACK')
          return 'quota_exceeded'
        }
        const userReserved = await reserveUserMonthlyQuota(
          client, principal.tenantId, principal.subjectId, feature, row.monthly_user_quota ?? null
        )
        if (!userReserved) {
          await client.query('ROLLBACK')
          return 'quota_exceeded'
        }
        if (sessionId && feature === 'responses') {
          const sessionReserved = await reserveSessionQuota(
            client, principal.tenantId, principal.subjectId, sessionId, row.session_quota ?? null
          )
          if (!sessionReserved) {
            await client.query('ROLLBACK')
            return 'quota_exceeded'
          }
        }
        await client.query('COMMIT')
        return 'allowed'
      } catch (error) {
        await rollback(client)
        throw error
      } finally {
        client.release()
      }
    },

    async createAudioTranscriptionGrant(principal, sessionId, consentVersion) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const entitlement = await client.query<{
          sessions_enabled: boolean
          audio_transcription_enabled: boolean
          audio_transcription_privacy_approved: boolean
          monthly_quota: number | null
          session_status: SessionStatus
        }>(
          `SELECT e.sessions_enabled, e.audio_transcription_enabled,
                  e.audio_transcription_privacy_approved,
                  e.monthly_audio_transcription_session_quota AS monthly_quota,
                  s.status AS session_status
           FROM tenant_entitlements e
           JOIN tenant_memberships m ON m.tenant_id = e.tenant_id
             AND m.subject_id = $2 AND m.status = 'active'
           JOIN app_sessions s ON s.tenant_id = e.tenant_id
             AND s.subject_id = m.subject_id AND s.session_id = $3
           WHERE e.tenant_id = $1
           FOR UPDATE OF e, s`,
          [principal.tenantId, principal.subjectId, sessionId]
        )
        const row = entitlement.rows[0]
        if (!row) {
          await client.query('ROLLBACK')
          return 'membership_missing'
        }
        if (!row.sessions_enabled || !row.audio_transcription_enabled ||
            !row.audio_transcription_privacy_approved || row.monthly_quota === null ||
            !['ready', 'active'].includes(row.session_status)) {
          await client.query('ROLLBACK')
          return 'entitlement_denied'
        }
        const usage = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM app_audio_transcription_sessions
           WHERE tenant_id = $1 AND subject_id = $2
             AND created_at >= date_trunc('month', now())`,
          [principal.tenantId, principal.subjectId]
        )
        if (Number(usage.rows[0]?.count ?? 0) >= row.monthly_quota) {
          await client.query('ROLLBACK')
          return 'quota_exceeded'
        }
        const grantId = randomUUID()
        await client.query(
          `INSERT INTO app_audio_transcription_sessions
             (grant_id, session_id, tenant_id, subject_id, consent_version)
           VALUES ($1, $2, $3, $4, $5)`,
          [grantId, sessionId, principal.tenantId, principal.subjectId, consentVersion]
        )
        await client.query('COMMIT')
        return { grantId }
      } catch (error) {
        await rollback(client)
        throw error
      } finally {
        client.release()
      }
    },

    async recordAudioProviderSession(grantId, providerSessionId, providerCallId) {
      const result = await pool.query(
        `UPDATE app_audio_transcription_sessions
         SET provider_session_id = $2, provider_call_id = $3,
             disconnect_after = now() + interval '15 minutes'
         WHERE grant_id = $1 AND provider_call_id IS NULL`,
        [grantId, providerSessionId, providerCallId]
      )
      if (result.rowCount !== 1) throw new Error('Audio transcription grant could not be bound to its provider call')
    },

    async createSession(principal, versions) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const entitlement = await client.query<EntitlementRow>(
          `SELECT sessions_enabled AS enabled, monthly_session_quota AS monthly_quota,
                  monthly_session_quota_per_user AS monthly_user_quota,
                  max_active_sessions
           FROM tenant_entitlements e
           JOIN tenant_memberships m USING (tenant_id)
           WHERE e.tenant_id = $1 AND m.subject_id = $2 AND m.status = 'active'
           FOR UPDATE OF e`,
          [principal.tenantId, principal.subjectId]
        )
        const row = entitlement.rows[0]
        if (!row) {
          await client.query('ROLLBACK')
          return 'membership_missing'
        }
        if (!row.enabled) {
          await client.query('ROLLBACK')
          return 'entitlement_denied'
        }
        if (row.max_active_sessions !== null && row.max_active_sessions !== undefined) {
          const active = await client.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM app_sessions
             WHERE tenant_id = $1 AND status IN ('initializing', 'ready', 'active')`,
            [principal.tenantId]
          )
          if (Number(active.rows[0]?.count ?? 0) >= row.max_active_sessions) {
            await client.query('ROLLBACK')
            return 'quota_exceeded'
          }
        }
        const reserved = await reserveMonthlyQuota(client, principal.tenantId, 'sessions', row.monthly_quota)
        if (!reserved) {
          await client.query('ROLLBACK')
          return 'quota_exceeded'
        }
        const userReserved = await reserveUserMonthlyQuota(
          client, principal.tenantId, principal.subjectId, 'sessions', row.monthly_user_quota ?? null
        )
        if (!userReserved) {
          await client.query('ROLLBACK')
          return 'quota_exceeded'
        }
        const sessionId = randomBytes(32).toString('base64url')
        const patientProfileId = randomBytes(32).toString('base64url')
        const scenarioSeed = randomBytes(32).toString('base64url')
        const inserted = await client.query<{ created_at: Date; updated_at: Date }>(
          `INSERT INTO app_sessions (
             session_id, patient_profile_id, scenario_seed, tenant_id, subject_id, status,
             prompt_version, model_version, schema_version, policy_version
           )
           VALUES ($1, $2, $3, $4, $5, 'initializing', $6, $7, $8, $9)
           RETURNING created_at, updated_at`,
          [
            sessionId,
            patientProfileId,
            scenarioSeed,
            principal.tenantId,
            principal.subjectId,
            versions.promptVersion,
            versions.modelVersion,
            versions.schemaVersion,
            versions.policyVersion
          ]
        )
        await client.query('COMMIT')
        const created = inserted.rows[0]
        if (!created) throw new Error('Session insert did not return timestamps')
        return {
          sessionId,
          status: 'initializing',
          createdAt: created.created_at.toISOString(),
          updatedAt: created.updated_at.toISOString(),
          versions
        }
      } catch (error) {
        await rollback(client)
        throw error
      } finally {
        client.release()
      }
    },

    async setupScenario(principal, sessionId, idempotencyKey, generateScenario) {
      const client = await pool.connect()
      const idempotencyHash = createHash('sha256').update(idempotencyKey).digest('hex')
      try {
        await client.query('BEGIN')
        const selected = await client.query<SetupSessionRow>(
          `SELECT s.session_id, s.patient_profile_id, s.scenario_seed, s.status, s.created_at, s.setup_idempotency_key_hash,
                  s.prompt_version, s.model_version, s.schema_version, s.policy_version,
                  e.sessions_enabled
           FROM app_sessions s
           LEFT JOIN tenant_entitlements e ON e.tenant_id = s.tenant_id
           WHERE s.session_id = $1 AND s.tenant_id = $2 AND s.subject_id = $3
           FOR UPDATE OF s`,
          [sessionId, principal.tenantId, principal.subjectId]
        )
        const session = selected.rows[0]
        if (!session) {
          await client.query('ROLLBACK')
          return 'not_found'
        }
        if (session.sessions_enabled !== true) {
          await client.query('ROLLBACK')
          return 'entitlement_denied'
        }

        if (session.schema_version !== PATIENT_SCENARIO_SCHEMA_VERSION) {
          await client.query('ROLLBACK')
          return 'version_unavailable'
        }

        const patientProfileId = session.patient_profile_id ?? randomBytes(32).toString('base64url')
        const scenarioSeed = session.scenario_seed ?? randomBytes(32).toString('base64url')
        if (!session.scenario_seed) {
          await client.query(
            `UPDATE app_sessions SET scenario_seed = $2 WHERE session_id = $1`,
            [sessionId, scenarioSeed]
          )
        }
        if (!session.patient_profile_id) {
          await client.query(
            `UPDATE app_sessions SET patient_profile_id = $2 WHERE session_id = $1`,
            [sessionId, patientProfileId]
          )
        }

        const versions = toVersionPins(session)
        if (
          versions.promptVersion !== PATIENT_SCENARIO_PROMPT_VERSION ||
          versions.policyVersion !== PATIENT_SCENARIO_POLICY_VERSION
        ) {
          await client.query('ROLLBACK')
          return 'version_unavailable'
        }
        if (session.setup_idempotency_key_hash && session.setup_idempotency_key_hash !== idempotencyHash) {
          await client.query('ROLLBACK')
          return 'idempotency_conflict'
        }

        const saved = await client.query<ScenarioRow>(
          `SELECT scenario_id, created_at, profile_digest, profile_json, provider_conversation_id
           FROM patient_scenarios WHERE session_id = $1`,
          [sessionId]
        )
        const savedRow = saved.rows[0]
        if (savedRow) {
          if (session.status !== 'ready' || session.setup_idempotency_key_hash !== idempotencyHash) {
            await client.query('ROLLBACK')
            return 'invalid_state'
          }
          const profile = PatientScenarioProfileSchema.parse(savedRow.profile_json)
          const scenario = ImmutablePatientScenarioSchema.parse({
            scenarioId: savedRow.scenario_id,
            schemaVersion: versions.schemaVersion,
            createdAt: savedRow.created_at.toISOString(),
            profileDigest: savedRow.profile_digest,
            profile
          })
          const digest = createHash('sha256').update(canonicalJsonStringify(scenario.profile)).digest('hex')
          if (digest !== scenario.profileDigest) {
            await client.query('ROLLBACK')
            throw new Error('Stored patient scenario digest does not match its profile')
          }
          await persistSessionIdentityBinding(client, createSessionIdentityBinding({
            sessionId,
            tenantId: principal.tenantId,
            subjectId: principal.subjectId,
            patientProfileId: scenario.scenarioId,
            providerConversationId: savedRow.provider_conversation_id,
            scenarioFingerprint: fingerprintScenario(scenario.profile),
            schemaVersion: scenario.schemaVersion
          }))
          if (!patientStateStore) {
            await client.query('ROLLBACK')
            return 'state_unavailable'
          }
          await patientStateStore.initialize(sessionId, scenario.scenarioId)
          await patientStateStore.rememberOwnedSession(principal.tenantId, principal.subjectId, sessionId)
          await client.query('COMMIT')
          await patientStateStore.saveReady({
            sessionId,
            patientProfileId: scenario.scenarioId,
            openedAt: session.created_at.toISOString(),
            profile: scenario.profile,
            setupProjection: derivePatientSetup(scenario.profile),
            conversationId: savedRow.provider_conversation_id,
            profileDigest: scenario.profileDigest,
            schemaVersion: scenario.schemaVersion
          })
          return toSetupResponse(sessionId, scenario, versions)
        }

        if (session.status !== 'initializing') {
          await client.query('ROLLBACK')
          return 'invalid_state'
        }
        if (!patientStateStore) {
          await client.query('ROLLBACK')
          return 'state_unavailable'
        }
        await patientStateStore.initialize(sessionId, patientProfileId)
        await patientStateStore.rememberOwnedSession(principal.tenantId, principal.subjectId, sessionId)

        const queuedProviderResponseIds = new Set<string>()
        const recordProviderUsage = async (usage: ProviderUsageSample): Promise<void> => {
          if (queuedProviderResponseIds.has(usage.responseId)) return
          const usageEventId = `usage_${createHash('sha256').update(`openai\0${usage.responseId}`).digest('hex')}`
          await patientStateStore.appendProviderUsage({
            eventId: usageEventId,
            sessionId,
            eventType: 'provider_usage',
            operation: 'scenario_generation',
            occurredAt: new Date().toISOString(),
            usage
          })
          queuedProviderResponseIds.add(usage.responseId)
        }
        const generated = await generateScenario(versions, session.created_at, scenarioSeed, recordProviderUsage)
        if (generated.usage && !queuedProviderResponseIds.has(generated.usage.responseId)) {
          await recordProviderUsage(generated.usage)
        }
        const profile = PatientScenarioProfileSchema.parse(generated.profile)
        if (!isPatientScenarioConsistent(profile, session.created_at)) {
          throw new Error('Generated patient profile failed session-time consistency validation')
        }
        if (typeof generated.conversationId !== 'string' || !generated.conversationId.trim()) {
          throw new Error('Generated patient scenario has no provider Conversation ID')
        }
        const scenario = ImmutablePatientScenarioSchema.parse({
          scenarioId: patientProfileId,
          schemaVersion: versions.schemaVersion,
          createdAt: new Date().toISOString(),
          profileDigest: createHash('sha256').update(canonicalJsonStringify(profile)).digest('hex'),
          profile
        })
        derivePatientSetup(scenario.profile)
        await client.query(
          `INSERT INTO patient_scenarios (
             scenario_id, session_id, schema_version, created_at, profile_digest,
             profile_json, provider_conversation_id, prompt_version, model_version, policy_version
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            scenario.scenarioId,
            sessionId,
            versions.schemaVersion,
            scenario.createdAt,
            scenario.profileDigest,
            scenario.profile,
            generated.conversationId,
            versions.promptVersion,
            versions.modelVersion,
            versions.policyVersion
          ]
        )
        await persistSessionIdentityBinding(client, createSessionIdentityBinding({
          sessionId,
          tenantId: principal.tenantId,
          subjectId: principal.subjectId,
          patientProfileId: scenario.scenarioId,
          providerConversationId: generated.conversationId,
          scenarioFingerprint: fingerprintScenario(scenario.profile),
          schemaVersion: scenario.schemaVersion
        }))
        await client.query(
          `UPDATE app_sessions
           SET status = 'ready', setup_idempotency_key_hash = $2, updated_at = now()
           WHERE session_id = $1`,
          [sessionId, idempotencyHash]
        )
        await client.query('COMMIT')
        await patientStateStore.saveReady({
          sessionId,
          patientProfileId,
          openedAt: session.created_at.toISOString(),
          profile: scenario.profile,
          setupProjection: derivePatientSetup(scenario.profile),
          conversationId: generated.conversationId,
          profileDigest: scenario.profileDigest,
          schemaVersion: scenario.schemaVersion
        })
        return toSetupResponse(sessionId, scenario, versions)
      } catch (error) {
        await rollback(client)
        try {
          await client.query(
            `UPDATE app_sessions
             SET status = 'failed', updated_at = now()
             WHERE session_id = $1 AND tenant_id = $2 AND subject_id = $3 AND status = 'initializing'`,
            [sessionId, principal.tenantId, principal.subjectId]
          )
        } catch {
          // Keep the setup error as the primary failure if the failure status cannot be recorded.
        }
        throw error
      } finally {
        client.release()
      }
    },

    async submitPatientTurn(
      principal, sessionId, turnId, learnerMessage, generateTurn, learnerModality = 'typed', onLockAttemptMeasured,
      recordCommitTiming
    ) {
      const owner = await pool.query(
        `SELECT s.status, s.prompt_version, s.model_version, s.schema_version, s.policy_version
         FROM app_sessions s
         JOIN tenant_entitlements e ON e.tenant_id = s.tenant_id AND e.sessions_enabled = true
         WHERE s.session_id = $1 AND s.tenant_id = $2 AND s.subject_id = $3`,
        [sessionId, principal.tenantId, principal.subjectId]
      )
      const ownerRow = owner.rows[0] as (Pick<SetupSessionRow,
        'status' | 'prompt_version' | 'model_version' | 'schema_version' | 'policy_version'
      >) | undefined
      if (!ownerRow) return 'not_found'
      if (!['ready', 'active'].includes(ownerRow.status ?? '')) return 'not_ready'
      if (!patientStateStore) return 'missing_state'

      await this.ensureLiveState?.(principal, sessionId)
      const lockToken = randomUUID()
      const lockAttemptStartedAt = performance.now()
      let lockAcquired: boolean
      try {
        lockAcquired = await patientStateStore.acquireTurnLock(sessionId, lockToken)
      } finally {
        try {
          onLockAttemptMeasured?.(Math.max(0, performance.now() - lockAttemptStartedAt))
        } catch {
          // Observability must not alter lock ownership or strand an acquired lock.
        }
      }
      if (!lockAcquired) return 'turn_in_progress'

      try {
        const current = await patientStateStore.read(sessionId)
        if (!current) return 'missing_state'
        const prior = current.acceptedTurns.find((turn) => turn.turnId === turnId)
        if (prior) {
          return prior.learnerMessage === learnerMessage && prior.learnerModality === learnerModality
            ? {
                status: 'duplicate', turnId: prior.turnId, sequence: prior.sequence,
                patientResponse: prior.patientResponse
              }
            : 'conflict'
        }
        if (current.state.status === 'completed' || current.state.status === 'cancelled') return 'not_ready'
        if (current.state.status !== 'ready' && current.state.status !== 'active') return 'not_ready'
        if (current.state.phase !== 'history' || current.state.interactionMode !== 'transcript') return 'not_ready'

        const quota = await this.consumeQuota(principal, 'responses', sessionId)
        if (quota !== 'allowed') return quota

        const acceptedAt = new Date(Math.max(Date.now(), Date.parse(current.state.updatedAt))).toISOString()
        const sequence = current.state.currentTurnSequence + 1
        const context: PatientTurnGenerationContext = {
          scenarioId: current.patientProfileId,
          profile: current.profile,
          conversationId: current.conversationId,
          versions: {
            promptVersion: PATIENT_TURN_PROMPT_VERSION,
            modelVersion: ownerRow.model_version,
            schemaVersion: PATIENT_TURN_SCHEMA_VERSION,
            policyVersion: PATIENT_TURN_POLICY_VERSION,
            rubricVersion: null
          },
          acceptedTurns: current.acceptedTurns,
          phase: current.state.phase,
          learnerMessage
        }

        let acceptedContent: AcceptedPatientTurnContent | undefined
        let validationFailed = false
        const providerUsage: ProviderUsageSample[] = []
        for (let attempt = 0; attempt < 2; attempt += 1) {
          let generated: { responseId: string; output: unknown; providerUsage: ProviderUsageSample | null }
          try {
            generated = await generateTurn({ ...context, retryAfterValidationFailure: attempt > 0 })
          } catch {
            queueTurnAudit(patientStateStore, 'patient_turn_model_failure', sessionId, turnId, attempt + 1, options.recordHandoffTiming)
            return 'provider_error'
          }
          if (generated.providerUsage) providerUsage.push(generated.providerUsage)
          try {
            acceptedContent = validatePatientTurnOutput(
              generated.output, context, turnId, sequence, acceptedAt
            )
            break
          } catch {
            validationFailed = true
          }
        }
        if (!acceptedContent) {
          queueTurnAudit(patientStateStore, 'patient_turn_validation_failure', sessionId, turnId, 2, options.recordHandoffTiming)
          acceptedContent = {
            patientResponse: 'Sorry, could you please repeat or clarify that?',
            patientReportedFacts: [],
            patientReportedPainFacts: [],
            historyCoverage: [],
            disclosedHistoryFields: [],
            disclosedFactIds: [],
            historyCoverageState: [],
            painHistoryCoverage: [],
            painDisclosures: []
          }
        }

        const turn = SessionTurnSchema.parse({
          turnId,
          sessionId,
          sequence,
          acceptedAt,
          phase: context.phase,
          learnerModality,
          versions: context.versions,
          learnerMessage,
          patientResponse: acceptedContent.patientResponse,
          patientReportedFacts: acceptedContent.patientReportedFacts,
          patientReportedPainFacts: acceptedContent.patientReportedPainFacts,
          historyCoverage: acceptedContent.historyCoverage,
          disclosedHistoryFields: acceptedContent.disclosedHistoryFields,
          disclosedFactIds: acceptedContent.disclosedFactIds,
          historyCoverageState: acceptedContent.historyCoverageState,
          painHistoryCoverage: acceptedContent.painHistoryCoverage,
          painDisclosures: acceptedContent.painDisclosures,
          clinicalActions: []
        })
        if (validationFailed && acceptedContent.patientResponse !== 'Sorry, could you please repeat or clarify that?') {
          queueTurnAudit(patientStateStore, 'patient_turn_recovered_after_validation_retry', sessionId, turnId, 2, options.recordHandoffTiming)
        }
        const committed = await patientStateStore.acceptTurn(turn, providerUsage, recordCommitTiming)
        if (committed.status === 'accepted' || committed.status === 'duplicate') return committed
        if (committed.status === 'terminal') return 'not_ready'
        if (committed.status === 'not_ready') return 'not_ready'
        if (committed.status === 'conflict') return 'conflict'
        return 'missing_state'
      } finally {
        try {
          await patientStateStore.releaseTurnLock(sessionId, lockToken)
        } catch {
          queueTurnAudit(patientStateStore, 'patient_turn_lock_release_failure', sessionId, turnId, 1, options.recordHandoffTiming)
        }
      }
    },

    async beginAssessment(principal, sessionId, recordCommitTiming) {
      if (!patientStateStore) return 'state_unavailable'
      const owner = await pool.query<{ status: SessionStatus }>(
        `SELECT s.status FROM app_sessions s
         JOIN tenant_entitlements e ON e.tenant_id = s.tenant_id AND e.sessions_enabled = true
         JOIN tenant_memberships m ON m.tenant_id = s.tenant_id AND m.subject_id = s.subject_id AND m.status = 'active'
         WHERE s.session_id = $1 AND s.tenant_id = $2 AND s.subject_id = $3`,
        [sessionId, principal.tenantId, principal.subjectId]
      )
      const session = owner.rows[0]
      if (!session) return 'not_found'
      if (!['ready', 'active'].includes(session.status)) return 'not_ready'
      await this.ensureLiveState?.(principal, sessionId)
      const lockToken = randomUUID()
      if (!await patientStateStore.acquireTurnLock(sessionId, lockToken)) return 'turn_in_progress'
      try {
        const current = await patientStateStore.read(sessionId)
        if (!current) return 'state_unavailable'
        if (current.state.phase === 'assessment') return 'assessment'
        if (current.state.phase !== 'history' || current.state.currentTurnSequence < 1) return 'not_ready'

        const lastTurn = current.acceptedTurns.at(-1)
        if (!lastTurn) return 'state_unavailable'
        const occurredAt = new Date(Math.max(Date.now(), Date.parse(current.state.updatedAt))).toISOString()
        const transitionId = randomUUID()
        const event = {
          eventId: transitionId,
          sessionId,
          sequence: current.state.currentTurnSequence,
          eventOrdinal: lastTurn.disclosedHistoryFields.length + lastTurn.painDisclosures.length + 1,
          eventType: 'phase_changed' as const,
          occurredAt,
          payload: {
            transitionId,
            sessionId,
            turnSequence: current.state.currentTurnSequence,
            from: 'history' as const,
            to: 'assessment' as const,
            occurredAt
          }
        }
        const result = await patientStateStore.changePhase(event, recordCommitTiming)
        if (result === 'accepted' || result === 'duplicate') return 'assessment'
        if (result === 'missing_state') return 'state_unavailable'
        if (result === 'not_ready') return 'not_ready'
        return 'phase_conflict'
      } finally {
        await releaseSessionMutationLock(patientStateStore, sessionId, lockToken, 'assessment_phase')
      }
    },

    async saveAssessmentDraft(principal, sessionId, revision, inputFields) {
      if (!patientStateStore) return 'state_unavailable'
      const owner = await pool.query<{ status: SessionStatus }>(
        `SELECT s.status FROM app_sessions s
         JOIN tenant_entitlements e ON e.tenant_id = s.tenant_id AND e.sessions_enabled = true
         JOIN tenant_memberships m ON m.tenant_id = s.tenant_id AND m.subject_id = s.subject_id AND m.status = 'active'
         WHERE s.session_id = $1 AND s.tenant_id = $2 AND s.subject_id = $3`,
        [sessionId, principal.tenantId, principal.subjectId]
      )
      const session = owner.rows[0]
      if (!session) return 'not_found'
      if (!['ready', 'active'].includes(session.status)) return 'not_ready'
      await this.ensureLiveState?.(principal, sessionId)
      const lockToken = randomUUID()
      if (!await patientStateStore.acquireTurnLock(sessionId, lockToken)) return 'turn_in_progress'
      try {
        const current = await patientStateStore.read(sessionId)
        if (!current) return 'state_unavailable'
        if (current.state.phase !== 'assessment' || current.assessment || current.terminalEvent) return 'phase_conflict'
        const fields = AssessmentDraftFieldsSchema.parse(inputFields)
        const saved = await pool.query<{
          revision: number
          fields: unknown
          updated_at: Date
        }>(
          `INSERT INTO app_assessment_drafts
             (session_id, tenant_id, subject_id, revision, fields, updated_at)
           SELECT s.session_id, s.tenant_id, s.subject_id, $4, $5::jsonb, now()
           FROM app_sessions s
           JOIN tenant_entitlements e ON e.tenant_id = s.tenant_id AND e.sessions_enabled = true
           JOIN tenant_memberships m ON m.tenant_id = s.tenant_id
             AND m.subject_id = s.subject_id AND m.status = 'active'
           WHERE s.session_id = $1 AND s.tenant_id = $2 AND s.subject_id = $3
             AND s.status IN ('ready', 'active')
           ON CONFLICT (session_id) DO UPDATE
             SET revision = EXCLUDED.revision, fields = EXCLUDED.fields, updated_at = EXCLUDED.updated_at
             WHERE app_assessment_drafts.revision < EXCLUDED.revision
           RETURNING revision, fields, updated_at`,
          [sessionId, principal.tenantId, principal.subjectId, revision, JSON.stringify(fields)]
        )
        const row = saved.rows[0] ?? (await pool.query<{
          revision: number
          fields: unknown
          updated_at: Date
        }>(
          `SELECT revision, fields, updated_at FROM app_assessment_drafts
           WHERE session_id = $1 AND tenant_id = $2 AND subject_id = $3`,
          [sessionId, principal.tenantId, principal.subjectId]
        )).rows[0]
        if (!row) return 'not_found'
        return {
          revision: Number(row.revision),
          fields: AssessmentDraftFieldsSchema.parse(row.fields),
          updatedAt: row.updated_at.toISOString()
        }
      } finally {
        await releaseSessionMutationLock(patientStateStore, sessionId, lockToken, 'assessment_submission')
      }
    },

    async recordLocalUtterance(principal, sessionId, input) {
      if (!patientStateStore) return 'state_unavailable'
      const owner = await pool.query<{ status: SessionStatus }>(
        `SELECT s.status FROM app_sessions s
         JOIN tenant_entitlements e ON e.tenant_id = s.tenant_id AND e.sessions_enabled = true
         JOIN tenant_memberships m ON m.tenant_id = s.tenant_id AND m.subject_id = s.subject_id AND m.status = 'active'
         WHERE s.session_id = $1 AND s.tenant_id = $2 AND s.subject_id = $3`,
        [sessionId, principal.tenantId, principal.subjectId]
      )
      const session = owner.rows[0]
      if (!session) return 'not_found'

      const findPrior = async () => pool.query<{
        utterance_id: string
        ordinal: number
        sequence: number
        kind: string
        speaker: 'learner' | 'patient'
        phase: 'history' | 'assessment' | 'debrief'
        modality: 'typed' | 'realtime_transcription' | 'text'
        content: string
        occurred_at: Date
      }>(
        `SELECT utterance_id, ordinal, sequence, kind, speaker, phase, modality, content, occurred_at
         FROM session_local_utterances
         WHERE session_id = $1 AND tenant_id = $2 AND subject_id = $3 AND utterance_id = $4`,
        [sessionId, principal.tenantId, principal.subjectId, input.utteranceId]
      )
      const toTranscriptRecord = (row: NonNullable<Awaited<ReturnType<typeof findPrior>>['rows'][number]>) =>
        LocalTranscriptUtteranceSchema.parse({
          utteranceId: row.utterance_id,
          ordinal: Number(row.ordinal),
          sequence: Number(row.sequence),
          kind: row.kind,
          speaker: row.speaker,
          phase: row.phase,
          modality: row.modality,
          content: row.content,
          occurredAt: row.occurred_at.toISOString()
        })
      const matchesInput = (record: LocalTranscriptUtterance) =>
        record.kind === input.kind && record.speaker === input.speaker && record.content === input.content
      const prior = (await findPrior()).rows[0]
      if (prior) {
        const record = toTranscriptRecord(prior)
        return matchesInput(record) ? record : 'phase_conflict'
      }
      if (!['ready', 'active'].includes(session.status)) return 'not_ready'
      await this.ensureLiveState?.(principal, sessionId)
      const lockToken = randomUUID()
      if (!await patientStateStore.acquireTurnLock(sessionId, lockToken)) return 'turn_in_progress'
      try {
        const current = await patientStateStore.read(sessionId)
        if (!current) return 'state_unavailable'
        const retry = (await findPrior()).rows[0]
        if (retry) {
          const record = toTranscriptRecord(retry)
          return matchesInput(record) ? record : 'phase_conflict'
        }
        if (current.state.phase !== 'history' ||
            current.state.status === 'completed' || current.state.status === 'cancelled') return 'phase_conflict'
        const sequence = current.state.currentTurnSequence
        const phase = current.state.phase
        const modality = input.speaker === 'patient' ? 'text' as const : 'realtime_transcription' as const
        const occurredAt = new Date(Math.max(Date.now(), Date.parse(current.state.updatedAt))).toISOString()
        const inserted = await pool.query<{
          utterance_id: string
          ordinal: number
          sequence: number
          kind: string
          speaker: 'learner' | 'patient'
          phase: 'history' | 'assessment' | 'debrief'
          modality: 'typed' | 'realtime_transcription' | 'text'
          content: string
          occurred_at: Date
        }>(
          `WITH next_ordinal AS (
             SELECT coalesce(max(ordinal), 0) + 1 AS ordinal
             FROM session_local_utterances WHERE session_id = $1
           )
           INSERT INTO session_local_utterances
             (session_id, tenant_id, subject_id, utterance_id, ordinal, sequence,
              kind, speaker, phase, modality, content, occurred_at)
           SELECT $1, $2, $3, $4, next_ordinal.ordinal, $5, $6, $7, $8, $9, $10, $11::timestamptz
           FROM next_ordinal
           ON CONFLICT (session_id, utterance_id) DO NOTHING
           RETURNING utterance_id, ordinal, sequence, kind, speaker, phase, modality, content, occurred_at`,
          [sessionId, principal.tenantId, principal.subjectId, input.utteranceId, sequence,
            input.kind, input.speaker, phase, modality, input.content, occurredAt]
        )
        const row = inserted.rows[0] ?? (await findPrior()).rows[0]
        if (!row) return 'state_unavailable'
        const record = toTranscriptRecord(row)
        return matchesInput(record) ? record : 'phase_conflict'
      } finally {
        await releaseSessionMutationLock(patientStateStore, sessionId, lockToken, 'local_utterance')
      }
    },

    async submitAssessment(principal, sessionId, assessmentId, inputFields, recordCommitTiming) {
      if (!patientStateStore) return 'state_unavailable'
      const owner = await pool.query<{ status: SessionStatus }>(
        `SELECT s.status FROM app_sessions s
         JOIN tenant_entitlements e ON e.tenant_id = s.tenant_id AND e.sessions_enabled = true
         JOIN tenant_memberships m ON m.tenant_id = s.tenant_id AND m.subject_id = s.subject_id AND m.status = 'active'
         WHERE s.session_id = $1 AND s.tenant_id = $2 AND s.subject_id = $3`,
        [sessionId, principal.tenantId, principal.subjectId]
      )
      const session = owner.rows[0]
      if (!session) return 'not_found'
      if (!['ready', 'active', 'completed'].includes(session.status)) return 'not_ready'
      await this.ensureLiveState?.(principal, sessionId)
      const lockToken = randomUUID()
      if (!await patientStateStore.acquireTurnLock(sessionId, lockToken)) return 'turn_in_progress'
      try {
        const current = await patientStateStore.read(sessionId)
        if (!current) return 'state_unavailable'
        if (current.assessment) {
          if (current.assessment.assessmentId !== assessmentId) return 'phase_conflict'
          const fields = AssessmentFieldsSchema.parse(inputFields)
          if (Object.keys(fields).some((key) => fields[key as keyof typeof fields] !== current.assessment?.[key as keyof AssessmentSubmission])) {
            return 'phase_conflict'
          }
          if (current.terminalEvent) {
            return {
              assessmentId,
              status: 'unscored',
              submittedAt: current.assessment.submittedAt
            }
          }
        }
        if (!current.assessment && (current.state.phase !== 'assessment' || current.state.currentTurnSequence < 1)) return 'not_ready'

        const fields = AssessmentFieldsSchema.parse(inputFields)
        const submission = current.assessment ?? (() => {
          const lastTurn = current.acceptedTurns.at(-1)
          if (!lastTurn) return null
          const submittedAt = new Date(Math.max(Date.now(), Date.parse(current.state.updatedAt))).toISOString()
          return AssessmentSubmissionSchema.parse({
            assessmentId,
            sessionId,
            turnSequence: current.state.currentTurnSequence,
            submittedAt,
            ...fields
          })
        })()
        if (!submission) return 'state_unavailable'
        if (!current.assessment) {
          const lastTurn = current.acceptedTurns.at(-1)
          if (!lastTurn) return 'state_unavailable'
          const assessmentEvent = {
            eventId: assessmentId,
            sessionId,
            sequence: current.state.currentTurnSequence,
            eventOrdinal: lastTurn.disclosedHistoryFields.length + lastTurn.painDisclosures.length + 2,
            eventType: 'assessment_submitted' as const,
            occurredAt: submission.submittedAt,
            payload: submission
          }
          const committed = await patientStateStore.acceptAssessment(assessmentEvent, recordCommitTiming)
          if (committed === 'missing_state') return 'state_unavailable'
          if (committed === 'not_ready') return 'not_ready'
          if (committed === 'conflict') return 'phase_conflict'
        }

        await pool.query(
          `DELETE FROM app_assessment_drafts
           WHERE session_id = $1 AND tenant_id = $2 AND subject_id = $3`,
          [sessionId, principal.tenantId, principal.subjectId]
        )

        const latest = await patientStateStore.read(sessionId)
        if (!latest) return 'state_unavailable'
        if (!latest.terminalEvent) {
          const terminal: TerminalEvent = {
            eventId: randomUUID(),
            sessionId,
            outcome: 'completed',
            occurredAt: submission.submittedAt,
            reason: null,
            finalTurnSequence: current.state.currentTurnSequence
          }
          const completed = await patientStateStore.recordTerminal(terminal, recordCommitTiming)
          if (completed !== 'accepted' && completed !== 'duplicate') return 'state_unavailable'
        }
        return { assessmentId, status: 'unscored', submittedAt: submission.submittedAt }
      } finally {
        await releaseSessionMutationLock(patientStateStore, sessionId, lockToken, 'assessment_submission')
      }
    },

    async getOwnedSession(principal, sessionId) {
      const result = await pool.query<{
        session_id: string
        status: SessionStatus
        created_at: Date
        updated_at: Date
        prompt_version: string
        model_version: string
        schema_version: number
        policy_version: string
      }>(
        `SELECT s.session_id, s.status, s.created_at, s.updated_at,
                s.prompt_version, s.model_version, s.schema_version, s.policy_version
         FROM app_sessions s
         JOIN tenant_entitlements e ON e.tenant_id = s.tenant_id AND e.sessions_enabled = true
         WHERE s.session_id = $1 AND s.tenant_id = $2 AND s.subject_id = $3`,
        [sessionId, principal.tenantId, principal.subjectId]
      )
      const row = result.rows[0]
      return row ? {
        sessionId: row.session_id,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        versions: toVersionPins(row)
      } : null
    },

    async getCurrentOwnedEncounter(principal) {
      let indexedSessionId: string | null = null
      try {
        indexedSessionId = await patientStateStore?.findOwnedSession(principal.tenantId, principal.subjectId) ?? null
      } catch {
        // Redis may have restarted or be temporarily unavailable; PostgreSQL remains the recovery index.
      }
      const queryCurrent = (sessionId: string | null) => pool.query<{
        session_id: string
        status: 'initializing' | 'ready' | 'active'
        created_at: Date
        updated_at: Date
        prompt_version: string
        model_version: string
        schema_version: number
        policy_version: string
      }>(
        `SELECT s.session_id, s.status, s.created_at, s.updated_at,
                s.prompt_version, s.model_version, s.schema_version, s.policy_version
         FROM app_sessions s
         JOIN tenant_entitlements e ON e.tenant_id = s.tenant_id AND e.sessions_enabled = true
         JOIN tenant_memberships m ON m.tenant_id = s.tenant_id
           AND m.subject_id = s.subject_id AND m.status = 'active'
         WHERE s.tenant_id = $1 AND s.subject_id = $2
           AND s.status IN ('initializing', 'ready', 'active')
           AND ($3::text IS NULL OR s.session_id = $3)
           AND ($3::text IS NULL OR NOT EXISTS (
             SELECT 1
             FROM app_sessions newer
             WHERE newer.tenant_id = s.tenant_id AND newer.subject_id = s.subject_id
               AND newer.status IN ('initializing', 'ready', 'active')
               AND ROW(newer.updated_at, newer.created_at, newer.session_id) >
                   ROW(s.updated_at, s.created_at, s.session_id)
           ))
         ORDER BY s.updated_at DESC, s.created_at DESC, s.session_id DESC
         LIMIT 1`,
        [principal.tenantId, principal.subjectId, sessionId]
      )
      let row = indexedSessionId ? (await queryCurrent(indexedSessionId)).rows[0] : undefined
      if (!row) row = (await queryCurrent(null)).rows[0]
      if (!row) return null
      if (indexedSessionId !== row.session_id) {
        try {
          await patientStateStore?.rememberOwnedSession(principal.tenantId, principal.subjectId, row.session_id)
        } catch {
          // The next resume can use PostgreSQL again and rebuild this Redis lookup.
        }
      }

      const base = {
        sessionId: row.session_id,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        versions: toVersionPins(row)
      } as const
      if (row.status === 'initializing') {
        return {
          ...base,
          patient: null,
          phase: null,
          currentTurnSequence: 0,
          transcript: [],
          localUtterances: [],
          assessmentDraft: null,
          assessment: null
        }
      }

      await this.ensureLiveState?.(principal, row.session_id)
      const live = await patientStateStore?.read(row.session_id)
      if (!live) throw new Error('An active owned encounter has no recoverable live state')
      if (live.state.status === 'completed' || live.state.status === 'cancelled') return null
      const assessment = live.assessment
      const draftQuery = assessment ? null : await pool.query<{
        revision: number
        fields: unknown
        updated_at: Date
      }>(
        `SELECT revision, fields, updated_at FROM app_assessment_drafts
         WHERE session_id = $1 AND tenant_id = $2 AND subject_id = $3`,
        [row.session_id, principal.tenantId, principal.subjectId]
      )
      const draftRow = draftQuery?.rows[0]
      const localUtterancesQuery = await pool.query<{
        utterance_id: string
        ordinal: number
        sequence: number
        kind: string
        speaker: 'learner' | 'patient'
        phase: 'history' | 'assessment' | 'debrief'
        modality: 'typed' | 'realtime_transcription' | 'text'
        content: string
        occurred_at: Date
      }>(
        `SELECT utterance_id, ordinal, sequence, kind, speaker, phase, modality, content, occurred_at
         FROM session_local_utterances
         WHERE session_id = $1 AND tenant_id = $2 AND subject_id = $3
         ORDER BY sequence, ordinal`,
        [row.session_id, principal.tenantId, principal.subjectId]
      )
      return {
        ...base,
        status: live.state.status,
        updatedAt: live.state.updatedAt,
        patient: toLearnerPatientProfile(live.setupProjection),
        phase: live.state.phase,
        currentTurnSequence: live.state.currentTurnSequence,
        transcript: live.acceptedTurns.map((turn) => ({
          turnId: turn.turnId,
          sequence: turn.sequence,
          acceptedAt: turn.acceptedAt,
          phase: turn.phase,
          learnerModality: turn.learnerModality,
          learnerMessage: turn.learnerMessage,
          patientResponse: turn.patientResponse
        })),
        localUtterances: localUtterancesQuery.rows.map((utterance) => LocalTranscriptUtteranceSchema.parse({
          utteranceId: utterance.utterance_id,
          ordinal: Number(utterance.ordinal),
          sequence: Number(utterance.sequence),
          kind: utterance.kind,
          speaker: utterance.speaker,
          phase: utterance.phase,
          modality: utterance.modality,
          content: utterance.content,
          occurredAt: utterance.occurred_at.toISOString()
        })),
        assessmentDraft: draftRow ? {
          revision: Number(draftRow.revision),
          fields: AssessmentDraftFieldsSchema.parse(draftRow.fields),
          updatedAt: draftRow.updated_at.toISOString()
        } : null,
        assessment: assessment ? {
          assessmentId: assessment.assessmentId,
          fields: {
            summary: assessment.summary,
            differential: assessment.differential,
            rationale: assessment.rationale,
            plan: assessment.plan
          },
          submittedAt: assessment.submittedAt
        } : null
      }
    },

    async ensureLiveState(principal, sessionId) {
      if (!patientStateStore) return
      const verifyAndRecordIdentity = async (live: LivePatientState): Promise<void> => {
        if (live.state.status === 'initializing') return
        const selectedIdentity = await pool.query<{
          session_id: string
          tenant_id: string
          subject_id: string
          patient_profile_id: string
          provider_conversation_id: string
          scenario_fingerprint: string
          schema_version: number
        }>(
          `SELECT session_id, tenant_id, subject_id, patient_profile_id,
                  provider_conversation_id, scenario_fingerprint, schema_version
           FROM session_identity_binding
           WHERE session_id = $1 AND tenant_id = $2 AND subject_id = $3`,
          [sessionId, principal.tenantId, principal.subjectId]
        )
        const identityRow = selectedIdentity.rows[0]
        if (!identityRow) throw new Error('The active owned encounter has no durable identity binding')
        const identity = SessionIdentityBindingSchema.parse({
          sessionId: identityRow.session_id,
          tenantId: identityRow.tenant_id,
          subjectId: identityRow.subject_id,
          patientProfileId: identityRow.patient_profile_id,
          providerConversationId: identityRow.provider_conversation_id,
          scenarioFingerprint: identityRow.scenario_fingerprint,
          schemaVersion: identityRow.schema_version
        })
        const status = verifySessionIdentityBinding(identity, live)
        await pool.query(
          `UPDATE session_identity_binding
           SET last_check_at = now(),
               last_verified_at = CASE WHEN $2 = 'verified' THEN now() ELSE last_verified_at END,
               last_verification_status = $2
           WHERE session_id = $1`,
          [sessionId, status]
        )
        if (status !== 'verified') throw new Error(`The active owned encounter identity check returned ${status}`)
      }

      const existingLive = await patientStateStore.read(sessionId)
      if (existingLive) {
        await verifyAndRecordIdentity(existingLive)
        return
      }
      const selected = await pool.query<{
        session_id: string
        patient_profile_id: string | null
        status: SessionStatus
        created_at: Date
        updated_at: Date
        schema_version: number
        profile_digest: string | null
        profile_json: unknown | null
        provider_conversation_id: string | null
      }>(
        `SELECT s.session_id, s.patient_profile_id, s.status, s.created_at, s.updated_at,
                s.schema_version, p.profile_digest, p.profile_json, p.provider_conversation_id
         FROM app_sessions s
         JOIN tenant_entitlements e ON e.tenant_id = s.tenant_id AND e.sessions_enabled = true
         LEFT JOIN patient_scenarios p ON p.session_id = s.session_id
         WHERE s.session_id = $1 AND s.tenant_id = $2 AND s.subject_id = $3`,
        [sessionId, principal.tenantId, principal.subjectId]
      )
      const session = selected.rows[0]
      if (!session || !session.patient_profile_id || !session.profile_json ||
          !session.profile_digest || !session.provider_conversation_id) return
      if (session.schema_version !== PATIENT_SCENARIO_SCHEMA_VERSION) {
        throw new Error(`Stored patient scenario schema version ${session.schema_version} is unsupported`)
      }

      const profile = PatientScenarioProfileSchema.parse(session.profile_json)
      const profileDigest = createHash('sha256').update(canonicalJsonStringify(profile)).digest('hex')
      if (profileDigest !== session.profile_digest) {
        throw new Error('Stored patient scenario digest does not match its profile during Redis recovery')
      }
      const eventRows = await pool.query<{
        event_id: string
        sequence: string | number
        event_ordinal: number
        event_type: 'accepted_turn' | 'disclosure' | 'phase_changed' | 'assessment_submitted' | 'terminal'
        occurred_at: Date
        payload: unknown
      }>(
        `SELECT event_id, sequence, event_ordinal, event_type, occurred_at, payload
         FROM session_events WHERE session_id = $1 ORDER BY sequence, event_ordinal`,
        [sessionId]
      )
      const acceptedTurns: SessionTurn[] = []
      let terminalEvent: TerminalEvent | null = null
      let assessment: AssessmentSubmission | null = null
      let phase: 'history' | 'assessment' | 'debrief' = 'history'
      for (const row of eventRows.rows) {
        if (row.event_type === 'accepted_turn') {
          acceptedTurns.push(SessionTurnSchema.parse(row.payload))
        } else if (row.event_type === 'phase_changed') {
          phase = 'assessment'
        } else if (row.event_type === 'assessment_submitted') {
          assessment = AssessmentSubmissionSchema.parse(row.payload)
          phase = 'debrief'
        } else if (row.event_type === 'terminal') {
          terminalEvent = TerminalEventSchema.parse(row.payload)
        }
      }
      const lastTurn = acceptedTurns.at(-1)
      const state = SessionStateSchema.parse({
        sessionId,
        scenarioId: session.patient_profile_id,
        status: terminalEvent?.outcome ?? (lastTurn ? 'active' : session.status),
        phase: terminalEvent ? 'debrief' : phase,
        interactionMode: 'transcript',
        openedAt: session.created_at.toISOString(),
        updatedAt: terminalEvent?.occurredAt ?? lastTurn?.acceptedAt ?? session.updated_at.toISOString(),
        currentTurnSequence: lastTurn?.sequence ?? 0,
        terminalEventId: terminalEvent?.eventId ?? null
      })
      const liveState: LivePatientState = {
        sessionId,
        patientProfileId: session.patient_profile_id,
        openedAt: session.created_at.toISOString(),
        profile,
        setupProjection: derivePatientSetup(profile),
        conversationId: session.provider_conversation_id,
        profileDigest,
        schemaVersion: session.schema_version,
        state,
        acceptedTurns,
        assessment,
        terminalEvent
      }
      await patientStateStore.restore(liveState)
      const restoredLive = await patientStateStore.read(sessionId)
      if (!restoredLive) throw new Error('PostgreSQL recovery did not restore the live session state')
      await verifyAndRecordIdentity(restoredLive)
    }
  }
}

async function reserveMonthlyQuota(
  client: PoolClient,
  tenantId: string,
  feature: QuotaFeature,
  quota: number | null
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO tenant_monthly_usage (tenant_id, feature, month_start, used)
     SELECT $1, $2, date_trunc('month', now() AT TIME ZONE 'UTC')::date, 1
     WHERE $3::integer IS NULL OR $3::integer > 0
     ON CONFLICT (tenant_id, feature, month_start)
     DO UPDATE SET used = tenant_monthly_usage.used + 1
       WHERE $3::integer IS NULL OR tenant_monthly_usage.used < $3::integer
     RETURNING used`,
    [tenantId, feature, quota]
  )
  return (result.rowCount ?? 0) === 1
}

async function reserveUserMonthlyQuota(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  feature: QuotaFeature,
  quota: number | null
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO tenant_user_monthly_usage (tenant_id, subject_id, feature, month_start, used)
     SELECT $1, $2, $3, date_trunc('month', now() AT TIME ZONE 'UTC')::date, 1
     WHERE $4::integer IS NULL OR $4::integer > 0
     ON CONFLICT (tenant_id, subject_id, feature, month_start)
     DO UPDATE SET used = tenant_user_monthly_usage.used + 1
       WHERE $4::integer IS NULL OR tenant_user_monthly_usage.used < $4::integer
     RETURNING used`,
    [tenantId, subjectId, feature, quota]
  )
  return (result.rowCount ?? 0) === 1
}

async function reserveSessionQuota(
  client: PoolClient,
  tenantId: string,
  subjectId: string,
  sessionId: string,
  quota: number | null
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO app_session_usage (session_id, tenant_id, subject_id, feature, used)
     SELECT $1, $2, $3, 'responses', 1
     WHERE $4::integer IS NULL OR $4::integer > 0
     ON CONFLICT (session_id, feature)
     DO UPDATE SET used = app_session_usage.used + 1, updated_at = now()
       WHERE $4::integer IS NULL OR app_session_usage.used < $4::integer
     RETURNING used`,
    [sessionId, tenantId, subjectId, quota]
  )
  return (result.rowCount ?? 0) === 1
}
