import express, { type Express } from 'express'
import type { GeneratedPatientScenario } from './patient-profile.js'

export interface RedisProbe {
  readonly isOpen: boolean
  connect(): Promise<unknown>
  ping(): Promise<string>
}

export interface PostgresProbe {
  query(): Promise<unknown>
}

export interface ApiDependencies {
  redis: RedisProbe | null
  postgres: PostgresProbe | null
  openaiConfigured: boolean
  generateResponse: ((input: string) => Promise<{ id: string; outputText: string }>) | null
  generatePatientScenario: (() => Promise<GeneratedPatientScenario>) | null
  model: string
}

const validInput = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 12_000

export function createApiApp(dependencies: ApiDependencies): Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(express.json({ limit: '1mb' }))

  app.get('/healthz', (_request, response) => {
    response.json({ status: 'ok', service: 'gptmd-api' })
  })

  app.get('/readyz', async (_request, response) => {
    const checks = await Promise.allSettled([
      dependencies.redis
        ? (async () => {
            if (!dependencies.redis?.isOpen) await dependencies.redis?.connect()
            await dependencies.redis?.ping()
          })()
        : Promise.reject(new Error('not configured')),
      dependencies.postgres
        ? dependencies.postgres.query()
        : Promise.reject(new Error('not configured'))
    ])

    const redis = checks[0]?.status === 'fulfilled'
      ? 'ready'
      : dependencies.redis ? 'unavailable' : 'missing'
    const postgres = checks[1]?.status === 'fulfilled'
      ? 'ready'
      : dependencies.postgres ? 'unavailable' : 'missing'
    const openai = dependencies.openaiConfigured ? 'configured' : 'missing'
    const ready = redis === 'ready' && postgres === 'ready' && openai === 'configured'

    response.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      service: 'gptmd-api',
      dependencies: { redis, postgres, openai }
    })
  })

  app.post('/api/openai/responses', async (request, response) => {
    if (!validInput(request.body?.input)) {
      response.status(400).json({ error: 'input must be a non-empty string of at most 12000 characters' })
      return
    }

    if (!dependencies.generateResponse) {
      response.status(503).json({ error: 'OpenAI is not configured' })
      return
    }

    try {
      const result = await dependencies.generateResponse(request.body.input)
      response.json({ id: result.id, outputText: result.outputText })
    } catch {
      response.status(502).json({ error: 'OpenAI request failed' })
    }
  })

  return app
}
