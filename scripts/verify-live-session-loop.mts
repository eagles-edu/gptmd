import { createHmac, randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { parseEnv } from 'node:util'
import { createApiApp } from '../services/api/src/app.ts'
import { createServiceClients } from '../services/api/src/clients.ts'
import { deletePatientSetupConversation } from '../services/api/src/patient-profile.ts'
import { createRedisPatientStateStore } from '../services/api/src/patient-state-store.ts'
import { createSessionEventWorker } from '../services/api/src/session-event-worker.ts'

if (!process.argv.includes('--run-live')) {
  throw new Error('This command makes billable OpenAI setup and turn requests. Re-run with --run-live to confirm execution.')
}

const require = createRequire(new URL('../services/api/package.json', import.meta.url))
const { Pool } = require('pg') as typeof import('pg')
const { createClient } = require('redis') as typeof import('redis')
const OpenAI = (require('openai') as typeof import('openai')).default
const env = parseEnv(await readFile(new URL('../.env', import.meta.url), 'utf8'))
if (!env.DATABASE_URL || !env.REDIS_URL || !env.OPENAI_API_KEY) {
  throw new Error('DATABASE_URL, REDIS_URL, and OPENAI_API_KEY must be configured in .env.')
}

const databaseUrl = new URL(env.DATABASE_URL)
const redisUrl = new URL(env.REDIS_URL)
const localHosts = new Set(['localhost', '127.0.0.1', '::1'])
if (!localHosts.has(databaseUrl.hostname) || !localHosts.has(redisUrl.hostname)) {
  throw new Error('Live session verification only runs against loopback PostgreSQL and Redis URLs.')
}

const temporaryDatabase = `gptmd_live_setup_${randomBytes(6).toString('hex')}`
const adminPool = new Pool({ connectionString: databaseUrl.toString(), max: 1 })
const temporaryDatabaseUrl = new URL(databaseUrl)
temporaryDatabaseUrl.pathname = `/${temporaryDatabase}`
let testPool: InstanceType<typeof Pool> | undefined
let serviceClients: ReturnType<typeof createServiceClients> | undefined
let workerRedis: ReturnType<typeof createClient> | undefined
let apiServer: ReturnType<ReturnType<typeof createApiApp>['listen']> | undefined
let temporaryRedisDatabase: number | undefined
let preserveTemporaryDatabase = false
let sessionId: string | undefined
let conversationId: string | undefined
let providerCleanupFailures = 0
let currentStep = 'prepare isolated PostgreSQL and Redis'

const baseRedis = createClient({ url: redisUrl.toString() })
baseRedis.on('error', () => undefined)
await baseRedis.connect()
try {
  const streamLength = Number(await baseRedis.sendCommand(['XLEN', 'gptmd:session-events']))
  if (streamLength !== 0) throw new Error('Refusing verification because the shared Redis event stream is not empty.')
  const databaseConfig = await baseRedis.sendCommand(['CONFIG', 'GET', 'databases']) as { databases?: string }
  const databaseCount = Number(databaseConfig.databases)
  for (let index = 1; index < databaseCount; index += 1) {
    await baseRedis.sendCommand(['SELECT', String(index)])
    if (Number(await baseRedis.sendCommand(['DBSIZE'])) === 0) {
      temporaryRedisDatabase = index
      break
    }
  }
  if (temporaryRedisDatabase === undefined) {
    throw new Error('No empty non-default Redis database is available for isolated live verification.')
  }
} finally {
  await baseRedis.quit()
}

const isolatedRedisUrl = new URL(redisUrl)
isolatedRedisUrl.pathname = `/${temporaryRedisDatabase}`
const verificationSecret = randomBytes(32).toString('hex')
const tenantId = `live-verify-${randomBytes(6).toString('hex')}`
const subjectId = `live-verify-${randomBytes(6).toString('hex')}`
const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
const tokenHeader = encode({ alg: 'HS256', typ: 'JWT' })
const tokenClaims = encode({
  sub: subjectId,
  tenant_id: tenantId,
  iss: 'https://gptmd.local.live-verify',
  aud: 'gptmd-api',
  exp: Math.floor(Date.now() / 1000) + 600
})
const token = `${tokenHeader}.${tokenClaims}.${createHmac('sha256', verificationSecret)
  .update(`${tokenHeader}.${tokenClaims}`).digest('base64url')}`
const authHeaders = { authorization: `Bearer ${token}`, 'x-gptmd-tenant-id': tenantId }
const verificationSummary: Record<string, unknown> = {}

try {
  currentStep = 'create isolated database and apply migrations'
  await adminPool.query(`CREATE DATABASE "${temporaryDatabase}"`)
  testPool = new Pool({ connectionString: temporaryDatabaseUrl.toString(), max: 3 }) as InstanceType<typeof Pool>
  const migrationNames = (await readdir(new URL('../services/api/migrations/', import.meta.url)))
    .filter((name) => /^\d{3}_.+\.sql$/.test(name))
    .sort()
  for (const migrationName of migrationNames) {
    const migration = await readFile(new URL(`../services/api/migrations/${migrationName}`, import.meta.url), 'utf8')
    await testPool.query(migration)
  }

  const testEnv = {
    ...env,
    DATABASE_URL: temporaryDatabaseUrl.toString(),
    REDIS_URL: isolatedRedisUrl.toString(),
    API_AUTH_JWT_SECRET: verificationSecret,
    API_AUTH_JWT_ISSUER: 'https://gptmd.local.live-verify',
    API_AUTH_JWT_AUDIENCE: 'gptmd-api'
  }
  currentStep = 'connect the real API clients to isolated storage'
  serviceClients = createServiceClients(testEnv)
  if (!serviceClients.dependencies.openaiConfigured || !serviceClients.dependencies.sessionStore) {
    throw new Error('The real OpenAI provider or PostgreSQL/Redis session store is not configured.')
  }
  await serviceClients.dependencies.redis?.connect()
  workerRedis = createClient({ url: isolatedRedisUrl.toString() })
  workerRedis.on('error', () => undefined)
  await workerRedis.connect()

  currentStep = 'seed temporary learner membership and entitlements'
  await testPool.query('INSERT INTO tenants (tenant_id) VALUES ($1)', [tenantId])
  await testPool.query(
    `INSERT INTO tenant_entitlements (tenant_id, sessions_enabled, responses_enabled)
     VALUES ($1, true, true)`,
    [tenantId]
  )
  await testPool.query(
    `INSERT INTO tenant_memberships (tenant_id, subject_id, status, role)
     VALUES ($1, $2, 'active', 'learner')`,
    [tenantId, subjectId]
  )

  currentStep = 'start the real Express API'
  apiServer = createApiApp(serviceClients.dependencies).listen(0, '127.0.0.1')
  await once(apiServer, 'listening')
  const address = apiServer.address()
  if (!address || typeof address === 'string') throw new Error('Live verification API did not bind to a TCP port.')
  const apiBase = `http://127.0.0.1:${address.port}`

  currentStep = 'reserve an authenticated session'
  const createdResponse = await fetch(`${apiBase}/api/sessions`, { method: 'POST', headers: authHeaders })
  const created = await createdResponse.json() as { sessionId?: string; status?: string }
  if (createdResponse.status !== 201 || created.status !== 'initializing' || !created.sessionId) {
    throw new Error(`Live API could not reserve a session (HTTP ${createdResponse.status}).`)
  }
  sessionId = created.sessionId

  currentStep = 'generate and verify the live patient setup'
  const setupResponse = await fetch(`${apiBase}/api/sessions/${sessionId}/setup`, {
    method: 'POST',
    headers: { ...authHeaders, 'idempotency-key': `scenario-setup-${sessionId}` }
  })
  const setup = await setupResponse.json() as {
    sessionId?: string
    status?: string
    patient?: Record<string, unknown>
    readiness?: { profile?: boolean; redis?: boolean; conversation?: boolean }
  }
  if (setupResponse.status !== 200 || setup.status !== 'ready' || setup.sessionId !== sessionId ||
      setup.readiness?.profile !== true || setup.readiness.redis !== true ||
      setup.readiness.conversation !== true || !setup.patient || Object.hasOwn(setup.patient, 'diagnosis')) {
    throw new Error(`Live API setup failed learner-safe readiness validation (HTTP ${setupResponse.status}).`)
  }
  const binding = await testPool.query<{ provider_conversation_id: string; scenario_fingerprint: string }>(
    `SELECT provider_conversation_id, scenario_fingerprint
     FROM session_identity_binding WHERE session_id = $1`,
    [sessionId]
  )
  conversationId = binding.rows[0]?.provider_conversation_id
  if (!conversationId || !binding.rows[0]?.scenario_fingerprint) {
    throw new Error('Live scenario setup did not persist its provider Conversation and scenario fingerprint.')
  }

  const redisState = createRedisPatientStateStore(workerRedis)
  const readyState = await redisState.read(sessionId)
  if (readyState?.state.status !== 'ready' || readyState.conversationId !== conversationId ||
      readyState.profileDigest !== binding.rows[0]?.scenario_fingerprint) {
    throw new Error('Live setup did not persist the same scenario and Conversation in RedisJSON.')
  }
  currentStep = 'read the ready encounter through owner-scoped lookup'
  const currentBeforeTurnResponse = await fetch(`${apiBase}/api/encounters/current`, { headers: authHeaders })
  const currentBeforeTurn = await currentBeforeTurnResponse.json() as {
    encounter?: { sessionId?: string; patient?: Record<string, unknown>; transcript?: unknown[]; conversationId?: string | null }
  }
  if (currentBeforeTurnResponse.status !== 200 || currentBeforeTurn.encounter?.sessionId !== sessionId ||
      currentBeforeTurn.encounter.transcript?.length !== 0 ||
      Object.hasOwn(currentBeforeTurn.encounter, 'conversationId')) {
    throw new Error('The owner-scoped current-encounter route did not return the ready learner-safe scenario.')
  }

  const turnId = `live-${randomBytes(8).toString('hex')}`
  currentStep = 'submit the first live patient turn'
  const turnResponse = await fetch(`${apiBase}/api/sessions/${sessionId}/turns`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ turnId, text: 'Could you tell me what brought you in today?', modality: 'typed' })
  })
  const turn = await turnResponse.json() as { turnId?: string; text?: string }
  if (turnResponse.status !== 200 || turn.turnId !== turnId || !turn.text?.trim()) {
    throw new Error(`Live patient turn failed serialized API validation (HTTP ${turnResponse.status}).`)
  }
  currentStep = 'restore the accepted turn through the same encounter'
  const currentAfterTurnResponse = await fetch(`${apiBase}/api/encounters/current`, { headers: authHeaders })
  const currentAfterTurn = await currentAfterTurnResponse.json() as {
    encounter?: { sessionId?: string; status?: string; transcript?: Array<{ learnerMessage: string; patientResponse: string }> }
  }
  const resumedTurn = currentAfterTurn.encounter?.transcript?.[0]
  verificationSummary.currentEncounterRestoreChecks = {
    httpOk: currentAfterTurnResponse.status === 200,
    sameSession: currentAfterTurn.encounter?.sessionId === sessionId,
    activeStatus: currentAfterTurn.encounter?.status === 'active',
    oneTranscriptTurn: currentAfterTurn.encounter?.transcript?.length === 1,
    turnTextMatches: resumedTurn?.learnerMessage === 'Could you tell me what brought you in today?',
    patientReplyMatches: resumedTurn?.patientResponse === turn.text
  }
  if (currentAfterTurnResponse.status !== 200 || currentAfterTurn.encounter?.sessionId !== sessionId ||
      currentAfterTurn.encounter.status !== 'active' || currentAfterTurn.encounter.transcript?.length !== 1 ||
      resumedTurn?.learnerMessage !== 'Could you tell me what brought you in today?' || resumedTurn.patientResponse !== turn.text) {
    throw new Error('The accepted live turn did not return through the same owner-scoped encounter transcript.')
  }

  currentStep = 'persist the transcript and provider metering'
  const eventWorker = createSessionEventWorker(workerRedis, testPool, {
    consumerName: `live-verify-${process.pid}`,
    blockMs: 1
  })
  await eventWorker.ensureGroup()
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await eventWorker.processOnce() === 0) break
  }
  const durableTranscript = await testPool.query<{ count: number }>(
    'SELECT count(*)::int AS count FROM session_transcript WHERE session_id = $1', [sessionId]
  )
  const durableUsage = await testPool.query<{
    operation: string
    input_tokens: number
    cached_input_tokens: number
    cache_write_tokens: number
    output_tokens: number
    estimated_cost_usd: string | null
  }>(
    `SELECT operation, input_tokens, cached_input_tokens, cache_write_tokens, output_tokens, estimated_cost_usd
     FROM provider_usage WHERE session_id = $1 ORDER BY occurred_at, operation`,
    [sessionId]
  )
  if (durableTranscript.rows[0]?.count !== 2 || durableUsage.rows.length < 2) {
    throw new Error('The live setup and accepted turn were not persisted by the session event worker.')
  }

  verificationSummary.model = env.OPENAI_MODEL?.trim() || 'gpt-6-luna'
  verificationSummary.setupStatus = setup.status
  verificationSummary.learnerSafeSetup = true
  verificationSummary.redisConversationBinding = true
  verificationSummary.currentEncounterResolvesSameSession = true
  verificationSummary.liveTurnAcceptedAndRestored = true
  verificationSummary.persistedTranscriptRows = durableTranscript.rows[0]?.count
  verificationSummary.providerUsage = durableUsage.rows.map((sample) => ({
    operation: sample.operation,
    inputTokens: Number(sample.input_tokens),
    cachedInputTokens: Number(sample.cached_input_tokens),
    cacheWriteTokens: Number(sample.cache_write_tokens),
    outputTokens: Number(sample.output_tokens),
    estimatedCostUsd: sample.estimated_cost_usd
  }))
  verificationSummary.scenarioFingerprintRecorded = Boolean(binding.rows[0]?.scenario_fingerprint)
} catch (error) {
  verificationSummary.failure = {
    step: currentStep,
    errorName: error instanceof Error ? error.name : 'UnknownError',
    status: error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
      ? error.status
      : null
  }
} finally {
  if (apiServer) await new Promise<void>((resolve, reject) => apiServer?.close((error) => error ? reject(error) : resolve()))
  if (conversationId) {
    const openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 15_000, maxRetries: 0 })
    try {
      await deletePatientSetupConversation(openaiClient, conversationId)
      verificationSummary.providerConversationDeleted = true
    } catch {
      providerCleanupFailures += 1
      verificationSummary.providerConversationDeleted = false
      if (testPool) {
        await testPool.query(
          `INSERT INTO app_patient_scenario_conversation_cleanup (provider_conversation_id)
           VALUES ($1) ON CONFLICT (provider_conversation_id) DO NOTHING`,
          [conversationId]
        )
      }
    }
  }
  await workerRedis?.quit()
  await serviceClients?.close()
  await testPool?.end()
  if (temporaryRedisDatabase !== undefined) {
    const cleanupRedis = createClient({ url: isolatedRedisUrl.toString() })
    cleanupRedis.on('error', () => undefined)
    await cleanupRedis.connect()
    await cleanupRedis.sendCommand(['FLUSHDB'])
    await cleanupRedis.quit()
  }
  if (!providerCleanupFailures) {
    await adminPool.query(`DROP DATABASE IF EXISTS "${temporaryDatabase}"`)
  } else {
    preserveTemporaryDatabase = true
  }
  await adminPool.end()
}

verificationSummary.providerConversationCleanupFailures = providerCleanupFailures
if (preserveTemporaryDatabase) verificationSummary.cleanupDatabasePreservedForRetry = true
console.log(JSON.stringify(verificationSummary, null, 2))
if (verificationSummary.failure || providerCleanupFailures) process.exitCode = 1
