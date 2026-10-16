import { createHmac, timingSafeEqual } from 'node:crypto'
import { execFile as execFileCallback } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const execFile = promisify(execFileCallback)
const SERVICES = Object.freeze({
  web: 'gptmd-live-web.service',
  api: 'gptmd-live-api.service',
  worker: 'gptmd-live-worker.service'
})
const SAFE_EVENTS = new Set([
  'process_resource_metrics', 'session_state_event_commit_metrics',
  'session_event_worker_metrics', 'session_archive_worker_metrics',
  'session_identity_verification', 'audio_transcription_expiry_worker_metrics',
  'patient_scenario_conversation_cleanup_metrics'
])
const SAFE_LOG_FIELDS = new Set([
  'event', 'component', 'observedAt', 'intervalMs', 'cpuUserMs', 'cpuSystemMs',
  'cpuPercentOfOneCore', 'rssBytes', 'heapTotalBytes', 'heapUsedBytes', 'externalBytes',
  'operations', 'count', 'durationMs', 'p50Ms', 'p95Ms', 'archived', 'expired',
  'checked', 'mismatches', 'redisUnavailable', 'completedCalls', 'completedConversations',
  'pending', 'failed', 'inFlight', 'oldestAgeMs'
])
const RESTART_COOLDOWN_MS = 30_000
let lastRestartAt = 0
let lastRotationAt = 0
const seenNonces = new Map()

function hasValidSignature(body, signature, key) {
  if (typeof body !== 'string' || typeof signature !== 'string' || !key || Buffer.byteLength(key) < 32) return false
  const expected = createHmac('sha256', key).update(body).digest()
  let provided
  try {
    provided = Buffer.from(signature, 'hex')
  } catch {
    return false
  }
  return provided.length === expected.length && timingSafeEqual(expected, provided)
}

export function safeLogEntry(entry) {
  const rawTimestamp = typeof entry.__REALTIME_TIMESTAMP === 'string'
    ? new Date(Number(entry.__REALTIME_TIMESTAMP) / 1000)
    : new Date()
  const timestamp = Number.isNaN(rawTimestamp.getTime()) ? new Date().toISOString() : rawTimestamp.toISOString()
  const priorityValue = Number(entry.PRIORITY)
  const priority = Number.isInteger(priorityValue) && priorityValue >= 0 && priorityValue <= 7
    ? priorityValue : null
  let event = null
  let message = 'Operational message omitted'
  if (typeof entry.MESSAGE === 'string') {
    try {
      const parsed = JSON.parse(entry.MESSAGE)
      if (parsed && typeof parsed === 'object' && SAFE_EVENTS.has(parsed.event)) {
        event = parsed.event
        const filtered = Object.fromEntries(Object.entries(parsed)
          .filter(([key, value]) => SAFE_LOG_FIELDS.has(key) && (typeof value === 'string' || typeof value === 'number')))
        message = JSON.stringify(filtered)
      }
    } catch {
      // Non-structured logs may contain request or patient data; keep only their priority and time.
    }
  }
  return { timestamp, priority, event, message }
}

async function readUnit(service) {
  const unit = SERVICES[service]
  const { stdout } = await execFile('/usr/bin/systemctl', [
    'show', unit, '--no-pager',
    '--property=ActiveState,SubState,ActiveEnterTimestamp,NRestarts,MemoryCurrent,CPUUsageNSec'
  ], { timeout: 2_000, maxBuffer: 16_384 })
  const values = Object.fromEntries(stdout.trim().split('\n').map((line) => {
    const separator = line.indexOf('=')
    return separator < 0 ? ['', ''] : [line.slice(0, separator), line.slice(separator + 1)]
  }))
  const numberOrNull = (value) => value && /^\d+$/.test(value) ? Number(value) : null
  return {
    service,
    activeState: values.ActiveState || 'unknown',
    subState: values.SubState || 'unknown',
    activeSince: values.ActiveEnterTimestamp || null,
    restartCount: numberOrNull(values.NRestarts) ?? 0,
    memoryBytes: numberOrNull(values.MemoryCurrent),
    cpuNanoseconds: numberOrNull(values.CPUUsageNSec)
  }
}

async function readLogs(service, limit) {
  const { stdout } = await execFile('/usr/bin/journalctl', [
    '--namespace=gptmd-live', '-u', SERVICES[service], '-n', String(limit),
    '--output=json', '--no-pager', '--quiet'
  ], { timeout: 3_000, maxBuffer: 1_000_000 })
  return stdout.split('\n').filter(Boolean).map((line) => {
    try { return safeLogEntry(JSON.parse(line)) } catch { return null }
  }).filter(Boolean)
}

async function executeRequest(request) {
  if (!request || !['overview', 'logs', 'restart', 'rotate-logs'].includes(request.action)) {
    return { ok: false, error: 'invalid_request' }
  }
  if (request.action !== 'rotate-logs' && !Object.hasOwn(SERVICES, request.service) && request.action !== 'overview') {
    return { ok: false, error: 'invalid_request' }
  }
  if (request.action === 'overview') {
    const units = await Promise.all(Object.keys(SERVICES).map(readUnit))
    return { ok: true, units, completedAt: new Date().toISOString() }
  }
  if (request.action === 'logs') {
    const limit = Number(request.limit)
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) return { ok: false, error: 'invalid_request' }
    return { ok: true, units: [], logs: await readLogs(request.service, limit) }
  }
  if (request.action === 'restart') {
    const now = Date.now()
    if (now - lastRestartAt < RESTART_COOLDOWN_MS) return { ok: false, error: 'rate_limited' }
    lastRestartAt = now
    await execFile('/usr/bin/systemctl', ['restart', SERVICES[request.service]], { timeout: 20_000 })
    return { ok: true, units: [await readUnit(request.service)], completedAt: new Date().toISOString() }
  }
  if (Date.now() - lastRotationAt < 60_000) return { ok: false, error: 'rate_limited' }
  lastRotationAt = Date.now()
  await execFile('/usr/bin/journalctl', ['--namespace=gptmd-live', '--rotate'], { timeout: 5_000 })
  return { ok: true, units: [], completedAt: new Date().toISOString() }
}

export async function handleOperatorLine(line, key) {
  let envelope
  try { envelope = JSON.parse(line) } catch { return { ok: false, error: 'invalid_request' } }
  if (!hasValidSignature(envelope.body, envelope.signature, key)) return { ok: false, error: 'invalid_request' }
  let request
  try { request = JSON.parse(envelope.body) } catch { return { ok: false, error: 'invalid_request' } }
  if (typeof request.issuedAt !== 'number' || !Number.isSafeInteger(request.issuedAt) || Math.abs(Date.now() - request.issuedAt) > 30_000 ||
      typeof request.nonce !== 'string' || !/^[0-9a-f-]{36}$/.test(request.nonce) ||
      typeof request.actor !== 'string' || !/^[A-Za-z0-9._:@-]{1,200}$/.test(request.actor) ||
      typeof request.requestId !== 'string' || !/^[0-9a-f-]{36}$/.test(request.requestId)) {
    return { ok: false, error: 'invalid_request' }
  }
  for (const [nonce, expiresAt] of seenNonces) {
    if (expiresAt <= Date.now()) seenNonces.delete(nonce)
  }
  if (seenNonces.has(request.nonce)) return { ok: false, error: 'invalid_request' }
  seenNonces.set(request.nonce, request.issuedAt + 30_000)
  try {
    const result = await executeRequest(request)
    process.stderr.write(`${JSON.stringify({
      event: 'gptmd_system_operation', occurredAt: new Date().toISOString(),
      actor: request.actor, requestId: request.requestId, action: request.action,
      service: SERVICES[request.service] ?? null, result: result.ok ? 'completed' : result.error
    })}\n`)
    return result
  } catch {
    process.stderr.write(`${JSON.stringify({
      event: 'gptmd_system_operation', occurredAt: new Date().toISOString(),
      actor: request.actor, requestId: request.requestId, action: request.action,
      service: SERVICES[request.service] ?? null, result: 'operation_failed'
    })}\n`)
    return { ok: false, error: 'operation_failed' }
  }
}

async function run() {
  const key = readFileSync('/etc/gptmd-ops/hmac-key', 'utf8').trim()
  if (!key || Buffer.byteLength(key) < 32) throw new Error('Operator signing key is unavailable')
  const server = createServer((socket) => {
    socket.setEncoding('utf8')
    let input = ''
    let finished = false
    const fail = () => {
      if (finished) return
      finished = true
      socket.destroy()
    }
    socket.setTimeout(5_000, fail)
    socket.on('data', async (chunk) => {
      if (finished) return
      input += chunk
      if (Buffer.byteLength(input) > 32_768) return fail()
      const newline = input.indexOf('\n')
      if (newline < 0) return
      finished = true
      const result = await handleOperatorLine(input.slice(0, newline), key)
      socket.end(`${JSON.stringify(result)}\n`)
    })
    socket.on('error', () => { finished = true })
  })
  server.on('error', (error) => {
    process.stderr.write(`GPTMD operator socket failed: ${error.message}\n`)
    process.exitCode = 1
  })
  server.listen({ fd: 3 })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch(() => {
    process.stdout.write('{"ok":false,"error":"operation_failed"}\n')
    process.exitCode = 1
  })
}
