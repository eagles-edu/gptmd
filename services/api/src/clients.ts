import OpenAI from 'openai'
import { Pool } from 'pg'
import { createClient } from 'redis'
import type { ApiDependencies, PostgresProbe, RedisProbe } from './app.js'
import { generatePatientScenario } from './patient-profile.js'
import { createPostgresSessionStore } from './session-store.ts'

export interface ServiceClients {
  dependencies: ApiDependencies
  close(): Promise<void>
}

export function createServiceClients(env: NodeJS.ProcessEnv = process.env): ServiceClients {
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
               to_regclass('public.tenant_entitlements') IS NOT NULL AND
               to_regclass('public.tenant_monthly_usage') IS NOT NULL AND
               to_regclass('public.app_sessions') IS NOT NULL AS ready`
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
        ? async (input) => {
            const result = await openaiClient.responses.create({
              model: env.OPENAI_MODEL?.trim() || 'gpt-6-luna',
              input
            })
            return { id: result.id, outputText: result.output_text }
          }
        : null,
      generatePatientScenario: openaiClient
        ? (versions, asOf) => generatePatientScenario(openaiClient, versions.modelVersion, {
            asOf,
            promptVersion: versions.promptVersion,
            policyVersion: versions.policyVersion
          })
        : null,
      model: env.OPENAI_MODEL?.trim() || 'gpt-6-luna',
      allowedOrigins: (env.API_CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean),
      jwt: {
        secret: env.API_AUTH_JWT_SECRET ?? null,
        issuer: env.API_AUTH_JWT_ISSUER ?? null,
        audience: env.API_AUTH_JWT_AUDIENCE ?? null,
        jwksUrl: env.API_AUTH_JWT_JWKS_URL ?? null
      },
      sessionStore: postgresPool ? createPostgresSessionStore(postgresPool) : null
    },
    async close() {
      await Promise.all([
        redisClient?.isOpen ? redisClient.quit() : Promise.resolve(),
        postgresPool?.end() ?? Promise.resolve()
      ])
    }
  }
}
