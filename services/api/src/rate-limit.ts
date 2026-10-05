import type { RequestHandler } from 'express'

export interface ApiRateLimitOptions {
  windowMs: number
  maxRequests: number
  maxClients: number
}

export const DEFAULT_API_RATE_LIMIT_OPTIONS: ApiRateLimitOptions = {
  windowMs: 60_000,
  maxRequests: 120,
  maxClients: 10_000
}

export function createApiRateLimiter(options: Partial<ApiRateLimitOptions> = {}): RequestHandler {
  const { windowMs, maxRequests, maxClients } = { ...DEFAULT_API_RATE_LIMIT_OPTIONS, ...options }
  if (windowMs <= 0 || maxRequests <= 0 || maxClients <= 0) {
    throw new Error('API rate-limit values must be positive.')
  }

  const clients = new Map<string, { windowStartedAt: number; requestCount: number }>()

  return (request, response, next) => {
    const now = Date.now()
    const client = request.ip ?? request.socket.remoteAddress ?? 'unknown'
    const current = clients.get(client)

    if (!current || now - current.windowStartedAt >= windowMs) {
      if (!current && clients.size >= maxClients) {
        const leastRecentlyUsed = clients.keys().next().value
        if (leastRecentlyUsed !== undefined) clients.delete(leastRecentlyUsed)
      }
      clients.delete(client)
      clients.set(client, { windowStartedAt: now, requestCount: 1 })
      next()
      return
    }

    if (current.requestCount >= maxRequests) {
      const retryAfter = Math.max(1, Math.ceil((windowMs - (now - current.windowStartedAt)) / 1000))
      response.setHeader('Retry-After', String(retryAfter))
      response.status(429).json({ error: 'Too many API requests; retry later.' })
      return
    }

    clients.delete(client)
    clients.set(client, { ...current, requestCount: current.requestCount + 1 })
    next()
  }
}
