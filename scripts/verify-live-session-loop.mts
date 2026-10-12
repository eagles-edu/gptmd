import { createHmac, randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { parseEnv } from 'node:util'
import { chromium, type Browser, type Page } from '@playwright/test'
import { createApiApp } from '../services/api/src/app.ts'
import { createServiceClients } from '../services/api/src/clients.ts'
import { deletePatientSetupConversation } from '../services/api/src/patient-profile.ts'
import { createRedisPatientStateStore } from '../services/api/src/patient-state-store.ts'
import { createSessionEventWorker } from '../services/api/src/session-event-worker.ts'
import { cleanupLiveVerificationConversations } from '../services/api/src/live-verification-conversation-cleanup.ts'

async function captureLiveTranscription(
  page: Page,
  apiBase: string,
  sessionId: string,
  tenantId: string,
  token: string,
  speechWav: Buffer
): Promise<string> {
  await page.goto(`${apiBase}/readyz`, { waitUntil: 'domcontentloaded' })
  await page.evaluate('window.__name = (fn) => fn')
  return page.evaluate(async ({ targetApiBase, targetSessionId, targetTenantId, bearerToken, wavBase64 }) => {
    const peer = new RTCPeerConnection()
    const audioContext = new AudioContext()
    let source: AudioBufferSourceNode | undefined
    let keepConnectionOpen = false
    try {
      const destination = audioContext.createMediaStreamDestination()
      const track = destination.stream.getAudioTracks()[0]
      if (!track) throw new Error('Synthetic audio track was not created.')
      peer.addTrack(track, destination.stream)
      const events = peer.createDataChannel('oai-events')
      const transcriptPromise = new Promise<string>((resolve, reject) => {
        const timeout = window.setTimeout(() => reject(new Error('Realtime transcription did not finish in time.')), 30_000)
        events.addEventListener('message', ({ data }) => {
          let event: { type?: string; transcript?: string }
          try {
            event = JSON.parse(String(data)) as typeof event
          } catch {
            return
          }
          if (event.type === 'error') {
            window.clearTimeout(timeout)
            reject(new Error('OpenAI Realtime rejected the synthetic speech sample.'))
          } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
            window.clearTimeout(timeout)
            resolve(event.transcript?.trim() ?? '')
          }
        })
      })
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      if (peer.iceGatheringState !== 'complete') {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error('ICE candidate gathering timed out.')), 10_000)
          const onStateChange = () => {
            if (peer.iceGatheringState !== 'complete') return
            window.clearTimeout(timeout)
            peer.removeEventListener('icegatheringstatechange', onStateChange)
            resolve()
          }
          peer.addEventListener('icegatheringstatechange', onStateChange)
          onStateChange()
        })
      }
      const response = await fetch(`${targetApiBase}/api/sessions/${targetSessionId}/audio-transcription`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${bearerToken}`,
          'x-gptmd-tenant-id': targetTenantId,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          consentVersion: 'gptmd-audio-transcription-v1',
          sdp: peer.localDescription?.sdp
        })
      })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null
        const detail = typeof body?.error === 'string' ? ` ${body.error.slice(0, 160)}` : ''
        throw new Error(`Authenticated audio-transcription route returned HTTP ${response.status}.${detail}`)
      }
      const connection = await response.json() as { answerSdp?: string }
      if (!connection.answerSdp) throw new Error('Audio-transcription route returned no SDP answer.')
      await peer.setRemoteDescription({ type: 'answer', sdp: connection.answerSdp })
      if (events.readyState !== 'open') {
        await new Promise<void>((resolve, reject) => {
          const timeout = window.setTimeout(() => reject(new Error('Realtime event channel did not open.')), 15_000)
          events.addEventListener('open', () => {
            window.clearTimeout(timeout)
            resolve()
          }, { once: true })
          events.addEventListener('error', () => {
            window.clearTimeout(timeout)
            reject(new Error('Realtime event channel failed to open.'))
          }, { once: true })
        })
      }
      await audioContext.resume()
      const bytes = Uint8Array.from(atob(wavBase64), (character) => character.charCodeAt(0))
      const audioData = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
      const audioBuffer = await audioContext.decodeAudioData(audioData)
      source = audioContext.createBufferSource()
      source.buffer = audioBuffer
      source.connect(destination)
      const playbackEnded = new Promise<void>((resolve) => {
        source!.addEventListener('ended', () => resolve(), { once: true })
      })
      source.start()
      await playbackEnded
      await new Promise((resolve) => window.setTimeout(resolve, 300))
      if (events.readyState !== 'open') throw new Error('Realtime channel closed before the spoken audio could be committed.')
      events.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
      const transcript = await transcriptPromise
      const retainedWindow = window as Window & {
        __gptmdLiveTestPeer?: RTCPeerConnection
        __gptmdLiveTestAudioContext?: AudioContext
      }
      retainedWindow.__gptmdLiveTestPeer = peer
      retainedWindow.__gptmdLiveTestAudioContext = audioContext
      keepConnectionOpen = true
      return transcript
    } finally {
      source?.stop()
      if (!keepConnectionOpen) {
        peer.close()
        await audioContext.close().catch(() => undefined)
      }
    }
  }, {
    targetApiBase: apiBase,
    targetSessionId: sessionId,
    targetTenantId: tenantId,
    bearerToken: token,
    wavBase64: speechWav.toString('base64')
  })
}

const runLive = process.argv.includes('--run-live')
const runLiveAudio = process.argv.includes('--with-live-audio')
if (!runLive) {
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
let liveBrowser: Browser | undefined
let liveAudioPage: Page | undefined
let providerCleanupFailures = 0
let providerAudioCallCleanupFailures = 0
let currentStep = 'prepare isolated PostgreSQL and Redis'
const syntheticSpeech = 'Could you tell me what brought you in today?'
const syntheticSpeechWav = runLiveAudio
  ? execFileSync('espeak', ['--stdout', syntheticSpeech], { maxBuffer: 1_000_000 })
  : undefined
if (syntheticSpeechWav && syntheticSpeechWav.toString('ascii', 0, 4) !== 'RIFF') {
  throw new Error('The synthetic speech generator did not return a WAV file.')
}
if (runLiveAudio) {
  console.error('Live audio mode sends one short synthetic speech sample through OpenAI Realtime and makes a billable patient turn.')
}

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
if (runLiveAudio) liveBrowser = await chromium.launch({ headless: true })

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
let realtimeProviderFailure: { step: string; reason: string; status: number | null } | undefined

function captureProviderFailure(step: string, error: unknown): void {
  realtimeProviderFailure = {
    step,
    reason: error instanceof Error
      ? error.message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/sk-[A-Za-z0-9_-]{10,}/g, '[redacted]')
        .replace(/ek_[A-Za-z0-9_-]{10,}/g, '[redacted]')
        .replace(/[\r\n\t]+/g, ' ')
        .slice(0, 200)
      : 'Unknown provider error',
    status: error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
      ? error.status
      : null
  }
}

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
  const createTranscriptionCall = serviceClients.dependencies.createTranscriptionCall
  if (createTranscriptionCall) {
    serviceClients.dependencies.createTranscriptionCall = async (sdpOffer) => {
      try {
        return await createTranscriptionCall(sdpOffer)
      } catch (error) {
        captureProviderFailure('OpenAI Realtime call creation', error)
        throw error
      }
    }
  }
  const observeTranscriptionUsage = serviceClients.dependencies.observeTranscriptionUsage
  if (observeTranscriptionUsage) {
    serviceClients.dependencies.observeTranscriptionUsage = async (callId, onUsage, onDisconnect) => {
      try {
        return await observeTranscriptionUsage(callId, onUsage, onDisconnect)
      } catch (error) {
        captureProviderFailure('Realtime sideband observer connection', error)
        throw error
      }
    }
  }
  await serviceClients.dependencies.redis?.connect()
  workerRedis = createClient({ url: isolatedRedisUrl.toString() })
  workerRedis.on('error', () => undefined)
  await workerRedis.connect()

  currentStep = 'seed temporary learner membership and entitlements'
  await testPool.query('INSERT INTO tenants (tenant_id) VALUES ($1)', [tenantId])
  await testPool.query(
    `INSERT INTO tenant_entitlements (
       tenant_id, sessions_enabled, responses_enabled,
       audio_transcription_enabled, audio_transcription_privacy_approved,
       monthly_audio_transcription_session_quota
     ) VALUES ($1, true, true, $2, $2, $3)`,
    [tenantId, runLiveAudio, runLiveAudio ? 1 : null]
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
  serviceClients.dependencies.allowedOrigins = [apiBase]

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

  let learnerQuestion = 'Could you tell me what brought you in today?'
  let learnerQuestionModality: 'typed' | 'realtime_transcription' = 'typed'
  if (runLiveAudio && syntheticSpeechWav) {
    currentStep = 'transcribe synthetic browser speech through the authenticated live audio route'
    const audioGate = await testPool.query<{
      sessions_enabled: boolean
      audio_transcription_enabled: boolean
      audio_transcription_privacy_approved: boolean
      monthly_quota: number | null
      membership_status: string | null
      session_status: string | null
    }>(
      `SELECT entitlement.sessions_enabled, entitlement.audio_transcription_enabled,
              entitlement.audio_transcription_privacy_approved,
              entitlement.monthly_audio_transcription_session_quota AS monthly_quota,
              membership.status AS membership_status, session.status AS session_status
       FROM tenant_entitlements AS entitlement
       JOIN tenant_memberships AS membership USING (tenant_id)
       JOIN app_sessions AS session ON session.tenant_id = entitlement.tenant_id
         AND session.subject_id = membership.subject_id
       WHERE entitlement.tenant_id = $1 AND membership.subject_id = $2 AND session.session_id = $3`,
      [tenantId, subjectId, sessionId]
    )
    const gates = audioGate.rows[0]
    if (!gates?.sessions_enabled || !gates.audio_transcription_enabled ||
        !gates.audio_transcription_privacy_approved || gates.monthly_quota !== 1 ||
        gates.membership_status !== 'active' || gates.session_status !== 'ready') {
      throw new Error('Isolated audio entitlement, privacy approval, quota, membership, or session readiness is incorrect.')
    }
    liveAudioPage = await liveBrowser!.newPage()
    const transcript = await captureLiveTranscription(
      liveAudioPage, apiBase, sessionId, tenantId, token, syntheticSpeechWav
    )
    const normalizedTranscript = transcript.toLocaleLowerCase('en').replace(/[^a-z0-9]+/g, ' ').trim()
    if (!normalizedTranscript.includes('what brought you in today')) {
      throw new Error('Live transcription did not preserve the expected spoken question.')
    }
    learnerQuestion = transcript
    learnerQuestionModality = 'realtime_transcription'
    const readAudioUsage = () => testPool!.query<{
      provider_call_id: string
      provider_audio_seconds: number
      usage_observer_status: string
      usage_event_count: number
    }>(
      `SELECT audio.provider_call_id,
              audio.provider_audio_seconds::float8 AS provider_audio_seconds,
              audio.usage_observer_status,
              count(event.provider_event_id)::int AS usage_event_count
       FROM app_audio_transcription_sessions AS audio
       LEFT JOIN app_audio_transcription_usage_events AS event USING (provider_call_id)
       WHERE audio.session_id = $1
       GROUP BY audio.grant_id`,
      [sessionId]
    )
    let audioUsage = await readAudioUsage()
    for (let attempt = 0; attempt < 20 &&
        (!audioUsage.rows[0]?.usage_event_count || audioUsage.rows[0].provider_audio_seconds <= 0 ||
          audioUsage.rows[0].usage_observer_status !== 'connected'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 500))
      audioUsage = await readAudioUsage()
    }
    const observedUsage = audioUsage.rows[0]
    if (!observedUsage?.provider_call_id || observedUsage.usage_event_count < 1 ||
        observedUsage.provider_audio_seconds <= 0 || observedUsage.usage_observer_status !== 'connected') {
      throw new Error('Live transcription completed, but server-side provider duration usage was not persisted.')
    }
    verificationSummary.liveRealtimeAudio = {
      browser: 'Chromium WebRTC with a generated speech WAV track',
      transcriptMatchedSpokenPhrase: true,
      transcriptSubmittedAsAuthenticatedPatientTurn: true,
      serverObservedUsageEventCount: observedUsage.usage_event_count,
      serverObservedAudioSeconds: observedUsage.provider_audio_seconds
    }
  }

  const turnId = `live-${randomBytes(8).toString('hex')}`
  currentStep = 'submit the first live patient turn'
  const turnResponse = await fetch(`${apiBase}/api/sessions/${sessionId}/turns`, {
    method: 'POST',
    headers: { ...authHeaders, 'content-type': 'application/json' },
    body: JSON.stringify({ turnId, text: learnerQuestion, modality: learnerQuestionModality })
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
    turnTextMatches: resumedTurn?.learnerMessage === learnerQuestion,
    patientReplyMatches: resumedTurn?.patientResponse === turn.text
  }
  if (currentAfterTurnResponse.status !== 200 || currentAfterTurn.encounter?.sessionId !== sessionId ||
      currentAfterTurn.encounter.status !== 'active' || currentAfterTurn.encounter.transcript?.length !== 1 ||
      resumedTurn?.learnerMessage !== learnerQuestion || resumedTurn.patientResponse !== turn.text) {
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
    reason: error instanceof Error
      ? error.message.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/sk-[A-Za-z0-9_-]{10,}/g, '[redacted]')
        .replace(/ek_[A-Za-z0-9_-]{10,}/g, '[redacted]')
        .replace(/[\r\n\t]+/g, ' ')
        .slice(0, 240)
      : 'Unknown error',
    status: error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
      ? error.status
      : null
  }
  if (realtimeProviderFailure) verificationSummary.realtimeProviderFailure = realtimeProviderFailure
} finally {
  if (testPool && sessionId && serviceClients?.dependencies.hangupTranscriptionCall) {
    try {
      const audioCalls = await testPool.query<{ provider_call_id: string }>(
        `SELECT provider_call_id FROM app_audio_transcription_sessions
         WHERE session_id = $1 AND provider_call_id IS NOT NULL`,
        [sessionId]
      )
      for (const call of audioCalls.rows) {
        try {
          await serviceClients.dependencies.hangupTranscriptionCall(call.provider_call_id)
        } catch {
          providerAudioCallCleanupFailures += 1
        }
      }
    } catch {
      providerAudioCallCleanupFailures += 1
    }
  }
  await liveAudioPage?.close().catch(() => undefined)
  await liveBrowser?.close().catch(() => undefined)
  if (apiServer) await new Promise<void>((resolve, reject) => apiServer?.close((error) => error ? reject(error) : resolve()))
  if (testPool) {
    const queuedConversations = await testPool.query<{ provider_conversation_id: string }>(
      `SELECT provider_conversation_id
       FROM app_patient_scenario_conversation_cleanup
       ORDER BY created_at`
    )
    const openaiClient = new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 15_000, maxRetries: 0 })
    const cleanupResult = await cleanupLiveVerificationConversations(
      (sql, values) => testPool!.query(sql, values),
      [
        ...(conversationId ? [conversationId] : []),
        ...queuedConversations.rows.map((row) => row.provider_conversation_id)
      ],
      (id) => deletePatientSetupConversation(openaiClient, id)
    )
    providerCleanupFailures = cleanupResult.failedCount + cleanupResult.trackingFailureCount + providerAudioCallCleanupFailures
    verificationSummary.providerConversationsDeleted = cleanupResult.deletedCount
    verificationSummary.providerConversationCleanupFailures = providerCleanupFailures
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
verificationSummary.providerAudioCallCleanupFailures = providerAudioCallCleanupFailures
if (preserveTemporaryDatabase) verificationSummary.cleanupDatabasePreservedForRetry = true
console.log(JSON.stringify(verificationSummary, null, 2))
if (verificationSummary.failure || providerCleanupFailures) process.exitCode = 1
