import { Pool } from 'pg'
import { createClient } from 'redis'
import { createSessionEventWorker } from './session-event-worker.ts'

if (!process.env.REDIS_URL || !process.env.DATABASE_URL) {
  throw new Error('REDIS_URL and DATABASE_URL are required for the session history worker')
}

const redis = createClient({
  url: process.env.REDIS_URL,
  socket: {
    connectTimeout: 2_000,
    reconnectStrategy: (retries) => retries < 3 ? 250 : false
  }
})
redis.on('error', () => undefined)

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000
})
pool.on('error', () => undefined)

const abort = new AbortController()
const worker = createSessionEventWorker(redis, pool, {
  onError: () => process.stderr.write('Session history worker batch failed; uncommitted stream entries remain pending for retry.\n')
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => abort.abort())
}

try {
  await worker.run(abort.signal)
} finally {
  await Promise.all([
    redis.isOpen ? redis.quit() : Promise.resolve(),
    pool.end()
  ])
}
