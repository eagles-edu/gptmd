import { createHmac, randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { z } from 'zod'

export const SYSTEM_SERVICES = ['web', 'api', 'worker'] as const
export type SystemService = typeof SYSTEM_SERVICES[number]
export type SystemOperation =
  | { action: 'overview'; actor: string; requestId: string }
  | { action: 'logs'; actor: string; requestId: string; service: SystemService; limit: number }
  | { action: 'restart'; actor: string; requestId: string; service: SystemService }
  | { action: 'rotate-logs'; actor: string; requestId: string }

const SystemdUnitSchema = z.object({
  service: z.enum(SYSTEM_SERVICES),
  activeState: z.string(),
  subState: z.string(),
  activeSince: z.string().nullable(),
  restartCount: z.number().int().nonnegative(),
  memoryBytes: z.number().int().nonnegative().nullable(),
  cpuNanoseconds: z.number().int().nonnegative().nullable()
})

const LogEntrySchema = z.object({
  timestamp: z.string(),
  priority: z.number().int().min(0).max(7).nullable(),
  event: z.string().nullable(),
  message: z.string()
})

const OperatorResponseSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    units: z.array(SystemdUnitSchema),
    logs: z.array(LogEntrySchema).optional(),
    completedAt: z.string().optional()
  }),
  z.object({ ok: z.literal(false), error: z.enum(['unavailable', 'invalid_request', 'operation_failed', 'rate_limited']) })
])

export type SystemUnitStatus = z.infer<typeof SystemdUnitSchema>
export type SanitizedSystemLog = z.infer<typeof LogEntrySchema>
export type SystemOperationsResult = z.infer<typeof OperatorResponseSchema>

export interface SystemOperationsClient {
  execute(operation: SystemOperation): Promise<SystemOperationsResult>
}

export function parseSystemAdminSubjects(value: string | undefined): ReadonlySet<string> {
  return new Set((value ?? '').split(',').map((subject) => subject.trim())
    .filter((subject) => /^[A-Za-z0-9._:@-]{1,200}$/.test(subject)))
}

export function createSystemOperationsClient(options: {
  socketPath?: string
  signingKey?: string
  timeoutMs?: number
}): SystemOperationsClient {
  const socketPath = options.socketPath ?? '/run/gptmd-ops.sock'
  const signingKey = options.signingKey
  const timeoutMs = options.timeoutMs ?? 3_000

  return {
    async execute(operation) {
      if (!signingKey || Buffer.byteLength(signingKey) < 32) {
        return { ok: false, error: 'unavailable' }
      }
      const body = JSON.stringify({ ...operation, issuedAt: Date.now(), nonce: randomUUID() })
      const signature = createHmac('sha256', signingKey).update(body).digest('hex')
      return await new Promise<SystemOperationsResult>((resolve) => {
        let settled = false
        const finish = (result: SystemOperationsResult) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          socket.destroy()
          resolve(result)
        }
        const socket = createConnection(socketPath)
        let response = ''
        const timer = setTimeout(() => finish({ ok: false, error: 'unavailable' }), timeoutMs)
        socket.setEncoding('utf8')
        socket.on('connect', () => socket.write(`${JSON.stringify({ body, signature })}\n`))
        socket.on('data', (chunk: string) => {
          response += chunk
          if (response.length > 256_000) finish({ ok: false, error: 'unavailable' })
        })
        socket.on('end', () => {
          try {
            finish(OperatorResponseSchema.parse(JSON.parse(response)))
          } catch {
            finish({ ok: false, error: 'unavailable' })
          }
        })
        socket.on('error', () => finish({ ok: false, error: 'unavailable' }))
      })
    }
  }
}

