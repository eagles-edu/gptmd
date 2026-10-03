import { createHash, randomBytes } from 'node:crypto'
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
    '004_durable_session_history.sql'
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
    reasonForVisit: 'Pelvic pain', diagnosis: 'Endometriosis', history: [],
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
    `INSERT INTO tenant_memberships (tenant_id, subject_id, status) VALUES ($1, $2, 'active')`,
    [tenantId, subjectId]
  )
  await testPool.query(
    `INSERT INTO app_sessions (session_id, patient_profile_id, tenant_id, subject_id, status)
     VALUES ($1, $2, $3, $4, 'ready')`,
    [sessionId, patientProfileId, tenantId, subjectId]
  )
  await testPool.query(
    `INSERT INTO patient_scenarios (
       scenario_id, session_id, schema_version, created_at, profile_digest, profile_json,
       provider_conversation_id, prompt_version, model_version, policy_version
     ) VALUES ($1, $2, 1, $3, $4, $5::jsonb, 'verification-conversation',
       'patient-scenario-prompt-v1', 'gpt-6-luna', 'patient-scenario-policy-v1')`,
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
    conversationId: 'verification-conversation', profileDigest, schemaVersion: 1
  })

  const turn = {
    turnId: `turn-${randomBytes(6).toString('hex')}`, sessionId, sequence: 1,
    acceptedAt: new Date().toISOString(), phase: 'history', learnerMessage: 'What brings you in?',
    patientResponse: 'I have pelvic pain.', patientReportedFacts: [], historyCoverage: [],
    disclosedHistoryFields: [], disclosedFactIds: [], clinicalActions: []
  }
  const commits = await Promise.all([stateStore.acceptTurn(turn), stateStore.acceptTurn(turn)])
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
  if (await worker.processOnce() !== 1) throw new Error('Event worker did not persist and acknowledge the accepted turn')
  const turnEnvelope = {
    eventId: turn.turnId, sessionId, sequence: 1, eventType: 'accepted_turn',
    occurredAt: turn.acceptedAt, payload: turn
  }
  await redis.sendCommand(['XADD', streamKey, '*', 'event', JSON.stringify(turnEnvelope)])
  if (await worker.processOnce() !== 1) throw new Error('Worker did not acknowledge the idempotent PostgreSQL retry')
  const durableTurnCount = await testPool.query(
    `SELECT count(*)::int AS count FROM session_events WHERE session_id = $1`, [sessionId]
  )
  if (durableTurnCount.rows[0]?.count !== 1) throw new Error('Worker retry duplicated the PostgreSQL event')

  const terminal = {
    eventId: `terminal-${randomBytes(6).toString('hex')}`, sessionId, outcome: 'completed',
    occurredAt: new Date().toISOString(), reason: null, finalTurnSequence: 1
  }
  if (await stateStore.recordTerminal(terminal) !== 'accepted') throw new Error('Redis terminal event was not accepted')
  if (await worker.processOnce() !== 1) throw new Error('Worker did not persist the terminal event')

  await redis.sendCommand(['DEL', `gptmd:session:${sessionId}`, `gptmd:patient:${patientProfileId}`, `gptmd:retries:${sessionId}`])
  const sessionStore = createPostgresSessionStore(testPool, stateStore)
  await sessionStore.ensureLiveState?.({ tenantId, subjectId }, sessionId)
  const recovered = await stateStore.read(sessionId)
  if (recovered?.state.status !== 'completed' || recovered.acceptedTurns[0]?.turnId !== turn.turnId ||
      recovered.terminalEvent?.eventId !== terminal.eventId) {
    throw new Error('PostgreSQL history did not rebuild the missing Redis state')
  }
  const redisTtl = Number(await redis.sendCommand(['TTL', `gptmd:session:${sessionId}`]))
  if (redisTtl < 1 || redisTtl > 20 * 60) throw new Error('Recovered terminal Redis state has the wrong expiry')

  process.stdout.write(JSON.stringify({
    redisAppendFsync: 'everysec',
    turnRetry: 'saved reply returned; one Redis event emitted',
    workerRetry: 'one PostgreSQL event; acknowledged after commit',
    terminalOutcome: 'persisted',
    missingStateRecovery: 'rebuilt from PostgreSQL history',
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
