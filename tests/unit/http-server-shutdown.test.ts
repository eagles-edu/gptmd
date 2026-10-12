import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { drainHttpServer, withHttpDrainGate } from '../../services/api/src/http-server-shutdown.ts'

function listen(server: ReturnType<typeof createServer>): Promise<string> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') reject(new Error('HTTP test server did not bind a TCP port'))
      else resolve(`http://127.0.0.1:${address.port}`)
    })
  })
}

describe('HTTP server shutdown', () => {
  it('stops accepting new requests and waits for an active response to finish', async () => {
    let requestStarted!: () => void
    let releaseResponse!: () => void
    const started = new Promise<void>((resolve) => { requestStarted = resolve })
    const release = new Promise<void>((resolve) => { releaseResponse = resolve })
    let draining = false
    const server = createServer(withHttpDrainGate(async (_request, response) => {
      requestStarted()
      await release
      response.end('completed')
    }, () => draining))
    const baseUrl = await listen(server)

    const activeResponse = fetch(baseUrl, { headers: { connection: 'close' } })
    await started
    draining = true
    const shutdown = drainHttpServer(server, 1_000)
    releaseResponse()

    expect(await (await activeResponse).text()).toBe('completed')
    await expect(shutdown).resolves.toBe('drained')
  })

  it('returns a bounded retryable response for work arriving after drain starts', async () => {
    let draining = false
    const server = createServer(withHttpDrainGate((_request, response) => response.end('handled'), () => draining))
    const baseUrl = await listen(server)
    draining = true

    const response = await fetch(baseUrl)
    expect(response.status).toBe(503)
    expect(response.headers.get('connection')).toBe('close')
    expect(await response.json()).toEqual({ error: 'API is shutting down' })
    await expect(drainHttpServer(server, 1_000)).resolves.toBe('drained')
  })

  it('closes active connections when the drain deadline expires', async () => {
    let requestStarted!: () => void
    const started = new Promise<void>((resolve) => { requestStarted = resolve })
    const server = createServer(() => { requestStarted() })
    const baseUrl = await listen(server)
    const activeResponse = fetch(baseUrl)
    await started

    await expect(drainHttpServer(server, 25)).resolves.toBe('forced')
    await expect(activeResponse).rejects.toThrow()
  })
})
