import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { createServer as createHttpsServer, request as httpsRequest } from 'node:https'
import { createServer as createHttpServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { spawn } from 'node:child_process'
import { createServer as createNetServer } from 'node:net'
import { chromium } from '@playwright/test'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { parseEnv } from 'node:util'
import { createApiApp } from '../services/api/src/app.ts'
import { createRedisPatientStateStore } from '../services/api/src/patient-state-store.ts'
import { createPostgresSessionStore } from '../services/api/src/session-store.ts'
import { createSessionEventWorker } from '../services/api/src/session-event-worker.ts'
import { createSessionIdentityVerificationWorker } from '../services/api/src/session-identity-verification-worker.ts'
import { PATIENT_TURN_SCHEMA_VERSION } from '../services/api/src/session-contracts.ts'
import { makePainEpisode } from '../tests/fixtures/pain-episodes.ts'
import { getE2ECertificate } from './e2e-certificate.mjs'
import {
  PATIENT_SCENARIO_POLICY_VERSION,
  PATIENT_SCENARIO_PROMPT_VERSION,
  PATIENT_SCENARIO_SCHEMA_VERSION
} from '../services/api/src/patient-profile.ts'

const require = createRequire(new URL('../services/api/package.json', import.meta.url))
const { Pool } = require('pg')
const { createClient } = require('redis')

async function getFreePort() {
  const server = createNetServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not reserve an integration-test TCP port')
  const port = address.port
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

async function waitForHttpsServer(port, child) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 30_000) {
    if (child.exitCode !== null) throw new Error(`Nuxt HTTPS integration server exited with status ${child.exitCode}`)
    const ready = await new Promise((resolve) => {
      const request = httpsRequest({ host: 'localhost', port, path: '/', timeout: 1_000, rejectUnauthorized: false }, (response) => {
        response.resume()
        resolve(true)
      })
      request.on('error', () => resolve(false))
      request.on('timeout', () => request.destroy())
      request.end()
    })
    if (ready) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error('Nuxt HTTPS integration server did not become ready within 30 seconds')
}

async function buildNuxtForVerifier() {
  const scriptPath = new URL('./build.mjs', import.meta.url).pathname
  await new Promise((resolve, reject) => {
    const build = spawn(process.execPath, [scriptPath], { stdio: 'inherit', env: process.env })
    build.once('error', reject)
    build.once('exit', (code, signal) => {
      if (code === 0) resolve()
      else reject(new Error(`Nuxt verification build failed (code=${code}, signal=${signal})`))
    })
  })
}

const env = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'))
if (!env.DATABASE_URL || !env.REDIS_URL) throw new Error('DATABASE_URL and REDIS_URL are required')

const apiPort = await getFreePort()
const supabasePort = await getFreePort()
const apiBase = `http://127.0.0.1:${apiPort}`
const supabaseOrigin = `https://localhost:${supabasePort}`
process.env.NUXT_PUBLIC_API_BASE = apiBase
process.env.NUXT_PUBLIC_SUPABASE_URL = supabaseOrigin
process.env.NUXT_PUBLIC_SUPABASE_KEY = 'phase-two-verification-test-key'
await buildNuxtForVerifier()

const redis = createClient({ url: env.REDIS_URL })
redis.on('error', () => undefined)
await redis.connect()
const databaseConfiguration = await redis.sendCommand(['CONFIG', 'GET', 'databases'])
const databaseCount = Number(databaseConfiguration?.databases)
if (!Number.isInteger(databaseCount) || databaseCount < 2) {
  await redis.quit()
  throw new Error('Redis needs at least one empty non-default logical database for isolated local verification')
}
let isolatedRedisDatabase = null
for (let index = 1; index < databaseCount; index += 1) {
  await redis.sendCommand(['SELECT', String(index)])
  const databaseSize = Number(await redis.sendCommand(['DBSIZE']))
  if (databaseSize === 0) {
    isolatedRedisDatabase = index
    break
  }
}
if (isolatedRedisDatabase === null) {
  await redis.quit()
  throw new Error('No empty non-default Redis logical database is available for isolated local verification')
}
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
let apiServer
let jwksServer
let browserServer
let supabaseServer
let browser
let browserSessionId
let browserPatientProfileId
let tenantId
let subjectId

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
    '018_provider_usage_cost_attribution.sql',
    '019_patient_scenario_conversation_cleanup.sql',
    '020_session_identity_binding.sql',
    '021_assessment_drafts.sql',
    '022_session_local_utterances.sql'
  ]) {
    const sql = await readFile(new URL(`../services/api/migrations/${file}`, import.meta.url), 'utf8')
    await testPool.query(sql)
  }
  const cleanupConversationId = `conv-verify-${randomBytes(6).toString('hex')}`
  await testPool.query(
    `INSERT INTO app_patient_scenario_conversation_cleanup (provider_conversation_id)
     SELECT unnest($1::text[])
     ON CONFLICT (provider_conversation_id) DO NOTHING`,
    [[cleanupConversationId]]
  )
  const queuedCleanup = await testPool.query(
    `SELECT provider_conversation_id FROM app_patient_scenario_conversation_cleanup
     WHERE provider_conversation_id = $1`,
    [cleanupConversationId]
  )
  if (queuedCleanup.rows[0]?.provider_conversation_id !== cleanupConversationId) {
    throw new Error('Failed setup Conversation cleanup ID did not persist in PostgreSQL')
  }

  tenantId = `phase2-${randomBytes(6).toString('hex')}`
  subjectId = randomUUID()
  const profile = {
    fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average',
    reasonForVisit: 'Pelvic pain', diagnosis: 'Endometriosis',
    painHistoryStatus: 'present',
    painEpisodes: [makePainEpisode('pain-1', 'pelvic pain')],
    vitalSigns: {
      currentPulse: 76, pulseIrregular: false, pulseQuality: 'normal',
      bpSitting: { systolic: 118, diastolic: 74 }, bpOrthostaticSupine: null,
      respiratoryRate: 16, axillaryTemp: null, oralTemp: 36.8,
      analTemp: null, dermalTemp: null, auralTemp: null
    },
    physicalExamFindings: {
      lungAuscultation: {
        breathSounds: ['normal'], ralesDistribution: null, rhonchiSeverity: 'none',
        effectOfCoughing: 'not_assessed', accessoryMuscleUse: false, postureTolerance: 'tolerates_supine'
      },
      skinLipsSclera: { skin: 'normal', lips: 'pink', sclera: 'white' }, skinBlanche: 1
    },
    history: [{ field: 'patientConcern', status: 'unknown', value: null }],
    currentPregnancyStatus: 'unknown', currentMenopausalStatus: 'unknown',
    patientBeliefs: [], supportedExamFindings: [], supportedTestResults: [],
    persona: {
      mood: 'concerned', maturity: 'adult', verbosity: 'moderate',
      educationLevel: 'college', willingnessToDisclose: 'gradual'
    }
  }
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
  const stateStore = createRedisPatientStateStore(redis)
  const principal = { tenantId, subjectId, role: 'learner' }
  const sessionStore = createPostgresSessionStore(testPool, stateStore)
  const webPort = await getFreePort()
  const upstreamPort = await getFreePort()
  const webOrigin = `https://localhost:${webPort}`
  const testIssuer = `${supabaseOrigin}/auth/v1`
  const testKeyId = 'phase2-verifier-es256-key'
  const { publicKey, privateKey } = await generateKeyPair('ES256')
  const publicJwk = { ...await exportJWK(publicKey), kid: testKeyId, alg: 'ES256', use: 'sig' }
  const jwksPort = await getFreePort()
  const jwksUrl = `http://127.0.0.1:${jwksPort}/auth/v1/.well-known/jwks.json`
  jwksServer = createHttpServer((request, response) => {
    if (request.url !== '/auth/v1/.well-known/jwks.json') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' })
    response.end(JSON.stringify({ keys: [publicJwk] }))
  })
  jwksServer.listen(jwksPort, '127.0.0.1')
  await once(jwksServer, 'listening')
  const tokenIssuedAt = Math.floor(Date.now() / 1000)
  const token = await new SignJWT({
    tenant_id: tenantId, role: 'authenticated', email: 'phase2-browser@example.test'
  })
    .setProtectedHeader({ alg: 'ES256', kid: testKeyId, typ: 'JWT' })
    .setIssuer(testIssuer)
    .setAudience('authenticated')
    .setSubject(subjectId)
    .setIssuedAt(tokenIssuedAt)
    .setExpirationTime(tokenIssuedAt + 3600)
    .sign(privateKey)
  const setupUsage = {
    responseId: `resp-setup-${randomBytes(6).toString('hex')}`,
    model: 'gpt-6-luna', serviceTier: 'default',
    inputTokens: 900, cachedInputTokens: 0, cacheWriteTokens: 0,
    outputTokens: 300, totalTokens: 1200, durationMs: 3420,
    pricingVersion: 'openai-api-pricing-2026-10-06', estimatedCostUsd: '0.000240000000'
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
  let scenarioGenerationCount = 0
  const patientTurnGenerationCounts = new Map()
  const generatedScenarios = new Map()
  apiServer = createApiApp({
    redis: { get isOpen() { return redis.isOpen }, connect: () => redis.connect(), ping: () => redis.ping() },
    postgres: { query: () => testPool.query('SELECT 1') },
    openaiConfigured: true,
    generateResponse: null,
    generatePatientScenario: async (versions, asOf, scenarioSeed) => {
      if (versions.promptVersion !== PATIENT_SCENARIO_PROMPT_VERSION ||
          versions.modelVersion !== 'gpt-6-luna' ||
          versions.schemaVersion !== PATIENT_SCENARIO_SCHEMA_VERSION ||
          versions.policyVersion !== PATIENT_SCENARIO_POLICY_VERSION || !(asOf instanceof Date) ||
          !/^[A-Za-z0-9_-]{43}$/.test(scenarioSeed)) {
        throw new Error('Setup did not pin the current prompt, model, schema, policy, encounter date, and opaque variation seed')
      }
      scenarioGenerationCount += 1
      const setupGeneration = scenarioGenerationCount
      const conversationId = setupGeneration === 1
        ? 'verification-conversation'
        : `verification-conversation-${setupGeneration}`
      const usage = setupGeneration === 1
        ? setupUsage
        : { ...setupUsage, responseId: `${setupUsage.responseId}-${setupGeneration}` }
      generatedScenarios.set(scenarioSeed, { conversationId, usage })
      return {
        profile, conversationId, responseId: usage.responseId,
        usage, abandonedConversationIds: []
      }
    },
    generatePatientTurn: async (context) => {
      if (context.versions.schemaVersion !== PATIENT_TURN_SCHEMA_VERSION ||
          !context.conversationId.startsWith('verification-conversation') ||
          context.learnerMessage !== 'What is your biggest concern?') {
        throw new Error('The patient-turn route did not receive the pinned scenario Conversation and learner question')
      }
      const conversationTurnCount = (patientTurnGenerationCounts.get(context.conversationId) ?? 0) + 1
      patientTurnGenerationCounts.set(context.conversationId, conversationTurnCount)
      const usage = context.conversationId === 'verification-conversation'
        ? patientTurnUsage
        : { ...patientTurnUsage, responseId: `${patientTurnUsage.responseId}-${context.scenarioId}` }
      return {
        responseId: usage.responseId,
        output: {
          patientResponse: 'I am worried about what is causing the pain.',
          proposedFacts: [{ field: 'patientConcern', value: 'I am worried about what is causing the pain.' }],
          historyCoverage: ['patientConcern'],
          disclosedHistoryFields: ['patientConcern'],
          painHistoryCoverage: [],
          painDisclosures: [],
          proposedPainFacts: []
        },
        providerUsage: usage
      }
    },
    createTranscriptionCall: null,
    hangupTranscriptionCall: null,
    model: 'gpt-6-luna',
    jwt: { secret: null, issuer: testIssuer, audience: 'authenticated', jwksUrl },
    sessionStore,
    allowedOrigins: [webOrigin]
  }).listen(apiPort, '127.0.0.1')
  await once(apiServer, 'listening')
  const address = apiServer.address()
  if (!address || typeof address === 'string') throw new Error('Setup verification API did not bind to a TCP port')
  if (address.port !== apiPort) throw new Error('Setup verification API bound to an unexpected port')
  const authHeaders = { authorization: `Bearer ${token}`, 'x-gptmd-tenant-id': tenantId }
  const membershipsResponse = await fetch(`${apiBase}/api/account/tenants`, {
    headers: { authorization: `Bearer ${token}` }
  })
  const memberships = await membershipsResponse.json()
  if (membershipsResponse.status !== 200 ||
      JSON.stringify(memberships.memberships) !== JSON.stringify([{ tenantId, role: 'learner' }])) {
    throw new Error('Supabase-style ES256 authentication could not resolve the active learner tenant membership')
  }
  const forgedToken = `${token.slice(0, token.lastIndexOf('.') + 1)}${randomBytes(32).toString('base64url')}`
  const forgedTokenResponse = await fetch(`${apiBase}/api/account/tenants`, {
    headers: { authorization: `Bearer ${forgedToken}` }
  })
  if (forgedTokenResponse.status !== 401) {
    throw new Error('The real Express API accepted a token with a forged ES256 signature')
  }
  const createdResponse = await fetch(`${apiBase}/api/sessions`, { method: 'POST', headers: authHeaders })
  const createdSession = await createdResponse.json()
  if (createdResponse.status !== 201 || createdSession.status !== 'initializing' ||
      !/^[A-Za-z0-9_-]{43}$/.test(createdSession.sessionId ?? '') ||
      createdSession.versions?.promptVersion !== PATIENT_SCENARIO_PROMPT_VERSION ||
      createdSession.versions?.modelVersion !== 'gpt-6-luna' ||
      createdSession.versions?.schemaVersion !== PATIENT_SCENARIO_SCHEMA_VERSION ||
      createdSession.versions?.policyVersion !== PATIENT_SCENARIO_POLICY_VERSION) {
    throw new Error(`API did not create the authenticated session: ${JSON.stringify(createdSession)}`)
  }
  sessionId = createdSession.sessionId
  const storedIdentity = await testPool.query(
    `SELECT patient_profile_id FROM app_sessions WHERE session_id = $1 AND tenant_id = $2 AND subject_id = $3`,
    [sessionId, tenantId, subjectId]
  )
  patientProfileId = storedIdentity.rows[0]?.patient_profile_id
  if (!patientProfileId) throw new Error('PostgreSQL did not persist the reserved patient-profile ID')

  const setupKey = `verify-setup-${randomBytes(6).toString('hex')}`
  const sendSetup = () => fetch(`${apiBase}/api/sessions/${sessionId}/setup`, {
    method: 'POST', headers: { ...authHeaders, 'idempotency-key': setupKey }
  })
  const setupResponse = await sendSetup()
  const setup = await setupResponse.json()
  if (setupResponse.status !== 200 || setup.status !== 'ready' || setup.sessionId !== sessionId ||
      setup.readiness?.profile !== true || setup.readiness?.redis !== true ||
      setup.readiness?.conversation !== true || setup.patient?.fullName !== profile.fullName ||
      setup.patient?.dateOfBirth !== profile.dateOfBirth || setup.patient?.reasonForVisit !== profile.reasonForVisit ||
      Object.hasOwn(setup.patient ?? {}, 'diagnosis')) {
    throw new Error(`API setup did not return the learner-safe ready profile: ${JSON.stringify(setup)}`)
  }
  const scenarioRow = await testPool.query(
    `SELECT scenario_id, profile_digest, provider_conversation_id, prompt_version,
            model_version, schema_version, policy_version
     FROM patient_scenarios WHERE session_id = $1`, [sessionId]
  )
  const liveSetup = await stateStore.read(sessionId)
  if (scenarioRow.rows.length !== 1 || scenarioRow.rows[0]?.scenario_id !== patientProfileId ||
      scenarioRow.rows[0]?.provider_conversation_id !== 'verification-conversation' ||
      scenarioRow.rows[0]?.prompt_version !== PATIENT_SCENARIO_PROMPT_VERSION ||
      scenarioRow.rows[0]?.model_version !== 'gpt-6-luna' ||
      scenarioRow.rows[0]?.schema_version !== PATIENT_SCENARIO_SCHEMA_VERSION ||
      scenarioRow.rows[0]?.policy_version !== PATIENT_SCENARIO_POLICY_VERSION ||
      liveSetup?.state.status !== 'ready' || liveSetup.patientProfileId !== patientProfileId ||
      liveSetup.conversationId !== 'verification-conversation' ||
      liveSetup.profileDigest !== scenarioRow.rows[0]?.profile_digest ||
      liveSetup.setupProjection.fullName !== profile.fullName) {
    throw new Error('Scenario, Conversation ID, and learner setup projection did not persist across PostgreSQL and Redis')
  }
  const identityRows = await testPool.query(
    `SELECT session_id, tenant_id, subject_id, patient_profile_id, provider_conversation_id,
            scenario_fingerprint, schema_version
     FROM session_identity_binding WHERE session_id = $1`,
    [sessionId]
  )
  const identity = identityRows.rows[0]
  if (identityRows.rows.length !== 1 || identity?.session_id !== sessionId ||
      identity?.tenant_id !== tenantId || identity?.subject_id !== subjectId ||
      identity?.patient_profile_id !== patientProfileId ||
      identity?.provider_conversation_id !== 'verification-conversation' ||
      identity?.scenario_fingerprint !== scenarioRow.rows[0]?.profile_digest ||
      Number(identity?.schema_version) !== PATIENT_SCENARIO_SCHEMA_VERSION) {
    throw new Error('PostgreSQL did not persist the complete immutable session identity and scenario fingerprint')
  }
  const identityWorker = createSessionIdentityVerificationWorker(testPool, stateStore, {
    verificationIntervalSeconds: 900
  })
  const identityMetrics = await identityWorker.verifyOnce()
  const verifiedIdentity = await testPool.query(
    `SELECT last_verification_status FROM session_identity_binding WHERE session_id = $1`, [sessionId]
  )
  if (identityMetrics.checked !== 1 || identityMetrics.verified !== 1 ||
      verifiedIdentity.rows[0]?.last_verification_status !== 'verified') {
    throw new Error('Periodic identity verification did not match the PostgreSQL binding against Redis live state')
  }
  const immutableProfile = await testPool.query(
    `SELECT profile_json->>'diagnosis' AS diagnosis FROM patient_scenarios WHERE session_id = $1`, [sessionId]
  )
  if (immutableProfile.rows[0]?.diagnosis !== profile.diagnosis) {
    throw new Error('Clinician-only diagnosis did not remain in the private immutable scenario')
  }
  const duplicateSetupResponse = await sendSetup()
  const duplicateSetup = await duplicateSetupResponse.json()
  if (duplicateSetupResponse.status !== 200 || JSON.stringify(duplicateSetup) !== JSON.stringify(setup) ||
      scenarioGenerationCount !== 1) {
    throw new Error('Same-key setup retry did not return the stored scenario without regeneration')
  }
  const duplicateIdentityCount = await testPool.query(
    `SELECT count(*)::int AS count FROM session_identity_binding WHERE session_id = $1`, [sessionId]
  )
  if (duplicateIdentityCount.rows[0]?.count !== 1) {
    throw new Error('Same-key setup retry duplicated or lost the immutable session identity binding')
  }
  const readySessionResponse = await fetch(`${apiBase}/api/sessions/${sessionId}`, { headers: authHeaders })
  const readySession = await readySessionResponse.json()
  if (readySessionResponse.status !== 200 || readySession.status !== 'ready' ||
      readySession.sessionId !== sessionId ||
      readySession.versions?.promptVersion !== PATIENT_SCENARIO_PROMPT_VERSION ||
      readySession.versions?.modelVersion !== 'gpt-6-luna' ||
      readySession.versions?.schemaVersion !== PATIENT_SCENARIO_SCHEMA_VERSION ||
      readySession.versions?.policyVersion !== PATIENT_SCENARIO_POLICY_VERSION) {
    throw new Error('Authenticated setup read did not return the stored ready session')
  }
  const currentEncounterResponse = await fetch(`${apiBase}/api/encounters/current`, { headers: authHeaders })
  const currentEncounter = await currentEncounterResponse.json()
  if (currentEncounterResponse.status !== 200 || currentEncounter.encounter?.sessionId !== sessionId ||
      currentEncounter.encounter?.status !== 'ready' ||
      currentEncounter.encounter?.patient?.fullName !== profile.fullName ||
      Object.hasOwn(currentEncounter.encounter ?? {}, 'conversationId') ||
      Object.hasOwn(currentEncounter.encounter?.patient ?? {}, 'diagnosis')) {
    throw new Error('Owner-scoped current-encounter lookup did not resume the learner-safe ready session')
  }
  const ownerIndexKey = `gptmd:owner-session:${createHash('sha256').update(`${tenantId}\0${subjectId}`).digest('hex')}`
  await redis.sendCommand(['DEL', `gptmd:session:${sessionId}`, `gptmd:patient:${patientProfileId}`, `gptmd:retries:${sessionId}`, ownerIndexKey])
  const resumedAfterLossResponse = await fetch(`${apiBase}/api/encounters/current`, { headers: authHeaders })
  const resumedAfterLoss = await resumedAfterLossResponse.json()
  const restoredLiveState = await stateStore.read(sessionId)
  if (resumedAfterLossResponse.status !== 200 || resumedAfterLoss.encounter?.sessionId !== sessionId ||
      resumedAfterLoss.encounter?.status !== 'ready' ||
      restoredLiveState?.patientProfileId !== patientProfileId ||
      restoredLiveState?.conversationId !== 'verification-conversation' ||
      restoredLiveState?.profileDigest !== scenarioRow.rows[0]?.profile_digest) {
    throw new Error('Current-encounter resume did not rebuild the same Redis session identity from PostgreSQL')
  }
  const worker = createSessionEventWorker(redis, testPool, { consumerName: `verify-${process.pid}`, blockMs: 1 })
  await worker.ensureGroup()
  const setupUsageEvents = await worker.processOnce()
  if (setupUsageEvents !== 1) {
    const streamLength = await redis.sendCommand(['XLEN', streamKey])
    throw new Error(`Setup provider-usage event was not persisted exactly once: processed=${setupUsageEvents}, streamLength=${streamLength}`)
  }
  const durableSetupUsage = await testPool.query(
    `SELECT operation, provider_response_id, input_tokens, output_tokens
     FROM provider_usage WHERE session_id = $1 AND provider_response_id = $2`,
    [sessionId, setupUsage.responseId]
  )
  if (durableSetupUsage.rows.length !== 1 ||
      durableSetupUsage.rows[0]?.operation !== 'scenario_generation' ||
      Number(durableSetupUsage.rows[0]?.input_tokens) !== setupUsage.inputTokens ||
      Number(durableSetupUsage.rows[0]?.output_tokens) !== setupUsage.outputTokens) {
    throw new Error('Scenario-generation usage did not persist from setup through Redis and the PostgreSQL worker')
  }
  const turnId = `turn-${randomBytes(6).toString('hex')}`
  const learnerMessage = 'What is your biggest concern?'
  const submitTurn = (text = learnerMessage) => fetch(`${apiBase}/api/sessions/${sessionId}/turns`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ turnId, text, modality: 'realtime_transcription' })
  })
  const acceptedTurnResponse = await submitTurn()
  const acceptedTurnResult = await acceptedTurnResponse.json()
  if (acceptedTurnResponse.status !== 200 || acceptedTurnResult.turnId !== turnId ||
      acceptedTurnResult.text !== 'I am worried about what is causing the pain.') {
    throw new Error(`Authenticated Express turn route returned status ${acceptedTurnResponse.status}: ${JSON.stringify(acceptedTurnResult)}`)
  }
  const duplicateTurnResponse = await submitTurn()
  const duplicateTurnResult = await duplicateTurnResponse.json()
  if (duplicateTurnResponse.status !== 200 || JSON.stringify(duplicateTurnResult) !== JSON.stringify(acceptedTurnResult) ||
      patientTurnGenerationCounts.get('verification-conversation') !== 1) {
    throw new Error('Retrying the same API turn did not return its saved reply without regenerating it')
  }
  const conflictingTurnResponse = await submitTurn('Tell me something different.')
  if (conflictingTurnResponse.status !== 409 || patientTurnGenerationCounts.get('verification-conversation') !== 1) {
    throw new Error('Reusing an API turn ID with different learner input was not rejected before generation')
  }
  const live = await stateStore.read(sessionId)
  const turn = live?.acceptedTurns[0]
  if (!turn || live.acceptedTurns.length !== 1 || live.state.currentTurnSequence !== 1 ||
      turn.learnerMessage !== learnerMessage || turn.disclosedHistoryFields[0] !== 'patientConcern') {
    throw new Error('Authenticated API turn did not update Redis state and disclose the asked patient fact exactly once')
  }

  if (await worker.processOnce() !== 2) throw new Error('Event worker did not persist the accepted turn and disclosure events')
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
  const localUtteranceId = randomUUID()
  const localUtteranceRequest = {
    utteranceId: localUtteranceId, kind: 'repair', speaker: 'learner', content: 'Could you repeat that?'
  }
  const saveLocalUtterance = () => fetch(`${apiBase}/api/sessions/${sessionId}/local-utterances`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify(localUtteranceRequest)
  })
  const savedLocalUtteranceResponse = await saveLocalUtterance()
  const savedLocalUtterance = await savedLocalUtteranceResponse.json()
  if (savedLocalUtteranceResponse.status !== 200 || savedLocalUtterance.utteranceId !== localUtteranceId ||
      savedLocalUtterance.sequence !== 1 || savedLocalUtterance.ordinal !== 1 ||
      savedLocalUtterance.phase !== 'history' || savedLocalUtterance.modality !== 'realtime_transcription') {
    throw new Error('Owner-scoped local voice repair was not recorded with its live turn order and transcript metadata')
  }
  const duplicateLocalUtteranceResponse = await saveLocalUtterance()
  const duplicateLocalUtterance = await duplicateLocalUtteranceResponse.json()
  if (duplicateLocalUtteranceResponse.status !== 200 ||
      JSON.stringify(duplicateLocalUtterance) !== JSON.stringify(savedLocalUtterance)) {
    throw new Error('Retrying a local voice utterance did not return the same durable record')
  }
  const conflictLocalUtteranceResponse = await fetch(`${apiBase}/api/sessions/${sessionId}/local-utterances`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ ...localUtteranceRequest, content: 'Please repeat that.' })
  })
  if (conflictLocalUtteranceResponse.status !== 409) {
    throw new Error('Reusing a local utterance ID with different content was not rejected')
  }
  const transcriptWithLocalUtterance = await testPool.query(
    `SELECT turn_id, sequence, utterance_index, speaker, phase, modality, content
     FROM session_transcript WHERE session_id = $1 ORDER BY sequence, utterance_index`, [sessionId]
  )
  const restoredWithLocalUtterance = await sessionStore.getCurrentOwnedEncounter(principal)
  if (transcriptWithLocalUtterance.rows.length !== 3 ||
      transcriptWithLocalUtterance.rows[2]?.turn_id !== localUtteranceId ||
      Number(transcriptWithLocalUtterance.rows[2]?.utterance_index) !== 3 ||
      transcriptWithLocalUtterance.rows[2]?.content !== localUtteranceRequest.content ||
      restoredWithLocalUtterance?.localUtterances[0]?.utteranceId !== localUtteranceId) {
    throw new Error('The durable transcript or owner restore omitted the local voice utterance')
  }
  await redis.sendCommand(['DEL', `gptmd:session:${sessionId}`, `gptmd:patient:${patientProfileId}`, `gptmd:retries:${sessionId}`])
  const localUtteranceRecoveryResponse = await fetch(`${apiBase}/api/encounters/current`, { headers: authHeaders })
  const localUtteranceRecovery = await localUtteranceRecoveryResponse.json()
  if (localUtteranceRecoveryResponse.status !== 200 ||
      localUtteranceRecovery.encounter?.localUtterances?.[0]?.utteranceId !== localUtteranceId) {
    throw new Error('Current-encounter recovery did not restore the local voice utterance from PostgreSQL')
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

  if (await sessionStore.beginAssessment(principal, sessionId) !== 'assessment') {
    throw new Error('Redis assessment phase transition was not accepted')
  }
  const phaseState = await stateStore.read(sessionId)
  if (phaseState?.state.phase !== 'assessment') {
    throw new Error('Redis assessment phase state could not be read after the transition')
  }
  const draftFields = {
    summary: 'Pelvic pain began yesterday.',
    differential: '',
    rationale: 'The onset is acute.',
    plan: ''
  }
  const saveDraft = (revision, fields) => fetch(`${apiBase}/api/sessions/${sessionId}/assessment-draft`, {
    method: 'PUT',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ revision, ...fields })
  })
  const savedDraftResponse = await saveDraft(1, draftFields)
  const savedDraft = await savedDraftResponse.json()
  if (savedDraftResponse.status !== 200 || savedDraft.revision !== 1 ||
      savedDraft.fields.summary !== draftFields.summary || savedDraft.fields.differential !== '') {
    throw new Error('An incomplete assessment draft was not saved with its revision')
  }
  const latestDraftFields = { ...draftFields, plan: 'Assess further.' }
  const updatedDraftResponse = await saveDraft(2, latestDraftFields)
  const updatedDraft = await updatedDraftResponse.json()
  if (updatedDraftResponse.status !== 200 || updatedDraft.revision !== 2 || updatedDraft.fields.plan !== latestDraftFields.plan) {
    throw new Error('A newer assessment draft revision did not replace the earlier draft')
  }
  const staleDraftResponse = await saveDraft(1, draftFields)
  const staleDraft = await staleDraftResponse.json()
  if (staleDraftResponse.status !== 200 || staleDraft.revision !== 2 || staleDraft.fields.plan !== latestDraftFields.plan) {
    throw new Error('A late stale assessment draft overwrote the newest revision')
  }
  const restoredDraft = await sessionStore.getCurrentOwnedEncounter(principal)
  if (restoredDraft?.assessmentDraft?.revision !== 2 ||
      restoredDraft.assessmentDraft.fields.plan !== latestDraftFields.plan ||
      restoredDraft.assessment !== null) {
    throw new Error('Owner-scoped encounter recovery did not restore its unsubmitted assessment draft')
  }
  const durableDraft = await testPool.query(
    `SELECT revision, fields FROM app_assessment_drafts WHERE session_id = $1 AND tenant_id = $2 AND subject_id = $3`,
    [sessionId, tenantId, subjectId]
  )
  if (Number(durableDraft.rows[0]?.revision) !== 2 || durableDraft.rows[0]?.fields?.plan !== latestDraftFields.plan) {
    throw new Error('The assessment draft revision was not durably saved in its owner-scoped row')
  }
  if (await worker.processOnce() !== 1) throw new Error('Worker did not persist the assessment phase event')
  const assessmentId = `assessment-${randomBytes(6).toString('hex')}`
  const assessment = await sessionStore.submitAssessment(principal, sessionId, assessmentId, {
    summary: 'Pelvic pain began yesterday.',
    differential: 'Ovarian cyst.',
    rationale: 'The reported onset was acute.',
    plan: 'Evaluate with an appropriate workup.'
  })
  if (typeof assessment !== 'object' || assessment.status !== 'unscored') {
    throw new Error(`Redis assessment submission was not accepted as unscored: ${JSON.stringify(assessment)}`)
  }
  const retainedDraftsAfterSubmit = await testPool.query(
    `SELECT count(*)::int AS count FROM app_assessment_drafts WHERE session_id = $1`, [sessionId]
  )
  if (retainedDraftsAfterSubmit.rows[0]?.count !== 0) {
    throw new Error('The submitted assessment draft was not removed after its final submission was committed')
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
  await sessionStore.ensureLiveState?.(principal, sessionId)
  const recovered = await stateStore.read(sessionId)
  if (recovered?.state.status !== 'completed' || recovered.acceptedTurns[0]?.turnId !== turn.turnId ||
      recovered.terminalEvent?.outcome !== 'completed' || recovered.assessment?.assessmentId !== assessmentId ||
      recovered.acceptedTurns[0]?.patientReportedFacts[0]?.factId !== turn.patientReportedFacts[0].factId ||
      recovered.acceptedTurns[0]?.disclosedFactIds[0] !== turn.patientReportedFacts[0].factId ||
      recovered.profile.history[0]?.field !== 'patientConcern' ||
      recovered.profile.painEpisodes[0]?.patientDescription !== 'pelvic pain') {
    throw new Error('PostgreSQL history did not rebuild the missing Redis state')
  }
  const redisTtl = Number(await redis.sendCommand(['TTL', `gptmd:session:${sessionId}`]))
  if (redisTtl < 1 || redisTtl > 20 * 60) throw new Error('Recovered terminal Redis state has the wrong expiry')

  const { key, cert } = getE2ECertificate()
  const supabaseUser = {
    id: subjectId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'phase2-browser@example.test',
    app_metadata: { provider: 'google', providers: ['google'] },
    user_metadata: { full_name: 'Phase Two Browser Learner' },
    created_at: '2026-01-01T00:00:00.000Z'
  }
  const supabaseRequests = []
  supabaseServer = createHttpsServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request, response) => {
    supabaseRequests.push(`${request.method} ${request.url}`)
    response.setHeader('access-control-allow-origin', webOrigin)
    response.setHeader('access-control-allow-credentials', 'true')
    response.setHeader('access-control-allow-headers',
      request.headers['access-control-request-headers'] ?? 'apikey, authorization, x-client-info, content-type')
    response.setHeader('access-control-allow-methods', 'GET, OPTIONS')
    response.setHeader('vary', 'Origin')
    if (request.method === 'OPTIONS') {
      response.writeHead(204)
      response.end()
      return
    }
    if (request.url === '/auth/v1/.well-known/jwks.json') {
      response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'public, max-age=60' })
      response.end(JSON.stringify({ keys: [publicJwk] }))
      return
    }
    if (request.url?.startsWith('/auth/v1/user')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(supabaseUser))
      return
    }
    response.writeHead(404)
    response.end()
  })
  supabaseServer.listen(supabasePort, '0.0.0.0')
  await once(supabaseServer, 'listening')

  browserServer = spawn(process.execPath, [
    new URL('./playwright-https-server.mjs', import.meta.url).pathname,
    String(webPort), String(upstreamPort)
  ], {
    env: {
      ...process.env,
      NUXT_PUBLIC_API_BASE: apiBase,
      NUXT_PUBLIC_SUPABASE_URL: supabaseOrigin,
      NUXT_PUBLIC_SUPABASE_KEY: 'phase-two-verification-test-key',
      NODE_EXTRA_CA_CERTS: cert
    },
    stdio: 'inherit'
  })
  await waitForHttpsServer(webPort, browserServer)
  browser = await chromium.launch({ headless: true })
  const browserContext = await browser.newContext({ ignoreHTTPSErrors: true })
  const encodeAuthCookieValue = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const authCookieValue = `base64-${encodeAuthCookieValue({
    access_token: token,
    refresh_token: `phase2-browser-${randomBytes(6).toString('hex')}`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: tokenIssuedAt + 3600
  })}`
  await browserContext.addCookies([{
    name: 'sb-localhost-auth-token', value: authCookieValue, url: webOrigin, sameSite: 'Lax', secure: true
  }])
  if (!(await browserContext.cookies(webOrigin)).some((cookie) => cookie.name === 'sb-localhost-auth-token')) {
    throw new Error('Could not install the Supabase auth cookie in the signed-in browser context')
  }
  const page = await browserContext.newPage()
  const browserApiErrors = []
  const browserApiRequests = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/api/')) browserApiRequests.push(`${request.method()} ${url.pathname}`)
  })
  page.on('response', (response) => {
    const url = new URL(response.url())
    if (url.pathname.startsWith('/api/') && response.status() >= 400) {
      browserApiErrors.push(`${response.request().method()} ${url.pathname}: ${response.status()}`)
    }
  })
  await page.goto(`${webOrigin}/`)
  await page.getByRole('heading', { name: 'Your practice space' }).waitFor({ state: 'visible' })
  await page.getByRole('heading', { name: 'phase2-browser@example.test' }).waitFor({ state: 'visible' })
  await page.getByText('Workspace access is ready.', { exact: true }).waitFor({ state: 'visible' })
  const sessionCreatedResponse = page.waitForResponse((response) =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/sessions')
  await page.getByRole('link', { name: 'Begin Visit' }).first().click()
  let createdInBrowser
  try {
    createdInBrowser = await sessionCreatedResponse
  } catch (error) {
    const pageText = await page.locator('body').innerText().catch(() => '')
    const publicConfig = await page.evaluate(() => window.__NUXT__?.config?.public).catch(() => null)
    throw new Error(`Browser did not create a session. URL=${page.url()} API requests=${JSON.stringify(browserApiRequests)} API errors=${JSON.stringify(browserApiErrors)} Supabase requests=${JSON.stringify(supabaseRequests)} Public config=${JSON.stringify(publicConfig)} Page=${pageText.slice(0, 1200)}`, { cause: error })
  }
  const createdInBrowserBody = await createdInBrowser.json()
  browserSessionId = createdInBrowserBody.sessionId
  if (createdInBrowser.status() !== 201 || !/^[A-Za-z0-9_-]{43}$/.test(browserSessionId ?? '')) {
    throw new Error('The signed-in browser did not create its opaque encounter through the real API')
  }
  const preflight = page.getByRole('dialog', { name: 'Before you begin' })
  await preflight.waitFor({ state: 'visible' })
  await preflight.getByRole('radio', { name: /Transcript/ }).check()
  await preflight.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await preflight.getByRole('button', { name: 'Continue with transcript' }).click()
  await page.getByRole('button', { name: 'Enter Room' }).waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Enter Room' }).click()
  const chartTab = page.getByRole('tab', { name: 'Chart' })
  if (await chartTab.getAttribute('aria-selected') !== 'true') {
    throw new Error('The browser did not open the learner chart as the default Enter Room panel')
  }
  const chart = page.getByRole('tabpanel', { name: 'Chart' })
  await chart.getByText('Ari Nguyen').waitFor({ state: 'visible' })
  await chart.getByText('Pelvic pain').waitFor({ state: 'visible' })
  await chart.getByTestId('chart-current-pulse').waitFor({ state: 'visible' })
  if (await chart.getByText('average', { exact: true }).count()) {
    throw new Error('Internal portrait body type leaked into the learner-facing chart')
  }
  const portrait = page.locator('.profile-image-wrap img')
  await portrait.waitFor({ state: 'visible' })
  await page.waitForFunction(() => {
    const image = document.querySelector('.profile-image-wrap img')
    return image instanceof HTMLImageElement && image.naturalWidth > 0
  })
  await page.getByRole('tab', { name: 'Interview' }).click()
  await page.getByLabel('Your next question').fill('What is your biggest concern?')
  await page.getByRole('button', { name: 'Send question' }).click()
  await page.getByText('I am worried about what is causing the pain.', { exact: true }).waitFor({ state: 'visible' })
  if (browserApiErrors.length) throw new Error(`Browser encounter API requests failed: ${browserApiErrors.join('; ')}`)
  if (scenarioGenerationCount !== 2 ||
      patientTurnGenerationCounts.get('verification-conversation-2') !== 1) {
    throw new Error('Browser setup/turn did not reach the deterministic scenario and patient-turn generators exactly once')
  }
  const browserEncounterResponse = await fetch(`${apiBase}/api/encounters/current`, { headers: authHeaders })
  const browserEncounterBody = await browserEncounterResponse.json()
  if (browserEncounterResponse.status !== 200 || browserEncounterBody.encounter?.sessionId !== browserSessionId ||
      browserEncounterBody.encounter?.status !== 'active' || browserEncounterBody.encounter?.transcript?.length !== 1 ||
      browserEncounterBody.encounter?.transcript?.[0]?.patientResponse !== 'I am worried about what is causing the pain.') {
    throw new Error('The browser-created encounter turn did not return through owner-scoped API recovery')
  }
  const browserScenarioRow = await testPool.query(
    'SELECT scenario_id FROM patient_scenarios WHERE session_id = $1', [browserSessionId]
  )
  browserPatientProfileId = browserScenarioRow.rows[0]?.scenario_id
  if (typeof browserPatientProfileId !== 'string') throw new Error('Browser-created scenario was not stored in PostgreSQL')
  if (await worker.processOnce() !== 3) throw new Error('Browser setup and patient-turn usage/events were not handed to the PostgreSQL worker')
  const browserUsage = await testPool.query(
    'SELECT operation FROM provider_usage WHERE session_id = $1 ORDER BY operation', [browserSessionId]
  )
  if (browserUsage.rows.map((row) => row.operation).join(',') !== 'patient_turn,scenario_generation') {
    throw new Error('Browser-created setup and patient-turn provider usage did not persist through the worker')
  }

  process.stdout.write(JSON.stringify({
    isolatedRedisDatabase,
    redisAppendFsync: 'everysec',
    setup: 'real Express routes authorized a learner, created PostgreSQL session IDs, generated one deterministic fictional case, returned only learner-safe fields, stored and idempotently verified the complete session identity binding, and reused the committed scenario on same-key retry',
    sessionResume: 'owner-scoped current-encounter lookup resumed the same ready session and rebuilt the same Redis identity from PostgreSQL after deleting Redis session, profile, retry, and owner-index keys',
    turnRetry: 'saved reply returned; accepted turn and disclosure events emitted atomically',
    transcript: 'ordered learner/patient utterances and append-only voice repair projected with time, phase, modality, and stable IDs; same-ID retries are idempotent and conflicting retries are rejected',
    workerRetry: 'turn and disclosure persisted once; acknowledged after commit',
    providerUsage: 'patient-turn and scenario-generation token counts, model/tier metadata, versioned public-rate estimates, and duration persisted through the worker',
    turnFailureAudit: 'identifier-only failure metadata persisted through Redis and the PostgreSQL worker',
    assessmentOutcome: 'confirmed phase, unscored submission, and terminal events persisted in order',
    assessmentDraft: 'partial assessment fields survive owner-scoped restore; monotonically increasing revisions reject late stale saves',
    missingStateRecovery: 'rebuilt accepted patient fact, disclosure, assessment, and terminal event from PostgreSQL while preserving the immutable seeded profile',
    browserSessionLoop: 'signed-in Nuxt browser displayed the authenticated account and active workspace access, created and set up a patient through real Express/PostgreSQL/Redis, entered with Chart selected, submitted a transcript question, restored the accepted reply through the owner route, and persisted provider usage through the worker',
    terminalRedisTtlSeconds: redisTtl
  }, null, 2) + '\n')
} finally {
  if (browser) await browser.close()
  if (browserServer && browserServer.exitCode === null) {
    browserServer.kill('SIGTERM')
    const killTimer = setTimeout(() => browserServer.kill('SIGKILL'), 3_000)
    await once(browserServer, 'exit')
    clearTimeout(killTimer)
  }
  if (supabaseServer) {
    await new Promise((resolve, reject) => supabaseServer.close((error) => error ? reject(error) : resolve()))
  }
  if (jwksServer) {
    await new Promise((resolve, reject) => jwksServer.close((error) => error ? reject(error) : resolve()))
  }
  if (apiServer) {
    await new Promise((resolve, reject) => apiServer.close((error) => error ? reject(error) : resolve()))
  }
  const sessionIdsToClean = [sessionId, browserSessionId].filter((id) => typeof id === 'string')
  if (sessionIdsToClean.length) {
    const streamRows = await redis.sendCommand(['XRANGE', streamKey, '-', '+'])
    const matchingIds = Array.isArray(streamRows)
      ? streamRows.flatMap((row) => {
          if (!Array.isArray(row) || !Array.isArray(row[1])) return []
          const fields = row[1]
          const fieldIndex = fields.indexOf('event')
          if (fieldIndex < 0 || typeof fields[fieldIndex + 1] !== 'string') return []
          try {
            const event = JSON.parse(fields[fieldIndex + 1])
            return sessionIdsToClean.includes(event.sessionId) ? [String(row[0])] : []
          } catch { return [] }
        })
      : []
    if (matchingIds.length) await redis.sendCommand(['XDEL', streamKey, ...matchingIds])
    const redisKeys = sessionIdsToClean.flatMap((id) => [`gptmd:session:${id}`, `gptmd:retries:${id}`])
    for (const profileId of [patientProfileId, browserPatientProfileId]) {
      if (profileId) redisKeys.push(`gptmd:patient:${profileId}`)
    }
    const ownerIndexKey = `gptmd:owner-session:${createHash('sha256').update(`${tenantId}\0${subjectId}`).digest('hex')}`
    await redis.sendCommand(['DEL', ...redisKeys, ownerIndexKey, streamKey])
  }
  await testPool?.end()
  await adminPool.query(`DROP DATABASE IF EXISTS "${temporaryDatabase}"`)
  await adminPool.end()
  await redis.quit()
}
