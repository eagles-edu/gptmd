import OpenAI from 'openai'
import { Pool } from 'pg'
import { createClient } from 'redis'
import type { ApiDependencies, PostgresProbe, RedisProbe } from './app.js'
import { generatePatientScenario } from './patient-profile.js'

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
    ? { query: () => postgresPool.query('SELECT 1') }
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
        ? () => generatePatientScenario(openaiClient, env.OPENAI_MODEL?.trim() || 'gpt-6-luna')
        : null,
      model: env.OPENAI_MODEL?.trim() || 'gpt-6-luna'
    },
    async close() {
      await Promise.all([
        redisClient?.isOpen ? redisClient.quit() : Promise.resolve(),
        postgresPool?.end() ?? Promise.resolve()
      ])
    }
  }
}
