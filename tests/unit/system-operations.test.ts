import { createHmac, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { createSystemOperationsClient, parseSystemAdminSubjects } from '../../services/api/src/system-operations.js'
import { handleOperatorLine, safeLogEntry } from '../../ops/gptmd-ops-agent.mjs'
import { validateKeyFileState } from '../../scripts/configure-live-ops.mjs'

const key = 'test-system-operations-signing-key-at-least-32-bytes'

function envelope(request: Record<string, unknown>, signingKey = key): string {
  const body = JSON.stringify(request)
  const signature = createHmac('sha256', signingKey).update(body).digest('hex')
  return JSON.stringify({ body, signature })
}

function request(overrides: Record<string, unknown> = {}) {
  return {
    action: 'invalid-action', actor: 'system-admin-1', requestId: randomUUID(),
    issuedAt: Date.now(), nonce: randomUUID(), ...overrides
  }
}

describe('GPTMD system operations boundary', () => {
  it('requires an existing operator key to remain private and readable only by its service group', () => {
    expect(() => validateKeyFileState({ contents: 'a'.repeat(64), uid: 0, gid: 991, mode: 0o100640 }, 991)).not.toThrow()
    expect(() => validateKeyFileState({ contents: 'short', uid: 0, gid: 991, mode: 0o100640 }, 991)).toThrow(/at least 32 random bytes/)
    expect(() => validateKeyFileState({ contents: 'a'.repeat(64), uid: 1000, gid: 991, mode: 0o100640 }, 991)).toThrow(/root-owned/)
    expect(() => validateKeyFileState({ contents: 'a'.repeat(64), uid: 0, gid: 991, mode: 0o100644 }, 991)).toThrow(/mode 0640/)
    expect(() => validateKeyFileState({ contents: 'a'.repeat(64), uid: 0, gid: 1000, mode: 0o100640 }, 991)).toThrow(/gptmd-ops/)
  })

  it('keeps the socket write side open until the delayed operator reply arrives', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gptmd-ops-socket-'))
    const socketPath = join(directory, 'ops.sock')
    const server = createServer((socket) => {
      let input = ''
      socket.setEncoding('utf8')
      socket.on('data', (chunk) => {
        input += chunk
        if (!input.includes('\n')) return
        const envelope = JSON.parse(input)
        const expected = createHmac('sha256', key).update(envelope.body).digest('hex')
        if (envelope.signature !== expected) {
          socket.end(JSON.stringify({ ok: false, error: 'invalid_request' }))
          return
        }
        setTimeout(() => socket.end(JSON.stringify({ ok: true, units: [] })), 30)
      })
    })

    try {
      await new Promise<void>((resolve) => server.listen(socketPath, resolve))
      const client = createSystemOperationsClient({ socketPath, signingKey: key })
      await expect(client.execute({ action: 'overview', actor: 'system-admin-1', requestId: randomUUID() }))
        .resolves.toEqual({ ok: true, units: [] })
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('parses only explicit, bounded system-admin subjects', () => {
    expect(parseSystemAdminSubjects('subject-1, subject@example.test, bad subject,')).toEqual(
      new Set(['subject-1', 'subject@example.test'])
    )
    expect(parseSystemAdminSubjects(undefined)).toEqual(new Set())
  })

  it('rejects tampered and expired signed requests before dispatch', async () => {
    const valid = envelope(request())
    const tampered = valid.replace('invalid-action', 'restart')
    expect(await handleOperatorLine(tampered, key)).toEqual({ ok: false, error: 'invalid_request' })

    expect(await handleOperatorLine(envelope(request({ issuedAt: Date.now() - 31_000 })), key))
      .toEqual({ ok: false, error: 'invalid_request' })
  })

  it('rejects replayed nonces before a previously captured request can become an operation', async () => {
    const first = request()
    expect(await handleOperatorLine(envelope(first), key)).toEqual({ ok: false, error: 'invalid_request' })
    const replay = { ...first, action: 'restart', service: 'api' }
    expect(await handleOperatorLine(envelope(replay), key)).toEqual({ ok: false, error: 'invalid_request' })
  })

  it('projects only approved operational log fields and omits unstructured message contents', () => {
    const safe = safeLogEntry({
      __REALTIME_TIMESTAMP: '1792080000000000', PRIORITY: '6',
      MESSAGE: JSON.stringify({
        event: 'process_resource_metrics', component: 'api', rssBytes: 4096,
        authorization: 'Bearer private-token', patientName: 'Private Person'
      })
    })
    expect(safe).toMatchObject({ priority: 6, event: 'process_resource_metrics' })
    expect(safe.message).toContain('"rssBytes":4096')
    expect(safe.message).not.toContain('authorization')
    expect(safe.message).not.toContain('Private Person')

    const unstructured = safeLogEntry({ PRIORITY: '3', MESSAGE: 'patient transcript: private' })
    expect(unstructured.message).toBe('Operational message omitted')
    expect(unstructured.message).not.toContain('private')
  })
})
