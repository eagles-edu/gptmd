import OpenAI from 'openai'
import { Pool } from 'pg'
import { createClient } from 'redis'
import type { ApiDependencies, PostgresProbe, RedisProbe } from './app.js'
import type { SetupQueueLimits } from './bounded-setup-queue.ts'
import { generatePatientScenario } from './patient-profile.js'
import { generatePatientTurn } from './patient-turn.js'
import { reportResponsesTiming, type ResponsesTimingRecorder } from './response-timing.js'
import { createPostgresSessionStore } from './session-store.ts'
import { createRedisPatientStateStore, type SessionCommitTimingRecorder } from './patient-state-store.ts'

export function realtimeTranscriptionSessionConfig() {
  return {
    type: 'transcription' as const,
    audio: {
      input: {
        format: { type: 'audio/pcm' as const, rate: 24_000 as const },
        transcription: { model: 'gpt-live-transcribe', languages: ['en'] },
        turn_detection: null
      }
    }
  }
}

export interface ServiceClients {
  dependencies: ApiDependencies
  close(): Promise<void>
}

function integerSetting(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  const raw = env[name]?.trim()
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

function readSetupQueueLimits(env: NodeJS.ProcessEnv): SetupQueueLimits {
  return {
    maxConcurrent: integerSetting(env, 'API_SETUP_MAX_CONCURRENT', 2, 1, 16),
    maxQueued: integerSetting(env, 'API_SETUP_MAX_QUEUED', 4, 0, 100),
    waitTimeoutMs: integerSetting(env, 'API_SETUP_QUEUE_TIMEOUT_MS', 15_000, 1_000, 120_000)
  }
}

export function createServiceClients(
  env: NodeJS.ProcessEnv = process.env,
  recordSessionCommitTiming?: SessionCommitTimingRecorder
): ServiceClients {
  const setupQueueLimits = readSetupQueueLimits(env)
  const redisClient = env.REDIS_URL
    ? createClient({
        url: env.REDIS_URL,
        socket: {
          connectTimeout: 2_000,
          reconnectStrategy: (retries) => retries < 3 ? 250 : false
        }
      })
    : null
  redisClient?.on('error', () => undefined)

  const postgresPool = env.DATABASE_URL
    ? new Pool({
        connectionString: env.DATABASE_URL,
        max: 10,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 2_000
      })
    : null
  postgresPool?.on('error', () => undefined)

  const openaiClient = env.OPENAI_API_KEY
    ? new OpenAI({ apiKey: env.OPENAI_API_KEY, timeout: 15_000, maxRetries: 2 })
    : null

  const redis: RedisProbe | null = redisClient
    ? {
        get isOpen() {
          return redisClient.isOpen
        },
        connect: () => redisClient.connect(),
        ping: () => redisClient.ping()
      }
    : null
  const postgres: PostgresProbe | null = postgresPool
    ? {
        async query() {
          const result = await postgresPool.query<{ ready: boolean }>(
            `SELECT
               to_regclass('public.tenants') IS NOT NULL AND
               to_regclass('public.tenant_memberships') IS NOT NULL AND
               EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'tenant_memberships'
                   AND column_name = 'role'
               ) AND
               to_regclass('public.tenant_entitlements') IS NOT NULL AND
               to_regclass('public.app_audio_transcription_sessions') IS NOT NULL AND
               EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'app_audio_transcription_sessions'
                   AND column_name IN ('provider_call_id', 'disconnect_after', 'disconnect_claimed_at', 'disconnect_attempts', 'disconnect_next_attempt_at', 'disconnected_at')
                 GROUP BY table_name HAVING count(*) = 6
               ) AND
               EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'tenant_entitlements'
                   AND column_name IN ('audio_transcription_enabled', 'audio_transcription_privacy_approved', 'monthly_audio_transcription_session_quota')
                 GROUP BY table_name HAVING count(*) = 3
               ) AND
               to_regclass('public.tenant_monthly_usage') IS NOT NULL AND
               to_regclass('public.tenant_user_monthly_usage') IS NOT NULL AND
               to_regclass('public.app_session_usage') IS NOT NULL AND
               EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'app_session_usage'
                   AND column_name IN ('tenant_id', 'subject_id')
                 GROUP BY table_name HAVING count(*) = 2
               ) AND
               to_regclass('public.app_sessions') IS NOT NULL AND
               to_regclass('public.session_events') IS NOT NULL AND
               to_regclass('public.session_transcript') IS NOT NULL AND
               to_regclass('public.session_turn_audits') IS NOT NULL AND
               EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'session_events'
                   AND column_name = 'event_ordinal'
               ) AND EXISTS (
                 SELECT 1 FROM pg_constraint
                 WHERE conrelid = to_regclass('public.session_events')
                   AND conname = 'session_events_event_type_check'
                   AND pg_get_constraintdef(oid) LIKE '%assessment_submitted%'
               ) AND
               to_regclass('public.provider_usage') IS NOT NULL AND
               EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'provider_usage'
                   AND column_name IN ('model_id', 'service_tier', 'cache_write_tokens', 'pricing_version')
                 GROUP BY table_name HAVING count(*) = 4
               ) AND EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'provider_usage'
                   AND column_name = 'estimated_cost_usd' AND numeric_scale = 12
               ) AND
               to_regclass('public.download_engagement') IS NOT NULL AND
               to_regclass('public.session_outcomes') IS NOT NULL AND
               EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'app_sessions'
                   AND column_name = 'patient_profile_id'
               ) AND EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'app_sessions'
                   AND column_name = 'scenario_seed'
               ) AS ready`
          )
          if (!result.rows[0]?.ready) throw new Error('API schema migration is missing')
          return result
        }
      }
    : null

  return {
    dependencies: {
      redis,
      postgres,
      openaiConfigured: Boolean(openaiClient),
      generateResponse: openaiClient
        ? async (input, recordTiming?: ResponsesTimingRecorder) => {
            const startedAt = performance.now()
            let firstTokenReported = false
            const stream = openaiClient.responses.stream({
              model: env.OPENAI_MODEL?.trim() || 'gpt-6-luna',
              input
            })
            const reportFirstToken = () => {
              if (firstTokenReported) return
              firstTokenReported = true
              reportResponsesTiming(recordTiming, 'first_token', startedAt)
            }
            stream.on('response.output_text.delta', reportFirstToken)
            stream.on('response.refusal.delta', reportFirstToken)
            stream.on('response.completed', () => reportResponsesTiming(recordTiming, 'completed', startedAt))
            const result = await stream.finalResponse()
            return { id: result.id, outputText: result.output_text }
          }
        : null,
      generatePatientScenario: openaiClient
        ? (versions, asOf, scenarioSeed, recordTiming, recordProviderUsage) => generatePatientScenario(openaiClient, versions.modelVersion, {
            asOf,
            promptVersion: versions.promptVersion,
            policyVersion: versions.policyVersion,
            scenarioSeed,
            recordTiming,
            recordProviderUsage
          })
        : null,
      generatePatientTurn: openaiClient
        ? (context, recordTiming) => generatePatientTurn(
            openaiClient,
            env.OPENAI_MODEL?.trim() || 'gpt-6-luna',
            context,
            recordTiming
          )
        : null,
      createTranscriptionCall: openaiClient
        ? async (sdpOffer) => {
            const credential = await openaiClient.realtime.clientSecrets.create({
              expires_after: { anchor: 'created_at', seconds: 60 },
              session: realtimeTranscriptionSessionConfig()
            })
            if (credential.session.type !== 'transcription') throw new Error('Unexpected Realtime session type')
            const response = await fetch('https://api.openai.com/v1/realtime/calls', {
              method: 'POST',
              headers: { Authorization: `Bearer ${credential.value}`, 'Content-Type': 'application/sdp' },
              body: sdpOffer,
              signal: AbortSignal.timeout(15_000)
            })
            if (!response.ok) throw new Error('OpenAI could not start live transcription for this browser')
            const location = response.headers.get('location')
            const match = location?.match(/^\/v1\/realtime\/calls\/([A-Za-z0-9_-]+)$/)
            if (!match?.[1]) throw new Error('OpenAI did not return a valid Realtime call identifier')
            return {
              answerSdp: await response.text(),
              providerCallId: match[1],
              providerSessionId: credential.session.id
            }
          }
        : null,
      hangupTranscriptionCall: openaiClient
        ? async (providerCallId) => {
            try {
              await openaiClient.realtime.calls.hangup(providerCallId)
            } catch (error) {
              if (error instanceof OpenAI.APIError && error.status === 404) return
              throw error
            }
          }
        : null,
      model: env.OPENAI_MODEL?.trim() || 'gpt-6-luna',
      allowedOrigins: (env.API_CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
      jwt: {
        secret: env.API_AUTH_JWT_SECRET ?? null,
        issuer: env.API_AUTH_JWT_ISSUER ?? null,
        audience: env.API_AUTH_JWT_AUDIENCE ?? null,
        jwksUrl: env.API_AUTH_JWT_JWKS_URL ?? null
      },
      setupQueueLimits,
      sessionStore: postgresPool
        ? createPostgresSessionStore(
            postgresPool,
            redisClient ? createRedisPatientStateStore(redisClient) : null,
            { recordHandoffTiming: recordSessionCommitTiming }
          )
        : null
    },
    async close() {
      await Promise.all([
        redisClient?.isOpen ? redisClient.quit() : Promise.resolve(),
        postgresPool?.end() ?? Promise.resolve()
      ])
    }
  }
}
