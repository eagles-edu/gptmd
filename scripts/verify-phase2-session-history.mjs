import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { parseEnv } from 'node:util'
import { canonicalJsonStringify } from '../services/api/src/canonical-json.ts'
import { createRedisPatientStateStore } from '../services/api/src/patient-state-store.ts'
import { createPostgresSessionStore } from '../services/api/src/session-store.ts'
import { createSessionEventWorker } from '../services/api/src/session-event-worker.ts'

const require = createRequire(new URL('../services/api/package.json', import.meta.url))
const { Pool } = require('pg')
const { createClient } = require('redis')

const env = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'))
if (!env.DATABASE_URL || !env.REDIS_URL) throw new Error('DATABASE_URL and REDIS_URL are required')

const redis = createClient({ url: env.REDIS_URL })
redis.on('error', () => undefined)
await redis.connect()
const streamKey = 'gptmd:session-events'
const currentStreamLength = Number(await redis.sendCommand(['XLEN', streamKey]))
if (currentStreamLength !== 0) {
  await redis.quit()
  throw new Error('Refusing local verification because the shared session event stream is not empty')
}
const persistenceConfig = await redis.sendCommand(['CONFIG', 'GET', 'appendfsync'])
if (!persistenceConfig || typeof persistenceConfig !== 'object' ||
    persistenceConfig.appendfsync !== 'everysec') {
  await redis.quit()
  throw new Error('Redis appendfsync is not configured for the documented one-second write window')
}

const temporaryDatabase = `gptmd_phase2_verify_${randomBytes(6).toString('hex')}`
const adminUrl = new URL(env.DATABASE_URL)
const adminPool = new Pool({ connectionString: adminUrl.toString(), max: 1 })
const testUrl = new URL(env.DATABASE_URL)
testUrl.pathname = `/${temporaryDatabase}`
let testPool
let sessionId
let patientProfileId

try {
  await adminPool.query(`CREATE DATABASE "${temporaryDatabase}"`)
  testPool = new Pool({ connectionString: testUrl.toString(), max: 2 })
  for (const file of [
    '001_auth_sessions.sql',
    '002_patient_scenario_setup.sql',
    '003_patient_profile_binding.sql',
    '004_durable_session_history.sql',
    '005_setup_failure_status.sql',
    '006_tenant_membership_roles.sql',
    '007_user_and_session_quotas.sql',
    '008_scope_session_usage_to_owner.sql',
    '009_audio_transcription_policy.sql',
    '010_disclosure_event_ordinals.sql',
    '011_persist_scenario_seed.sql',
    '013_assessment_events.sql',
    '014_session_turn_audits.sql',
    '015_session_transcript_view.sql',
    '016_strict_session_transcript_view.sql',
    '017_audio_transcription_expiry.sql',
    '018_provider_usage_cost_attribution.sql'
  ]) {
    const sql = await readFile(new URL(`../services/api/migrations/${file}`, import.meta.url), 'utf8')
    await testPool.query(sql)
  }

  sessionId = randomBytes(32).toString('base64url')
  patientProfileId = randomBytes(32).toString('base64url')
  const tenantId = `phase2-${randomBytes(6).toString('hex')}`
  const subjectId = `verify-${randomBytes(6).toString('hex')}`
  const profile = {
    fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average',
    reasonForVisit: 'Pelvic pain', diagnosis: 'Endometriosis',
    history: [{ field: 'anyPain', status: 'known', value: 'Pelvic pain' }],
    currentPregnancyStatus: 'unknown', currentMenopausalStatus: 'unknown',
    patientBeliefs: [], supportedExamFindings: [], supportedTestResults: [],
    persona: {
      mood: 'concerned', maturity: 'adult', verbosity: 'moderate',
      educationLevel: 'college', willingnessToDisclose: 'gradual'
    }
  }
  const profileDigest = createHash('sha256').update(canonicalJsonStringify(profile)).digest('hex')
  const createdAt = new Date(Date.now() - 60_000).toISOString()
  await testPool.query('INSERT INTO tenants (tenant_id) VALUES ($1)', [tenantId])
  await testPool.query(
    `INSERT INTO tenant_entitlements (tenant_id, sessions_enabled, responses_enabled)
     VALUES ($1, true, true)`,
    [tenantId]
  )
  await testPool.query(
    `INSERT INTO tenant_memberships (tenant_id, subject_id, status) VALUES ($1, $2, 'active')`,
    [tenantId, subjectId]
  )
  await testPool.query(
    `INSERT INTO app_sessions (
       session_id, patient_profile_id, tenant_id, subject_id, status, schema_version
     ) VALUES ($1, $2, $3, $4, 'ready', 5)`,
    [sessionId, patientProfileId, tenantId, subjectId]
  )
  await testPool.query(
    `INSERT INTO patient_scenarios (
       scenario_id, session_id, schema_version, created_at, profile_digest, profile_json,
       provider_conversation_id, prompt_version, model_version, policy_version
     ) VALUES ($1, $2, 5, $3, $4, $5::jsonb, 'verification-conversation',
       'patient-scenario-prompt-v5', 'gpt-6-luna', 'patient-scenario-policy-v3')`,
    [patientProfileId, sessionId, createdAt, profileDigest, JSON.stringify(profile)]
  )

  const stateStore = createRedisPatientStateStore(redis)
  await stateStore.initialize(sessionId, patientProfileId)
  await stateStore.saveReady({
    sessionId, patientProfileId, openedAt: createdAt, profile,
    setupProjection: {
      fullName: profile.fullName, dateOfBirth: profile.dateOfBirth,
      bodyType: profile.bodyType, reasonForVisit: profile.reasonForVisit,
      diagnosis: profile.diagnosis
    },
    conversationId: 'verification-conversation', profileDigest, schemaVersion: 5
  })

  const turnId = `turn-${randomBytes(6).toString('hex')}`
  const acceptedAt = new Date().toISOString()
  const factId = `fact-${randomBytes(6).toString('hex')}`
  const turn = {
    turnId, sessionId, sequence: 1, acceptedAt, phase: 'history', learnerMessage: 'What brings you in?',
    versions: {
      promptVersion: 'patient-turn-prompt-v7', modelVersion: 'gpt-6-luna',
      schemaVersion: 3, policyVersion: 'patient-turn-policy-v6', rubricVersion: null
    },
    learnerModality: 'realtime_transcription',
    patientResponse: 'I have pelvic pain.',
    patientReportedFacts: [{
      factId, field: 'patientConcern',
      section: 'Symptoms and menstrual history',
      value: 'I am worried about what is causing the pain.', source: 'patient_reported',
      turnId, turnSequence: 1, recordedAt: acceptedAt
    }],
    historyCoverage: ['patientConcern'], disclosedHistoryFields: ['patientConcern'],
    disclosedFactIds: [factId], historyCoverageState: [], clinicalActions: []
  }
  const patientTurnUsage = {
    responseId: `resp-${randomBytes(6).toString('hex')}`,
    model: 'gpt-6-luna', serviceTier: 'default',
    inputTokens: 120,
    cachedInputTokens: 20,
    cacheWriteTokens: 0,
    outputTokens: 30,
    totalTokens: 150,
    durationMs: 842,
    pricingVersion: 'openai-api-pricing-2026-10-06', estimatedCostUsd: '0.000025200000'
  }
  const commits = await Promise.all([
    stateStore.acceptTurn(turn, [patientTurnUsage]),
    stateStore.acceptTurn(turn, [patientTurnUsage])
  ])
  if (commits[0]?.patientResponse !== turn.patientResponse || commits[1]?.patientResponse !== turn.patientResponse ||
      !commits.some((commit) => commit.status === 'duplicate')) {
    throw new Error('Redis idempotent turn retry did not return the saved reply')
  }
  const live = await stateStore.read(sessionId)
  if (live?.acceptedTurns.length !== 1 || live.state.currentTurnSequence !== 1) {
    throw new Error('Redis turn commit did not update live state exactly once')
  }

  const worker = createSessionEventWorker(redis, testPool, { consumerName: `verify-${process.pid}`, blockMs: 1 })
  await worker.ensureGroup()
  if (await worker.processOnce() !== 2) throw new Error('Event worker did not persist and acknowledge the accepted turn and disclosure')
  const transcript = await testPool.query(
    `SELECT turn_id, sequence, utterance_index, speaker, occurred_at, phase, modality, content
     FROM session_transcript WHERE session_id = $1 ORDER BY sequence, utterance_index`, [sessionId]
  )
  if (transcript.rows.length !== 2 ||
      transcript.rows[0]?.speaker !== 'learner' || transcript.rows[0]?.modality !== 'realtime_transcription' ||
      transcript.rows[0]?.content !== turn.learnerMessage ||
      transcript.rows[1]?.speaker !== 'patient' || transcript.rows[1]?.modality !== 'text' ||
      transcript.rows[1]?.content !== turn.patientResponse ||
      transcript.rows.some((row) => row.phase !== 'history' || row.turn_id !== turn.turnId ||
        Number(row.sequence) !== turn.sequence || new Date(row.occurred_at).toISOString() !== turn.acceptedAt)) {
    throw new Error('Durable transcript projection did not preserve speaker, time, phase, modality, and turn ID')
  }
  const turnEnvelope = {
    eventId: turn.turnId, sessionId, sequence: 1, eventOrdinal: 0, eventType: 'accepted_turn',
    occurredAt: turn.acceptedAt, providerUsage: [patientTurnUsage], payload: turn
  }
  await redis.sendCommand(['XADD', streamKey, '*', 'event', JSON.stringify(turnEnvelope)])
  if (await worker.processOnce() !== 1) throw new Error('Worker did not acknowledge the idempotent PostgreSQL retry')
  const durableTurnCount = await testPool.query(
    `SELECT count(*)::int AS count FROM session_events WHERE session_id = $1`, [sessionId]
  )
  if (durableTurnCount.rows[0]?.count !== 2) throw new Error('Worker retry duplicated a PostgreSQL turn or disclosure event')
  const durableTurnUsage = await testPool.query(
    `SELECT provider_response_id, operation, model_id, service_tier, input_tokens,
            cached_input_tokens, cache_write_tokens, output_tokens, total_tokens,
            estimated_cost_usd, pricing_version, duration_ms
     FROM provider_usage WHERE session_id = $1 AND event_id = $2`, [sessionId, turnId]
  )
  if (durableTurnUsage.rows.length !== 1 ||
      durableTurnUsage.rows[0]?.provider_response_id !== patientTurnUsage.responseId ||
      durableTurnUsage.rows[0]?.operation !== 'patient_turn' ||
      durableTurnUsage.rows[0]?.model_id !== patientTurnUsage.model ||
      durableTurnUsage.rows[0]?.service_tier !== patientTurnUsage.serviceTier ||
      Number(durableTurnUsage.rows[0]?.input_tokens) !== patientTurnUsage.inputTokens ||
      Number(durableTurnUsage.rows[0]?.cached_input_tokens) !== patientTurnUsage.cachedInputTokens ||
      Number(durableTurnUsage.rows[0]?.cache_write_tokens) !== patientTurnUsage.cacheWriteTokens ||
      Number(durableTurnUsage.rows[0]?.output_tokens) !== patientTurnUsage.outputTokens ||
      Number(durableTurnUsage.rows[0]?.total_tokens) !== patientTurnUsage.totalTokens ||
      Number(durableTurnUsage.rows[0]?.estimated_cost_usd).toFixed(12) !== patientTurnUsage.estimatedCostUsd ||
      durableTurnUsage.rows[0]?.pricing_version !== patientTurnUsage.pricingVersion ||
      Number(durableTurnUsage.rows[0]?.duration_ms) !== patientTurnUsage.durationMs) {
    throw new Error('Patient-turn provider usage was not durably recorded exactly once')
  }

  const scenarioGenerationUsage = {
    responseId: `resp-${randomBytes(6).toString('hex')}`,
    model: 'gpt-6-luna', serviceTier: 'default',
    inputTokens: 900,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 300,
    totalTokens: 1200,
    durationMs: 3420,
    pricingVersion: 'openai-api-pricing-2026-10-06', estimatedCostUsd: '0.000240000000'
  }
  const scenarioUsageEvent = {
    eventId: `usage_${createHash('sha256').update(`openai\0${scenarioGenerationUsage.responseId}`).digest('hex')}`,
    sessionId,
    eventType: 'provider_usage',
    operation: 'scenario_generation',
    occurredAt: new Date().toISOString(),
    usage: scenarioGenerationUsage
  }
  await stateStore.appendProviderUsage(scenarioUsageEvent)
  if (await worker.processOnce() !== 1) throw new Error('Worker did not persist the scenario-generation usage event')
  const durableScenarioUsage = await testPool.query(
    `SELECT operation, model_id, service_tier, input_tokens, cached_input_tokens,
            cache_write_tokens, output_tokens, total_tokens, estimated_cost_usd,
            pricing_version, duration_ms
     FROM provider_usage WHERE session_id = $1 AND provider_response_id = $2`,
    [sessionId, scenarioGenerationUsage.responseId]
  )
  if (durableScenarioUsage.rows.length !== 1 ||
      durableScenarioUsage.rows[0]?.operation !== 'scenario_generation' ||
      durableScenarioUsage.rows[0]?.model_id !== scenarioGenerationUsage.model ||
      durableScenarioUsage.rows[0]?.service_tier !== scenarioGenerationUsage.serviceTier ||
      Number(durableScenarioUsage.rows[0]?.input_tokens) !== scenarioGenerationUsage.inputTokens ||
      Number(durableScenarioUsage.rows[0]?.cached_input_tokens) !== scenarioGenerationUsage.cachedInputTokens ||
      Number(durableScenarioUsage.rows[0]?.cache_write_tokens) !== scenarioGenerationUsage.cacheWriteTokens ||
      Number(durableScenarioUsage.rows[0]?.output_tokens) !== scenarioGenerationUsage.outputTokens ||
      Number(durableScenarioUsage.rows[0]?.total_tokens) !== scenarioGenerationUsage.totalTokens ||
      Number(durableScenarioUsage.rows[0]?.estimated_cost_usd).toFixed(12) !== scenarioGenerationUsage.estimatedCostUsd ||
      durableScenarioUsage.rows[0]?.pricing_version !== scenarioGenerationUsage.pricingVersion ||
      Number(durableScenarioUsage.rows[0]?.duration_ms) !== scenarioGenerationUsage.durationMs) {
    throw new Error('Scenario-generation provider usage was not durably recorded exactly once')
  }

  const auditEvent = {
    eventId: randomUUID(), sessionId, eventType: 'patient_turn_validation_failure',
    occurredAt: new Date().toISOString(),
    payload: { turnIdHash: createHash('sha256').update(`failed-${randomUUID()}`).digest('hex'), attemptCount: 2 }
  }
  await stateStore.appendAuditEvent(auditEvent)
  if (await worker.processOnce() !== 1) throw new Error('Event worker did not persist the turn audit event')
  const durableAudit = await testPool.query(
    `SELECT session_id, turn_id_hash, event_type, attempt_count FROM session_turn_audits WHERE audit_id = $1`,
    [auditEvent.eventId]
  )
  if (durableAudit.rows[0]?.session_id !== sessionId ||
      durableAudit.rows[0]?.turn_id_hash !== auditEvent.payload.turnIdHash ||
      durableAudit.rows[0]?.event_type !== auditEvent.eventType ||
      durableAudit.rows[0]?.attempt_count !== auditEvent.payload.attemptCount) {
    throw new Error('Turn audit metadata did not persist through the Redis worker')
  }

  const sessionStore = createPostgresSessionStore(testPool, stateStore)
  if (await sessionStore.beginAssessment({ tenantId, subjectId }, sessionId) !== 'assessment') {
    throw new Error('Redis assessment phase transition was not accepted')
  }
  const phaseState = await stateStore.read(sessionId)
  if (phaseState?.state.phase !== 'assessment') {
    throw new Error('Redis assessment phase state could not be read after the transition')
  }
  if (await worker.processOnce() !== 1) throw new Error('Worker did not persist the assessment phase event')
  const assessmentId = `assessment-${randomBytes(6).toString('hex')}`
  const assessment = await sessionStore.submitAssessment({ tenantId, subjectId }, sessionId, assessmentId, {
    summary: 'Pelvic pain began yesterday.',
    differential: 'Ovarian cyst.',
    rationale: 'The reported onset was acute.',
    plan: 'Evaluate with an appropriate workup.'
  })
  if (typeof assessment !== 'object' || assessment.status !== 'unscored') {
    throw new Error(`Redis assessment submission was not accepted as unscored: ${JSON.stringify(assessment)}`)
  }
  if (await worker.processOnce() !== 2) throw new Error('Worker did not persist assessment submission and terminal events')
  const assessmentHistory = await testPool.query(
    `SELECT event_type, sequence, event_ordinal FROM session_events
     WHERE session_id = $1 ORDER BY sequence, event_ordinal`, [sessionId]
  )
  const assessmentOrder = assessmentHistory.rows.slice(-3).map((row) => `${row.event_type}:${row.sequence}.${row.event_ordinal}`)
  if (assessmentOrder.join(',') !== 'phase_changed:1.2,assessment_submitted:1.3,terminal:2.0') {
    throw new Error('Assessment phase, submission, and terminal events were not durably ordered')
  }

  await redis.sendCommand(['DEL', `gptmd:session:${sessionId}`, `gptmd:patient:${patientProfileId}`, `gptmd:retries:${sessionId}`])
  await sessionStore.ensureLiveState?.({ tenantId, subjectId }, sessionId)
  const recovered = await stateStore.read(sessionId)
  if (recovered?.state.status !== 'completed' || recovered.acceptedTurns[0]?.turnId !== turn.turnId ||
      recovered.terminalEvent?.outcome !== 'completed' || recovered.assessment?.assessmentId !== assessmentId ||
      recovered.acceptedTurns[0]?.patientReportedFacts[0]?.factId !== turn.patientReportedFacts[0].factId ||
      recovered.acceptedTurns[0]?.disclosedFactIds[0] !== turn.patientReportedFacts[0].factId ||
      recovered.profile.history[0]?.field !== 'anyPain') {
    throw new Error('PostgreSQL history did not rebuild the missing Redis state')
  }
  const redisTtl = Number(await redis.sendCommand(['TTL', `gptmd:session:${sessionId}`]))
  if (redisTtl < 1 || redisTtl > 20 * 60) throw new Error('Recovered terminal Redis state has the wrong expiry')

  process.stdout.write(JSON.stringify({
    redisAppendFsync: 'everysec',
    turnRetry: 'saved reply returned; accepted turn and disclosure events emitted atomically',
    transcript: 'ordered learner/patient utterances projected with time, phase, modality, and turn ID',
    workerRetry: 'turn and disclosure persisted once; acknowledged after commit',
    providerUsage: 'patient-turn and scenario-generation token counts, model/tier metadata, versioned public-rate estimates, and duration persisted through the worker',
    turnFailureAudit: 'identifier-only failure metadata persisted through Redis and the PostgreSQL worker',
    assessmentOutcome: 'confirmed phase, unscored submission, and terminal events persisted in order',
    missingStateRecovery: 'rebuilt accepted patient fact, disclosure, assessment, and terminal event from PostgreSQL while preserving the immutable seeded profile',
    terminalRedisTtlSeconds: redisTtl
  }, null, 2) + '\n')
} finally {
  if (sessionId && patientProfileId) {
    const streamRows = await redis.sendCommand(['XRANGE', streamKey, '-', '+'])
    const matchingIds = Array.isArray(streamRows)
      ? streamRows.flatMap((row) => {
          if (!Array.isArray(row) || !Array.isArray(row[1])) return []
          const fields = row[1]
          const fieldIndex = fields.indexOf('event')
          if (fieldIndex < 0 || typeof fields[fieldIndex + 1] !== 'string') return []
          try {
            const event = JSON.parse(fields[fieldIndex + 1])
            return event.sessionId === sessionId ? [String(row[0])] : []
          } catch { return [] }
        })
      : []
    if (matchingIds.length) await redis.sendCommand(['XDEL', streamKey, ...matchingIds])
    await redis.sendCommand(['DEL', `gptmd:session:${sessionId}`, `gptmd:patient:${patientProfileId}`, `gptmd:retries:${sessionId}`])
  }
  await testPool?.end()
  await adminPool.query(`DROP DATABASE IF EXISTS "${temporaryDatabase}"`)
  await adminPool.end()
  await redis.quit()
}
