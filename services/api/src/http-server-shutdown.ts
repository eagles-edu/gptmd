import type { RequestListener, Server } from 'node:http'

export const API_SHUTDOWN_DRAIN_TIMEOUT_MS = 25_000

export type HttpServerShutdownResult = 'drained' | 'forced'

/** Reject requests arriving on already-open keep-alive sockets after drain starts. */
export function withHttpDrainGate(handler: RequestListener, isDraining: () => boolean): RequestListener {
  return (request, response) => {
    if (!isDraining()) {
      handler(request, response)
      return
    }
    response.writeHead(503, {
      connection: 'close',
      'content-type': 'application/json; charset=utf-8'
    })
    response.end(JSON.stringify({ error: 'API is shutting down' }))
  }
}

/** Stop accepting work, let active HTTP requests finish, then close remaining sockets at the deadline. */
export function drainHttpServer(
  server: Server,
  timeoutMs = API_SHUTDOWN_DRAIN_TIMEOUT_MS
): Promise<HttpServerShutdownResult> {
  return new Promise((resolve, reject) => {
    let forced = false
    const timeout = setTimeout(() => {
      forced = true
      server.closeAllConnections()
    }, timeoutMs)
    timeout.unref()

    server.close((error) => {
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve(forced ? 'forced' : 'drained')
    })
  })
}
