import { createHash } from 'node:crypto'

export interface RequestRateLimitStore {
  increment(key: string, windowSeconds: number): Promise<{ count: number; ttlSeconds: number }>
}

export interface RequestRateLimitLimits {
  windowSeconds: number
  perIp: number
  perIdentity: number
}

export const DEFAULT_REQUEST_RATE_LIMITS: RequestRateLimitLimits = {
  windowSeconds: 60,
  perIp: 1_200,
  perIdentity: 300
}

const incrementWindowScript = `
local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {count, ttl}
`

export function createRedisRequestRateLimitStore(redisClient: {
  sendCommand(command: string[]): Promise<unknown>
}): RequestRateLimitStore {
  return {
    async increment(key, windowSeconds) {
      const result = await redisClient.sendCommand([
        'EVAL', incrementWindowScript, '1', key, String(windowSeconds)
      ])
      if (!Array.isArray(result) || result.length !== 2) {
        throw new Error('Redis returned an invalid request rate-limit result')
      }
      const [countValue, ttlValue] = result
      const count = Number(countValue)
      const ttlSeconds = Number(ttlValue)
      if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(ttlSeconds) || ttlSeconds < 0) {
        throw new Error('Redis returned an invalid request rate-limit counter')
      }
      return { count, ttlSeconds }
    }
  }
}

export function hashRateLimitKey(scope: 'ip' | 'identity', value: string): string {
  const digest = createHash('sha256').update(value).digest('hex')
  return `gptmd:api:rate:v1:${scope}:${digest}`
}
