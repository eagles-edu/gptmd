import { once } from 'node:events'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiApp, type ApiDependencies } from '../../services/api/src/app.js'
import { createServiceClients } from '../../services/api/src/clients.js'

const createDependencies = (overrides: Partial<ApiDependencies> = {}): ApiDependencies => ({
  redis: {
    isOpen: true,
    connect: vi.fn().mockResolvedValue(undefined),
    ping: vi.fn().mockResolvedValue('PONG')
  },
  postgres: { query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) },
  openaiConfigured: true,
  generateResponse: vi.fn().mockResolvedValue({ id: 'resp_test', outputText: 'A test response.' }),
  generatePatientScenario: null,
  model: 'gpt-6-luna',
  ...overrides
})

async function withApi(
  dependencies: ApiDependencies,
  callback: (baseUrl: string) => Promise<void>
): Promise<void> {
  const server = createApiApp(dependencies).listen(0, '127.0.0.1') as Server
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('API did not bind to a TCP port.')

  try {
    await callback(`http://127.0.0.1:${address.port}`)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve())
    })
  }
}

afterEach(() => vi.restoreAllMocks())

describe('GPTMD API integrations', () => {
  it('defaults the OpenAI model to GPT-6 Luna', async () => {
    const clients = createServiceClients({})

    expect(clients.dependencies.model).toBe('gpt-6-luna')
    await clients.close()
  })

  it('keeps liveness available while reporting unavailable dependencies in readiness', async () => {
    const dependencies = createDependencies({
      redis: {
        isOpen: true,
        connect: vi.fn(),
        ping: vi.fn().mockRejectedValue(new Error('private connection detail'))
      },
      postgres: { query: vi.fn().mockRejectedValue(new Error('private database detail')) },
      openaiConfigured: false
    })

    await withApi(dependencies, async (baseUrl) => {
      const live = await fetch(`${baseUrl}/healthz`)
      const ready = await fetch(`${baseUrl}/readyz`)
      const readiness = await ready.json()

      expect(live.status).toBe(200)
      expect(ready.status).toBe(503)
      expect(readiness).toEqual({
        status: 'not_ready',
        service: 'gptmd-api',
        dependencies: { redis: 'unavailable', postgres: 'unavailable', openai: 'missing' }
      })
      expect(JSON.stringify(readiness)).not.toContain('private')
    })
  })

  it('checks Redis and PostgreSQL and reports a configured OpenAI client as ready', async () => {
    const dependencies = createDependencies()
    await withApi(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/readyz`)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        status: 'ready',
        service: 'gptmd-api',
        dependencies: { redis: 'ready', postgres: 'ready', openai: 'configured' }
      })
      expect(dependencies.redis?.ping).toHaveBeenCalledOnce()
      expect(dependencies.postgres?.query).toHaveBeenCalledOnce()
    })
  })

  it('bounds Redis reconnect failures and keeps readiness diagnostics secret-free', async () => {
    const dependencies = createDependencies({
      redis: {
        isOpen: false,
        connect: vi.fn().mockRejectedValue(new Error('private Redis endpoint detail')),
        ping: vi.fn()
      }
    })

    await withApi(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/readyz`)
      const body = await response.json()
      expect(response.status).toBe(503)
      expect(body.dependencies).toEqual({ redis: 'unavailable', postgres: 'ready', openai: 'configured' })
      expect(JSON.stringify(body)).not.toContain('private')
      expect(dependencies.redis?.connect).toHaveBeenCalledOnce()
    })
  })

  it('validates input before sending it to the OpenAI SDK', async () => {
    const dependencies = createDependencies()
    await withApi(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/openai/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: '   ' })
      })
      expect(response.status).toBe(400)
      expect(dependencies.generateResponse).not.toHaveBeenCalled()
    })
  })

  it('returns SDK output without logging or exposing upstream errors', async () => {
    const generateResponse = vi.fn().mockResolvedValue({ id: 'resp_test', outputText: 'A test response.' })
    const dependencies = createDependencies({ generateResponse })

    await withApi(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/openai/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'Use fictional data.' })
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ id: 'resp_test', outputText: 'A test response.' })
      expect(generateResponse).toHaveBeenCalledWith('Use fictional data.')
    })

    const failingDependencies = createDependencies({
      generateResponse: vi.fn().mockRejectedValue(new Error('sensitive upstream detail'))
    })
    await withApi(failingDependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/openai/responses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ input: 'Use fictional data.' })
      })
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ error: 'OpenAI request failed' })
    })
  })
})
