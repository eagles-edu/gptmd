import OpenAI from 'openai'
import { Pool } from 'pg'
import { createClient } from 'redis'
import type { ApiDependencies, PostgresProbe, RedisProbe } from './app.js'
import type { SetupQueueLimits } from './bounded-setup-queue.ts'
import { generatePatientScenario } from './patient-profile.js'
import { generatePatientTurn } from './patient-turn.js'
import { createPostgresSessionStore } from './session-store.ts'
import { createPostgresTenantEntitlementAdminStore } from './tenant-entitlements.ts'
import { createPostgresPatientVariantSettingsStore } from './patient-variant-settings.ts'
import { createPostgresOrganizationAiTimeBudgetStore } from './organization-ai-time-budget.ts'
import { createPostgresProviderTokenReservationStore } from './provider-token-reservations.ts'
import { createPostgresSessionArchiveStore } from './session-archives.ts'
import { createPostgresConsumerTokenCatalogStore } from './consumer-token-catalog.ts'
import { createPostgresTokenEntitlementStore } from './token-entitlements.ts'
import { createRedisPatientStateStore, type SessionCommitTimingRecorder } from './patient-state-store.ts'
import { createRealtimeTranscriptionUsageObserver } from './realtime-transcription-usage-observer.ts'
import { resolveTrustedProxyAddresses } from './listener-config.ts'
import {
  createRedisRequestRateLimitStore,
  type RequestRateLimitLimits
} from './request-rate-limit.ts'

export function realtimeTranscriptionSessionConfig() {
  return {
    type: 'transcription' as const,
    audio: {
      input: {
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

function readRequestRateLimitLimits(env: NodeJS.ProcessEnv): RequestRateLimitLimits {
  return {
    windowSeconds: integerSetting(env, 'API_RATE_LIMIT_WINDOW_SECONDS', 60, 1, 3_600),
    perIp: integerSetting(env, 'API_RATE_LIMIT_PER_IP', 1_200, 1, 1_000_000),
    perIdentity: integerSetting(env, 'API_RATE_LIMIT_PER_IDENTITY', 300, 1, 100_000)
  }
}

export function createServiceClients(
  env: NodeJS.ProcessEnv = process.env,
  recordSessionCommitTiming?: SessionCommitTimingRecorder
): ServiceClients {
  const setupQueueLimits = readSetupQueueLimits(env)
  const requestRateLimitLimits = readRequestRateLimitLimits(env)
  const trustedProxyAddresses = resolveTrustedProxyAddresses(env)
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
  const providerTokenReservations = postgresPool
    ? createPostgresProviderTokenReservationStore(postgresPool)
    : null
  const transcriptionUsageObservers = new Map<string, () => Promise<void>>()
  const openTranscriptionUsageObserver = openaiClient
    ? createRealtimeTranscriptionUsageObserver(env.OPENAI_API_KEY!)
    : null
  const observeTranscriptionUsage = openaiClient
    ? async (
        callId: string,
        onUsage: (usage: { eventId: string; seconds: number }) => Promise<void>,
        onDisconnect: () => Promise<void>
      ) => {
        let disconnected = false
        const close = await openTranscriptionUsageObserver?.(callId, onUsage, async () => {
          disconnected = true
          transcriptionUsageObservers.delete(callId)
          await onDisconnect()
        })
        if (!close) throw new Error('Realtime usage observer is not configured')
        if (disconnected) {
          await close()
          throw new Error('Realtime usage observer disconnected before setup completed')
        }
        transcriptionUsageObservers.set(callId, close)
        return async () => {
          transcriptionUsageObservers.delete(callId)
          await close()
        }
      }
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
               to_regclass('public.tenant_entitlement_audit') IS NOT NULL AND
               EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'tenant_memberships'
                   AND column_name = 'role'
               ) AND
               to_regclass('public.tenant_entitlements') IS NOT NULL AND
               to_regclass('public.app_audio_transcription_sessions') IS NOT NULL AND
               to_regclass('public.app_patient_scenario_conversation_cleanup') IS NOT NULL AND
               EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'app_audio_transcription_sessions'
                   AND column_name IN ('provider_call_id', 'disconnect_after', 'disconnect_claimed_at', 'disconnect_attempts', 'disconnect_next_attempt_at', 'disconnected_at')
                 GROUP BY table_name HAVING count(*) = 6
               ) AND
               to_regclass('public.app_audio_transcription_usage_events') IS NOT NULL AND
               EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'app_audio_transcription_sessions'
                   AND column_name IN ('usage_observer_status', 'provider_audio_seconds')
                 GROUP BY table_name HAVING count(*) = 2
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
               to_regclass('public.gptmd_consumer_token_catalog') IS NOT NULL AND
               to_regclass('public.gptmd_consumer_token_catalog_audit') IS NOT NULL AND
              to_regclass('public.gptmd_token_entitlement_grants') IS NOT NULL AND
              to_regclass('public.gptmd_token_entitlement_entries') IS NOT NULL AND
              to_regclass('public.gptmd_token_reservation_allocations') IS NOT NULL AND
               to_regclass('public.session_identity_binding') IS NOT NULL AND
               to_regclass('public.session_events') IS NOT NULL AND
               to_regclass('public.app_assessment_drafts') IS NOT NULL AND
               to_regclass('public.session_local_utterances') IS NOT NULL AND
               to_regclass('public.session_transcript') IS NOT NULL AND
               to_regclass('public.session_turn_audits') IS NOT NULL AND
               to_regclass('public.tenant_ai_time_budget_settings') IS NOT NULL AND
               to_regclass('public.tenant_ai_time_budget_audit') IS NOT NULL AND
               to_regclass('public.tenant_member_ai_group_assignments') IS NOT NULL AND
               to_regclass('public.tenant_member_ai_department_assignments') IS NOT NULL AND
               to_regclass('public.tenant_member_ai_assignment_audit') IS NOT NULL AND
               to_regclass('public.tenant_member_roster_invitations') IS NOT NULL AND
               to_regclass('public.tenant_member_roster_invitation_audit') IS NOT NULL AND
               EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'app_sessions'
                   AND column_name IN ('ai_budget_group_code', 'ai_budget_department_code', 'ai_budget_department_assigned_at')
                 GROUP BY table_name HAVING count(*) = 3
               ) AND
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
               to_regclass('public.provider_token_reservations') IS NOT NULL AND
               EXISTS (
                 SELECT 1 FROM pg_constraint
                 WHERE conrelid = to_regclass('public.provider_token_reservations')
                   AND conname = 'provider_token_reservations_session_identity_snapshot_check'
               ) AND
               EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'app_sessions'
                   AND column_name = 'ai_budget_department_assigned_at'
               ) AND
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
               to_regclass('public.session_archive_jobs') IS NOT NULL AND
               to_regclass('public.session_archive_artifacts') IS NOT NULL AND
               EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'session_archive_jobs'
                   AND column_name IN ('artifact_id', 'download_expires_at')
                 GROUP BY table_name HAVING count(*) = 2
               ) AND EXISTS (
                 SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'download_engagement'
                   AND column_name = 'download_id'
               ) AND
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
      reserveProviderTokens: providerTokenReservations
        ? (input) => providerTokenReservations.reserve(input)
        : null,
      generatePatientScenario: openaiClient
        ? (versions, asOf, scenarioSeed, recordTiming, recordProviderUsage, reserveProviderTokens) => generatePatientScenario(
            openaiClient,
            versions.modelVersion,
            {
              asOf,
              promptVersion: versions.promptVersion,
              policyVersion: versions.policyVersion,
              scenarioSeed,
              recordTiming,
              recordProviderUsage,
              reserveProviderTokens,
              recordAbandonedConversationIds: async (conversationIds) => {
                if (!postgresPool) throw new Error('Patient setup Conversation cleanup storage is unavailable')
                await postgresPool.query(
                  `INSERT INTO app_patient_scenario_conversation_cleanup (provider_conversation_id)
                   SELECT unnest($1::text[])
                   ON CONFLICT (provider_conversation_id) DO NOTHING`,
                  [conversationIds]
                )
              }
            }
          )
        : null,
      generatePatientTurn: openaiClient
        ? (context, recordTiming, reserveProviderTokens) => generatePatientTurn(
            openaiClient,
            env.OPENAI_MODEL?.trim() || 'gpt-6-luna',
            context,
            recordTiming,
            reserveProviderTokens
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
            if (!response.ok) {
              const rawError = await response.text()
              type ProviderCallErrorBody = { error?: string | { type?: string; code?: string; message?: string } }
              let body: ProviderCallErrorBody | null
              try {
                body = JSON.parse(rawError) as ProviderCallErrorBody
              } catch {
                body = null
              }
              const providerErrorBody = typeof body?.error === 'object' ? body.error : null
              const providerMessage = providerErrorBody?.message ??
                (typeof body?.error === 'string' ? body.error : undefined)
              const safeProviderMessage = providerMessage
                ?.replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
                .replace(/sk-[A-Za-z0-9_-]{10,}/g, '[redacted]')
                .replace(/ek_[A-Za-z0-9_-]{10,}/g, '[redacted]')
                .replace(/[\r\n\t]+/g, ' ')
                .slice(0, 160)
              const providerCode = providerErrorBody?.code ?? providerErrorBody?.type
              const requestId = response.headers.get('x-request-id')
              const responseDetails = safeProviderMessage ??
                `non-JSON ${response.headers.get('content-type') ?? 'response'} (${rawError.length} bytes)`
              const providerDetails = [
                providerCode ? `code ${providerCode}` : null,
                responseDetails ? `details ${responseDetails}` : null,
                requestId ? `request ${requestId}` : null,
                ...['server', 'via', 'cf-ray', 'x-cache', 'x-envoy-upstream-service-time']
                  .map((name) => {
                    const value = response.headers.get(name)?.replace(/[\r\n\t]+/g, ' ').slice(0, 80)
                    return value ? `${name} ${value}` : null
                  })
              ].filter(Boolean).join(', ')
              const providerError = new Error(
                `OpenAI could not start live transcription for this browser (HTTP ${response.status}${providerDetails ? `, ${providerDetails}` : ''})`
              ) as Error & { status?: number }
              providerError.status = response.status
              throw providerError
            }
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
      observeTranscriptionUsage,
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
      requestRateLimitLimits,
    trustedProxyAddresses,
      requestRateLimitStore: redisClient ? createRedisRequestRateLimitStore(redisClient) : null,
      sessionStore: postgresPool
        ? createPostgresSessionStore(
            postgresPool,
            redisClient ? createRedisPatientStateStore(redisClient) : null,
            { recordHandoffTiming: recordSessionCommitTiming }
          )
        : null,
      tenantEntitlementAdminStore: postgresPool
        ? createPostgresTenantEntitlementAdminStore(postgresPool)
        : null,
      patientVariantSettingsStore: postgresPool
        ? createPostgresPatientVariantSettingsStore(postgresPool)
        : null,
      organizationAiTimeBudgetStore: postgresPool
        ? createPostgresOrganizationAiTimeBudgetStore(postgresPool)
        : null,
      sessionArchiveStore: postgresPool ? createPostgresSessionArchiveStore(postgresPool) : null,
      consumerTokenCatalogStore: postgresPool ? createPostgresConsumerTokenCatalogStore(postgresPool) : null,
      tokenEntitlementStore: postgresPool ? createPostgresTokenEntitlementStore(postgresPool) : null
    },
    async close() {
      await Promise.all([...transcriptionUsageObservers.values()].map((closeObserver) => closeObserver()))
      transcriptionUsageObservers.clear()
      await Promise.all([
        redisClient?.isOpen ? redisClient.quit() : Promise.resolve(),
        postgresPool?.end() ?? Promise.resolve()
      ])
    }
  }
}
