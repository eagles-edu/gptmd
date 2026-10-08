import { Pool } from 'pg'
import OpenAI from 'openai'
import { createClient } from 'redis'
import { createAudioTranscriptionExpiryWorker } from './audio-transcription-expiry-worker.ts'
import { createPatientScenarioConversationCleanupWorker } from './patient-scenario-conversation-cleanup-worker.ts'
import { deletePatientSetupConversation } from './patient-profile.js'
import { createSessionEventWorker } from './session-event-worker.ts'
import { createProcessResourceSampler } from './process-resource-metrics.ts'
import { createRedisPatientStateStore } from './patient-state-store.ts'
import { createSessionIdentityVerificationWorker } from './session-identity-verification-worker.ts'

if (!process.env.REDIS_URL || !process.env.DATABASE_URL) {
  throw new Error('REDIS_URL and DATABASE_URL are required for the session history worker')
}
if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for provider call expiry and scenario cleanup')

const redis = createClient({
  url: process.env.REDIS_URL,
  socket: {
    connectTimeout: 2_000,
    reconnectStrategy: (retries) => retries < 3 ? 250 : false
  }
})
redis.on('error', () => undefined)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000
})
pool.on('error', () => undefined)
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 10_000, maxRetries: 1 })

const abort = new AbortController()
const processResourceSample = createProcessResourceSampler({
  readCpu: () => process.cpuUsage(),
  readMemory: () => process.memoryUsage(),
  now: () => process.hrtime.bigint()
})
const processResourceMetricsTimer = setInterval(() => {
  process.stdout.write(`${JSON.stringify({
    event: 'process_resource_metrics', component: 'worker', observedAt: new Date().toISOString(),
    ...processResourceSample()
  })}\n`)
}, 30_000)
processResourceMetricsTimer.unref()
const worker = createSessionEventWorker(redis, pool, {
  onError: () => process.stderr.write('Session history worker reported an operational error; inspect Redis/PostgreSQL readiness and recent events.\n'),
  onMetrics: (metrics) => process.stdout.write(`${JSON.stringify({ event: 'session_event_worker_metrics', ...metrics })}\n`)
})
const identityVerificationWorker = createSessionIdentityVerificationWorker(
  pool,
  createRedisPatientStateStore(redis),
  {
    onError: () => process.stderr.write('Session identity verification encountered a storage error; it will retry.\n'),
    onMetrics: (metrics) => process.stdout.write(`${JSON.stringify({ event: 'session_identity_verification', ...metrics })}\n`)
  }
)
const expiryWorker = createAudioTranscriptionExpiryWorker(pool, async (providerCallId) => {
  try {
    await openai.realtime.calls.hangup(providerCallId)
  } catch (error) {
    if (error instanceof OpenAI.APIError && error.status === 404) return
    throw error
  }
}, {
  onError: () => process.stderr.write('Audio transcription expiry worker could not end a due provider call; it will retry.\n'),
  onMetrics: (completedCalls) => {
    if (completedCalls > 0) process.stdout.write(`${JSON.stringify({ event: 'audio_transcription_expiry_worker_metrics', completedCalls })}\n`)
  }
})
const scenarioConversationCleanupWorker = createPatientScenarioConversationCleanupWorker(
  pool,
  (conversationId) => deletePatientSetupConversation(openai, conversationId),
  {
    onError: () => process.stderr.write('Patient scenario Conversation cleanup failed; it will retry.\n'),
    onMetrics: (completedConversations) => {
      if (completedConversations > 0) {
        process.stdout.write(`${JSON.stringify({ event: 'patient_scenario_conversation_cleanup_metrics', completedConversations })}\n`)
      }
    }
  }
)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => abort.abort())
}

try {
  await Promise.all([
    worker.run(abort.signal), expiryWorker.run(abort.signal), scenarioConversationCleanupWorker.run(abort.signal),
    identityVerificationWorker.run(abort.signal)
  ])
} finally {
  clearInterval(processResourceMetricsTimer)
  await Promise.all([
    redis.isOpen ? redis.quit() : Promise.resolve(),
    pool.end()
  ])
}
