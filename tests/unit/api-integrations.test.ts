import { once } from 'node:events'
import type { Server } from 'node:http'
import { createHmac, randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiApp, type ApiDependencies } from '../../services/api/src/app.js'
import { createServiceClients, realtimeTranscriptionSessionConfig } from '../../services/api/src/clients.js'
import type { AuthenticatedPrincipal } from '../../services/api/src/auth.ts'
import type { GeneratedPatientScenario, PatientScenarioVersionPins } from '../../services/api/src/patient-profile.ts'
import type { ProviderUsageSample } from '../../services/api/src/session-contracts.ts'
import type { PatientScenarioSetupResult, SessionRecord, SessionStore } from '../../services/api/src/session-store.ts'
import { createRedisRequestRateLimitStore, hashRateLimitKey } from '../../services/api/src/request-rate-limit.ts'
import {
  TEST_LEARNER_CHART_VITAL_SIGNS,
  TEST_PATIENT_PHYSICAL_EXAM_FINDINGS,
  TEST_PATIENT_VITAL_SIGNS
} from '../fixtures/patient-vital-signs.ts'

const jwtSecret = 'unit-test-secret-that-is-at-least-32-bytes-long'

function makeToken(overrides: Record<string, unknown> = {}): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  const header = encode({ alg: 'HS256', typ: 'JWT' })
  const claims = encode({
    sub: 'learner-1',
    tenant_id: 'tenant-a',
    iss: 'https://issuer.test',
    aud: 'gptmd-api',
    exp: Math.floor(Date.now() / 1000) + 300,
    ...overrides
  })
  const signature = createHmac('sha256', jwtSecret).update(`${header}.${claims}`).digest('base64url')
  return `${header}.${claims}.${signature}`
}

const authHeaders = () => ({ authorization: `Bearer ${makeToken()}`, 'content-type': 'application/json' })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
const sessionVersions: PatientScenarioVersionPins = {
  promptVersion: 'patient-scenario-prompt-v10',
  modelVersion: 'gpt-6-luna',
  schemaVersion: 7,
  policyVersion: 'patient-scenario-policy-v3'
}

function createSessionStore(overrides: Partial<SessionStore> = {}): SessionStore {
  const sessionId = randomBytes(32).toString('base64url')
  const record: SessionRecord = {
    sessionId,
    status: 'initializing',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    versions: sessionVersions
  }
  return {
    getActiveMemberships: vi.fn().mockResolvedValue([
      { tenantId: 'tenant-a', role: 'learner' }, { tenantId: 'tenant-b', role: 'learner' }
    ]),
    consumeQuota: vi.fn().mockResolvedValue('allowed'),
    createAudioTranscriptionGrant: vi.fn().mockResolvedValue({ grantId: 'audio-grant-test' }),
    recordAudioProviderSession: vi.fn().mockResolvedValue(undefined),
    createSession: vi.fn().mockResolvedValue(record),
    setupScenario: vi.fn().mockResolvedValue('not_found'),
    submitPatientTurn: vi.fn().mockResolvedValue('not_found'),
    beginAssessment: vi.fn().mockResolvedValue('not_ready'),
    submitAssessment: vi.fn().mockResolvedValue('not_ready'),
    getOwnedSession: vi.fn().mockImplementation(async (principal: AuthenticatedPrincipal, id: string) =>
      principal.tenantId === 'tenant-a' && principal.subjectId === 'learner-1' && id === sessionId
        ? record
        : null
    ),
    getCurrentOwnedEncounter: vi.fn().mockResolvedValue(null),
    ...overrides
  }
}

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
  generatePatientTurn: vi.fn().mockResolvedValue({
    responseId: 'resp_turn_test',
    providerUsage: null,
    output: {
      patientResponse: 'I have been having pain.', proposedFacts: [], historyCoverage: [], disclosedHistoryFields: []
    }
  }),
  createTranscriptionCall: vi.fn().mockResolvedValue({
    answerSdp: 'mock-answer', providerCallId: 'call_provider_test', providerSessionId: 'sess_provider_test'
  }),
  hangupTranscriptionCall: vi.fn().mockResolvedValue(undefined),
  model: 'gpt-6-luna',
  jwt: { secret: jwtSecret, issuer: 'https://issuer.test', audience: 'gptmd-api' },
  sessionStore: createSessionStore(),
  requestRateLimitStore: { increment: vi.fn().mockResolvedValue({ count: 1, ttlSeconds: 60 }) },
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
  it('uses the current Realtime transcription language configuration', () => {
    expect(realtimeTranscriptionSessionConfig()).toEqual({
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24_000 },
          transcription: { model: 'gpt-live-transcribe', languages: ['en'] },
          turn_detection: null
        }
      }
    })
  })

  it('defaults the OpenAI model to GPT-6 Luna', async () => {
    const clients = createServiceClients({})

    expect(clients.dependencies.model).toBe('gpt-6-luna')
    expect(clients.dependencies.requestRateLimitLimits).toEqual({ windowSeconds: 60, perIp: 1_200, perIdentity: 300 })
    expect(clients.dependencies.requestRateLimitStore).toBeNull()
    await clients.close()
  })

  it('loads validated shared request rate-limit settings from the API environment', async () => {
    const clients = createServiceClients({
      API_RATE_LIMIT_WINDOW_SECONDS: '45',
      API_RATE_LIMIT_PER_IP: '900',
      API_RATE_LIMIT_PER_IDENTITY: '240'
    })
    expect(clients.dependencies.requestRateLimitLimits).toEqual({ windowSeconds: 45, perIp: 900, perIdentity: 240 })
    await clients.close()

    expect(() => createServiceClients({ API_RATE_LIMIT_PER_IP: '0' }))
      .toThrow('API_RATE_LIMIT_PER_IP must be an integer from 1 to 1000000')
  })

  it('runs each Redis rate-limit increment as one expiring atomic Lua operation', async () => {
    const sendCommand = vi.fn().mockResolvedValue([3, 42])
    const limiter = createRedisRequestRateLimitStore({ sendCommand })
    const key = hashRateLimitKey('ip', '192.0.2.10')

    await expect(limiter.increment(key, 60)).resolves.toEqual({ count: 3, ttlSeconds: 42 })
    expect(sendCommand).toHaveBeenCalledOnce()
    expect(sendCommand).toHaveBeenCalledWith(expect.arrayContaining([
      'EVAL', '1', key, '60'
    ]))
    const command = sendCommand.mock.calls[0]?.[0]?.join(' ')
    expect(command).toContain('redis.call(\'INCR\', KEYS[1])')
    expect(command).toContain('redis.call(\'EXPIRE\', KEYS[1], ARGV[1])')
    expect(key).not.toContain('192.0.2.10')
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
        dependencies: { redis: 'unavailable', postgres: 'unavailable', openai: 'missing', auth: 'configured' }
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
        dependencies: { redis: 'ready', postgres: 'ready', openai: 'configured', auth: 'configured' }
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
      expect(body.dependencies).toEqual({ redis: 'unavailable', postgres: 'ready', openai: 'configured', auth: 'configured' })
      expect(JSON.stringify(body)).not.toContain('private')
      expect(dependencies.redis?.connect).toHaveBeenCalledOnce()
    })
  })

  it('validates input before sending it to the OpenAI SDK', async () => {
    const dependencies = createDependencies()
    await withApi(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/openai/responses`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ input: '   ' })
      })
      expect(response.status).toBe(400)
      expect(dependencies.generateResponse).not.toHaveBeenCalled()
    })
  })

  it('returns SDK output without logging or exposing upstream errors', async () => {
    const generateResponse = vi.fn(async (
      _input: string,
      recordTiming?: (stage: 'first_token' | 'completed', elapsedMs: number) => void
    ) => {
      recordTiming?.('first_token', 10)
      recordTiming?.('completed', 20)
      return { id: 'resp_test', outputText: 'A test response.' }
    })
    const dependencies = createDependencies({ generateResponse })

    await withApi(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/openai/responses`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ input: 'Use fictional data.' })
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ id: 'resp_test', outputText: 'A test response.' })
      expect(response.headers.get('server-timing')).toMatch(
        /^interactive_capacity_wait;dur=\d+\.\d{3}, responses_first_token;dur=10\.000, responses_completion;dur=20\.000$/
      )
      expect(generateResponse).toHaveBeenCalledWith('Use fictional data.', expect.any(Function))
    })

    const failingDependencies = createDependencies({
      generateResponse: vi.fn().mockRejectedValue(new Error('sensitive upstream detail'))
    })
    await withApi(failingDependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/openai/responses`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({ input: 'Use fictional data.' })
      })
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ error: 'OpenAI request failed' })
    })
  })

  it('rejects a learner turn before session quota or state work when interactive provider capacity is full', async () => {
    const pendingResponse = deferred<{ id: string; outputText: string }>()
    const generateResponse = vi.fn(() => pendingResponse.promise)
    const sessionStore = createSessionStore()
    const generatePatientTurn = vi.fn()
    await withApi(createDependencies({
      sessionStore,
      generateResponse,
      generatePatientTurn,
      providerCapacityLimits: {
        maxConcurrent: 1,
        reservedInteractive: 0,
        maxQueuedInteractive: 0,
        interactiveWaitTimeoutMs: 1_000,
        maxQueuedSetup: 0,
        setupWaitTimeoutMs: 1_000
      }
    }), async (baseUrl) => {
      const responseRequest = fetch(`${baseUrl}/api/openai/responses`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ input: 'Explain the symptom.' })
      })
      await vi.waitFor(() => expect(generateResponse).toHaveBeenCalledOnce())

      const turnResponse = await fetch(`${baseUrl}/api/sessions/${randomBytes(32).toString('base64url')}/turns`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ turnId: 'turn-capacity-0001', text: 'When did it start?' })
      })

      expect(turnResponse.status).toBe(503)
      expect(turnResponse.headers.get('retry-after')).toBe('1')
      expect(await turnResponse.json()).toEqual({
        error: 'Interactive response capacity is unavailable; retry with the same turnId.'
      })
      expect(sessionStore.submitPatientTurn).not.toHaveBeenCalled()
      expect(generatePatientTurn).not.toHaveBeenCalled()

      pendingResponse.resolve({ id: 'resp_test', outputText: 'A test response.' })
      expect((await responseRequest).status).toBe(200)
    })
  })

  it('requires a valid signed bearer token and active tenant membership for API routes', async () => {
    const sessionStore = createSessionStore({ getActiveMemberships: vi.fn().mockResolvedValue([]) })
    const dependencies = createDependencies({ sessionStore })
    await withApi(dependencies, async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/api/sessions`, { method: 'POST' })
      const invalid = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST', headers: { authorization: 'Bearer invalid' }
      })
      const inactive = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST', headers: { authorization: `Bearer ${makeToken()}` }
      })
      expect(missing.status).toBe(401)
      expect(invalid.status).toBe(401)
      expect(inactive.status).toBe(403)
      expect(sessionStore.createSession).not.toHaveBeenCalled()
    })
  })

  it.each([
    { scope: 'client IP', perIp: 1, perIdentity: 100, tokens: [makeToken(), makeToken({ sub: 'learner-2' })] },
    { scope: 'tenant identity', perIp: 100, perIdentity: 1, tokens: [makeToken(), makeToken()] }
  ])('applies the shared $scope rate limit before account route work', async ({ perIp, perIdentity, tokens }) => {
    const counts = new Map<string, number>()
    const increment = vi.fn(async (key: string, windowSeconds: number) => {
      const count = (counts.get(key) ?? 0) + 1
      counts.set(key, count)
      return { count, ttlSeconds: windowSeconds }
    })
    const dependencies = createDependencies({
      requestRateLimitStore: { increment },
      requestRateLimitLimits: { windowSeconds: 60, perIp, perIdentity }
    })

    await withApi(dependencies, async (baseUrl) => {
      const first = await fetch(`${baseUrl}/api/account/tenants`, {
        headers: { authorization: `Bearer ${tokens[0]}` }
      })
      expect(first.status).toBe(200)

      const limited = await fetch(`${baseUrl}/api/account/tenants`, {
        headers: { authorization: `Bearer ${tokens[1]}` }
      })
      expect(limited.status).toBe(429)
      expect(limited.headers.get('retry-after')).toBe('60')
      expect(await limited.json()).toEqual({ error: 'Too many requests; retry later' })
    })

    const keys = increment.mock.calls.map(([key]) => key)
    expect(keys.some((key) => key.startsWith('gptmd:api:rate:v1:ip:'))).toBe(true)
    expect(keys.some((key) => key.startsWith('gptmd:api:rate:v1:identity:'))).toBe(true)
    expect(keys.join(' ')).not.toContain('192.0.2')
    expect(keys.join(' ')).not.toContain('learner-1')
    expect(keys.join(' ')).not.toContain('tenant-a')
  })

  it('fails closed before API route work when the shared rate-limit store is unavailable', async () => {
    const sessionStore = createSessionStore()
    const requestRateLimitStore = {
      increment: vi.fn().mockRejectedValue(new Error('private Redis endpoint detail'))
    }
    await withApi(createDependencies({ sessionStore, requestRateLimitStore }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST', headers: authHeaders(), body: '{}'
      })
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: 'Request rate limiting is unavailable' })
      expect(sessionStore.createSession).not.toHaveBeenCalled()
      expect(requestRateLimitStore.increment).toHaveBeenCalledOnce()
      expect(JSON.stringify(requestRateLimitStore.increment.mock.calls)).not.toContain('127.0.0.1')
    })
  })

  it.each(['instructor', 'customer_admin'] as const)(
    'loads the active %s role and denies non-learners from encounter routes', async (role) => {
      const getActiveMemberships = vi.fn().mockResolvedValue([{ tenantId: 'tenant-a', role }])
      const sessionStore = createSessionStore({ getActiveMemberships })
      await withApi(createDependencies({ sessionStore }), async (baseUrl) => {
        const response = await fetch(`${baseUrl}/api/sessions`, {
          method: 'POST', headers: authHeaders()
        })

        expect(getActiveMemberships).toHaveBeenCalledWith('learner-1')
        expect(response.status).toBe(403)
        expect(await response.json()).toEqual({ error: 'Learner role is required for encounter API routes' })
        expect(sessionStore.createSession).not.toHaveBeenCalled()
      })
    }
  )

  it('denies scenario setup when the tenant session entitlement has been revoked', async () => {
    const sessionStore = createSessionStore({ setupScenario: vi.fn().mockResolvedValue('entitlement_denied') })
    await withApi(createDependencies({
      sessionStore,
      generatePatientScenario: vi.fn().mockResolvedValue({}) as ApiDependencies['generatePatientScenario']
    }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/${randomBytes(32).toString('base64url')}/setup`, {
        method: 'POST',
        headers: { ...authHeaders(), 'idempotency-key': 'setup-key-0001' }
      })

      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'Tenant plan does not include this capability' })
      expect(sessionStore.setupScenario).toHaveBeenCalledOnce()
    })
  })

  it('returns retryable overload before invoking setup when active capacity is full', async () => {
    let finishSetup!: (result: 'not_found') => void
    const pendingSetup = new Promise<'not_found'>((resolve) => { finishSetup = resolve })
    const setupScenario = vi.fn(() => pendingSetup)
    const sessionStore = createSessionStore({ setupScenario })
    await withApi(createDependencies({
      sessionStore,
      setupQueueLimits: { maxConcurrent: 1, maxQueued: 0, waitTimeoutMs: 1_000 },
      generatePatientScenario: vi.fn() as ApiDependencies['generatePatientScenario']
    }), async (baseUrl) => {
      const setupUrl = () => `${baseUrl}/api/sessions/${randomBytes(32).toString('base64url')}/setup`
      const firstResponse = fetch(setupUrl(), {
        method: 'POST', headers: { ...authHeaders(), 'idempotency-key': 'setup-first-0001' }
      })
      await vi.waitFor(() => expect(setupScenario).toHaveBeenCalledOnce())

      const overloaded = await fetch(setupUrl(), {
        method: 'POST', headers: { ...authHeaders(), 'idempotency-key': 'setup-second-001' }
      })
      expect(overloaded.status).toBe(503)
      expect(overloaded.headers.get('retry-after')).toBe('1')
      expect(await overloaded.json()).toEqual({
        error: 'Patient setup capacity is unavailable; retry with the same Idempotency-Key.'
      })
      expect(overloaded.headers.get('server-timing')).toMatch(/^setup_queue_wait;dur=\d+\.\d{3}$/)
      expect(setupScenario).toHaveBeenCalledOnce()

      finishSetup('not_found')
      expect((await firstResponse).status).toBe(404)
    })
  })

  it('creates and durably schedules a provider call only after consent and tenant authorization', async () => {
    const sessionStore = createSessionStore()
    const createTranscriptionCall = vi.fn().mockResolvedValue({
      answerSdp: 'mock-answer', providerCallId: 'call_provider_test', providerSessionId: 'sess_provider_test'
    })
    const hangupTranscriptionCall = vi.fn().mockResolvedValue(undefined)
    await withApi(createDependencies({ sessionStore, createTranscriptionCall, hangupTranscriptionCall }), async (baseUrl) => {
      const url = `${baseUrl}/api/sessions/${randomBytes(32).toString('base64url')}/audio-transcription`
      const denied = await fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) })
      expect(denied.status).toBe(400)
      expect(createTranscriptionCall).not.toHaveBeenCalled()

      const response = await fetch(url, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ consentVersion: 'gptmd-audio-transcription-v1', sdp: 'v=0\\r\\n' })
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        answerSdp: 'mock-answer', maxDurationSeconds: 900
      })
      expect(sessionStore.createAudioTranscriptionGrant).toHaveBeenCalledWith(
        { subjectId: 'learner-1', tenantId: 'tenant-a', role: 'learner' },
        expect.any(String), 'gptmd-audio-transcription-v1'
      )
      expect(sessionStore.recordAudioProviderSession).toHaveBeenCalledWith(
        'audio-grant-test', 'sess_provider_test', 'call_provider_test'
      )
      expect(createTranscriptionCall).toHaveBeenCalledWith('v=0\\r\\n')
    })
  })

  it('does not mint a provider credential when tenant audio approval is denied', async () => {
    const sessionStore = createSessionStore({ createAudioTranscriptionGrant: vi.fn().mockResolvedValue('entitlement_denied') })
    const createTranscriptionCall = vi.fn()
    await withApi(createDependencies({ sessionStore, createTranscriptionCall }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/${randomBytes(32).toString('base64url')}/audio-transcription`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ consentVersion: 'gptmd-audio-transcription-v1', sdp: 'v=0\\r\\n' })
      })
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        error: 'Tenant plan or audio privacy approval does not allow voice transcription'
      })
      expect(createTranscriptionCall).not.toHaveBeenCalled()
      expect(sessionStore.recordAudioProviderSession).not.toHaveBeenCalled()
    })
  })

  it('hangs up a provider call if its expiry metadata cannot be committed', async () => {
    const sessionStore = createSessionStore({ recordAudioProviderSession: vi.fn().mockRejectedValue(new Error('database unavailable')) })
    const hangupTranscriptionCall = vi.fn().mockResolvedValue(undefined)
    await withApi(createDependencies({ sessionStore, hangupTranscriptionCall }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/${randomBytes(32).toString('base64url')}/audio-transcription`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ consentVersion: 'gptmd-audio-transcription-v1', sdp: 'v=0\\r\\n' })
      })
      expect(response.status).toBe(503)
      expect(hangupTranscriptionCall).toHaveBeenCalledWith('call_provider_test')
    })
  })

  it('rejects oversized SDP before granting audio transcription', async () => {
    const sessionStore = createSessionStore()
    const createTranscriptionCall = vi.fn()
    await withApi(createDependencies({ sessionStore, createTranscriptionCall }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/${randomBytes(32).toString('base64url')}/audio-transcription`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ consentVersion: 'gptmd-audio-transcription-v1', sdp: 'x'.repeat(128_001) })
      })
      expect(response.status).toBe(400)
      expect(sessionStore.createAudioTranscriptionGrant).not.toHaveBeenCalled()
      expect(createTranscriptionCall).not.toHaveBeenCalled()
    })
  })

  it('resolves Supabase identities against GPTMD memberships and rejects unlisted tenant headers', async () => {
    const getActiveMemberships = vi.fn().mockResolvedValue([
      { tenantId: 'tenant-a', role: 'instructor' }, { tenantId: 'tenant-b', role: 'learner' }
    ])
    const sessionStore = createSessionStore({ getActiveMemberships })
    const dependencies = createDependencies({ sessionStore })
    await withApi(dependencies, async (baseUrl) => {
      const token = makeToken({ tenant_id: undefined })
      const tenants = await fetch(`${baseUrl}/api/account/tenants`, {
        headers: { authorization: `Bearer ${token}` }
      })
      expect(tenants.status).toBe(200)
      expect(await tenants.json()).toEqual({ memberships: [
        { tenantId: 'tenant-a', role: 'instructor' }, { tenantId: 'tenant-b', role: 'learner' }
      ] })

      const missingSelection = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST', headers: { authorization: `Bearer ${token}` }
      })
      expect(missingSelection.status).toBe(409)

      const selected = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'x-gptmd-tenant-id': 'tenant-b' }
      })
      expect(selected.status).toBe(201)
      expect(sessionStore.createSession).toHaveBeenCalledWith(
        { subjectId: 'learner-1', tenantId: 'tenant-b', role: 'learner' },
        sessionVersions
      )

      const unlisted = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'x-gptmd-tenant-id': 'tenant-c' }
      })
      expect(unlisted.status).toBe(403)
    })
  })

  it('selects a sole membership automatically and permits only configured browser origins', async () => {
    const sessionStore = createSessionStore({
      getActiveMemberships: vi.fn().mockResolvedValue([{ tenantId: 'tenant-only', role: 'learner' }])
    })
    const dependencies = createDependencies({
      sessionStore,
      allowedOrigins: ['https://gptmd.example.test']
    })
    await withApi(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${makeToken({ tenant_id: undefined })}`,
          origin: 'https://gptmd.example.test'
        }
      })
      expect(response.status).toBe(201)
      expect(response.headers.get('access-control-allow-origin')).toBe('https://gptmd.example.test')
      expect(sessionStore.createSession).toHaveBeenCalledWith(
        { subjectId: 'learner-1', tenantId: 'tenant-only', role: 'learner' },
        sessionVersions
      )

      const allowed = await fetch(`${baseUrl}/api/sessions`, {
        method: 'OPTIONS',
        headers: {
          origin: 'https://gptmd.example.test',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'authorization,x-gptmd-tenant-id'
        }
      })
      expect(allowed.status).toBe(204)
      expect(allowed.headers.get('access-control-allow-origin')).toBe('https://gptmd.example.test')

      const rejected = await fetch(`${baseUrl}/api/sessions`, {
        method: 'OPTIONS',
        headers: { origin: 'https://other.example.test', 'access-control-request-method': 'POST' }
      })
      expect(rejected.status).toBe(403)
      expect(rejected.headers.get('access-control-allow-origin')).toBeNull()

      const createsBeforeRejectedRequest = sessionStore.createSession.mock.calls.length
      const rejectedRequest = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${makeToken({ tenant_id: undefined })}`,
          origin: 'https://other.example.test',
          'content-type': 'application/json'
        },
        body: '{}'
      })
      expect(rejectedRequest.status).toBe(403)
      expect(await rejectedRequest.json()).toEqual({ error: 'Origin is not allowed' })
      expect(sessionStore.createSession).toHaveBeenCalledTimes(createsBeforeRejectedRequest)
    })
  })

  it('rejects oversized and malformed JSON with bounded responses', async () => {
    await withApi(createDependencies(), async (baseUrl) => {
      const oversized = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ padding: 'x'.repeat(1_048_576) })
      })
      expect(oversized.status).toBe(413)
      expect(oversized.headers.get('content-type')).toContain('application/json')
      expect(await oversized.json()).toEqual({ error: 'Request body exceeds the 1 MB limit' })

      const malformed = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{"unterminated":'
      })
      expect(malformed.status).toBe(400)
      expect(await malformed.json()).toEqual({ error: 'Request body must contain valid JSON' })
    })
  })

  it('keeps API routes unavailable until issuer and signing-key configuration is complete', async () => {
    const dependencies = createDependencies({
      jwt: { secret: null, issuer: null, audience: null }
    })
    await withApi(dependencies, async (baseUrl) => {
      const readiness = await fetch(`${baseUrl}/readyz`)
      const response = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST', headers: { authorization: `Bearer ${makeToken()}` }
      })
      expect(readiness.status).toBe(503)
      expect((await readiness.json()).dependencies.auth).toBe('missing')
      expect(response.status).toBe(503)
    })
  })

  it('creates an opaque tenant session and hides sessions owned by another principal', async () => {
    const sessionStore = createSessionStore()
    const dependencies = createDependencies({ sessionStore })
    await withApi(dependencies, async (baseUrl) => {
      const created = await fetch(`${baseUrl}/api/sessions`, { method: 'POST', headers: authHeaders() })
      const body = await created.json()
      expect(created.status).toBe(201)
      expect(body.sessionId).toMatch(/^[A-Za-z0-9_-]{43}$/)
      expect(body.sessionId).not.toContain('learner')
      expect(sessionStore.createSession).toHaveBeenCalledWith(
        { subjectId: 'learner-1', tenantId: 'tenant-a', role: 'learner' },
        sessionVersions
      )

      const visible = await fetch(`${baseUrl}/api/sessions/${body.sessionId}`, { headers: authHeaders() })
      expect(visible.status).toBe(200)

      const otherOwner = await fetch(`${baseUrl}/api/sessions/${body.sessionId}`, {
        headers: { authorization: `Bearer ${makeToken({ sub: 'learner-2' })}` }
      })
      expect(otherOwner.status).toBe(404)
      const otherTenant = await fetch(`${baseUrl}/api/sessions/${body.sessionId}`, {
        headers: { authorization: `Bearer ${makeToken({ tenant_id: 'tenant-b' })}` }
      })
      expect(otherTenant.status).toBe(404)
    })
  })

  it('pins setup versions at session creation and returns one private-safe result for concurrent retries', async () => {
    const sessionId = randomBytes(32).toString('base64url')
    const generated: GeneratedPatientScenario = {
      conversationId: 'conv_internal_only',
      responseId: 'resp_internal_only',
      profile: {
        fullName: 'Ari Nguyen',
        dateOfBirth: '1990-01-01',
        bodyType: 'average',
        reasonForVisit: 'Pelvic pain',
        diagnosis: 'Endometriosis',
        painHistoryStatus: 'absent',
        painEpisodes: [],
        history: [],
        vitalSigns: TEST_PATIENT_VITAL_SIGNS,
        physicalExamFindings: TEST_PATIENT_PHYSICAL_EXAM_FINDINGS,
        currentPregnancyStatus: 'unknown',
        currentMenopausalStatus: 'unknown',
        patientBeliefs: [],
        supportedExamFindings: [],
        supportedTestResults: [],
        persona: {
          mood: 'concerned',
          maturity: 'adult',
          verbosity: 'moderate',
          educationLevel: 'college',
          willingnessToDisclose: 'gradual'
        }
      },
      usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 50, totalTokens: 150, durationMs: 620 },
      abandonedConversationIds: []
    }
    const setupResponse: PatientScenarioSetupResult = {
      sessionId,
      status: 'ready',
      createdAt: '2026-10-01T00:01:00.000Z',
      patient: {
        fullName: 'Ari Nguyen',
        dateOfBirth: '1990-01-01',
        bodyType: 'average',
        reasonForVisit: 'Pelvic pain',
        vitalSigns: TEST_LEARNER_CHART_VITAL_SIGNS
      },
      versions: sessionVersions,
      readiness: { profile: true, redis: true, conversation: true }
    }
    const generatePatientScenario = vi.fn(async (
      _versions: PatientScenarioVersionPins,
      _asOf: Date,
      _seed: string,
      recordTiming?: (stage: 'first_token' | 'completed', elapsedMs: number) => void,
      recordProviderUsage?: (usage: ProviderUsageSample) => Promise<void>
    ) => {
      recordTiming?.('first_token', 11)
      recordTiming?.('completed', 22)
      await recordProviderUsage?.({
        responseId: 'resp-invalid-attempt', inputTokens: 310, cachedInputTokens: 30,
        outputTokens: 12, totalTokens: 322, durationMs: 450
      })
      return generated
    })
    let stored: PatientScenarioSetupResult | null = null
    let storedKey: string | null = null
    let pending: Promise<PatientScenarioSetupResult> | null = null
    const recordedProviderUsage: ProviderUsageSample[] = []
    const setupScenario = vi.fn(async (
      _principal: AuthenticatedPrincipal,
      _id: string,
      key: string,
      generate: (
        versions: PatientScenarioVersionPins,
        asOf: Date,
        seed: string,
        recordProviderUsage: (usage: ProviderUsageSample) => Promise<void>
      ) => Promise<GeneratedPatientScenario>
    ) => {
      if (stored) return storedKey === key ? stored : 'idempotency_conflict' as const
      if (!pending) {
        pending = (async () => {
          await generate(
            sessionVersions,
            new Date('2026-10-01T00:00:00.000Z'),
            'z'.repeat(43),
            async (usage) => { recordedProviderUsage.push(usage) }
          )
          return setupResponse
        })()
      }
      stored = await pending
      storedKey = key
      return stored
    })
    const sessionStore = createSessionStore({
      setupScenario,
      createSession: vi.fn().mockResolvedValue({
        sessionId,
        status: 'initializing',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
        versions: sessionVersions
      })
    })
    const dependencies = createDependencies({ sessionStore, generatePatientScenario })

    await withApi(dependencies, async (baseUrl) => {
      const created = await fetch(`${baseUrl}/api/sessions`, { method: 'POST', headers: authHeaders() })
      expect(created.status).toBe(201)
      expect(await created.json()).toMatchObject({ sessionId, versions: sessionVersions })

      const sendSetup = () => fetch(`${baseUrl}/api/sessions/${sessionId}/setup`, {
        method: 'POST',
        headers: { ...authHeaders(), 'idempotency-key': 'scenario-setup-1' }
      })
      const [first, duplicate] = await Promise.all([sendSetup(), sendSetup()])
      const firstBody = await first.json()
      const duplicateBody = await duplicate.json()
      expect(first.status).toBe(200)
      expect(duplicate.status).toBe(200)
      const timingHeaders = [first.headers.get('server-timing'), duplicate.headers.get('server-timing')]
      const generatedResponseTimings = timingHeaders.filter((timing) => timing?.includes('responses_first_token;dur=11.000'))
      const storedResponseTimings = timingHeaders.filter((timing) => !timing?.includes('responses_first_token;dur=11.000'))
      expect(generatedResponseTimings).toHaveLength(1)
      expect(generatedResponseTimings[0]).toContain('responses_completion;dur=22.000')
      expect(storedResponseTimings).toHaveLength(1)
      expect(storedResponseTimings[0]).toMatch(/^setup_queue_wait;dur=\d+\.\d{3}$/)
      expect(firstBody).toEqual(duplicateBody)
      expect(firstBody.patient).not.toHaveProperty('diagnosis')
      expect(firstBody).not.toHaveProperty('scenarioId')
      expect(firstBody.readiness).toEqual({ profile: true, redis: true, conversation: true })
      expect(JSON.stringify(firstBody)).not.toContain('conv_internal_only')
      expect(JSON.stringify(firstBody)).not.toContain('resp_internal_only')
      expect(generatePatientScenario).toHaveBeenCalledOnce()
      expect(generatePatientScenario).toHaveBeenCalledWith(
        sessionVersions, new Date('2026-10-01T00:00:00.000Z'), 'z'.repeat(43), expect.any(Function), expect.any(Function)
      )
      expect(recordedProviderUsage).toEqual([{
        responseId: 'resp-invalid-attempt', inputTokens: 310, cachedInputTokens: 30,
        outputTokens: 12, totalTokens: 322, durationMs: 450
      }])

      const conflicting = await fetch(`${baseUrl}/api/sessions/${sessionId}/setup`, {
        method: 'POST',
        headers: { ...authHeaders(), 'idempotency-key': 'scenario-setup-2' }
      })
      expect(conflicting.status).toBe(409)
    })
  })

  it('enforces capability entitlements and usage quotas before provider work', async () => {
    const generateResponse = vi.fn().mockResolvedValue({ id: 'resp_test', outputText: 'response' })
    const sessionStore = createSessionStore({
      consumeQuota: vi.fn().mockResolvedValue('quota_exceeded'),
      createSession: vi.fn().mockResolvedValue('entitlement_denied')
    })
    const dependencies = createDependencies({ sessionStore, generateResponse })
    await withApi(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/openai/responses`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ input: 'fictional case' })
      })
      const session = await fetch(`${baseUrl}/api/sessions`, { method: 'POST', headers: authHeaders() })
      expect(response.status).toBe(429)
      expect(session.status).toBe(403)
      expect(generateResponse).not.toHaveBeenCalled()
    })
  })

  it('routes a patient turn through the owned session store and returns the learner response shape', async () => {
    const sessionId = randomBytes(32).toString('base64url')
    const turnId = 'turn-0001'
    const submitPatientTurn = vi.fn().mockImplementation(async (...args: Parameters<SessionStore['submitPatientTurn']>) => {
      args[6]?.(2.5)
      args[7]?.('turn', 3.75)
      await args[4]({} as Parameters<NonNullable<typeof args[4]>>[0])
      return { status: 'accepted' as const, turnId, sequence: 1, patientResponse: 'I feel pain on my left side.' }
    })
    const sessionStore = createSessionStore({ submitPatientTurn })
    const generatePatientTurn = vi.fn(async (
      _context: Parameters<NonNullable<ApiDependencies['generatePatientTurn']>>[0],
      recordTiming?: (stage: 'first_token' | 'completed', elapsedMs: number) => void
    ) => {
      recordTiming?.('first_token', 12)
      recordTiming?.('completed', 24)
      return {
        responseId: 'resp-turn', providerUsage: null, output: {
        patientResponse: 'I feel pain on my left side.', proposedFacts: [],
        historyCoverage: [], disclosedHistoryFields: []
        }
      }
    })
    const recordSessionCommitTiming = vi.fn((_operation: string, _elapsedMs: number) => {
      throw new Error('metrics sink unavailable')
    })
    const dependencies = createDependencies({
      sessionStore, generatePatientTurn, recordSessionCommitTiming, allowedOrigins: ['https://gptmd.test']
    })

    await withApi(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/turns`, {
        method: 'POST', headers: { ...authHeaders(), origin: 'https://gptmd.test' },
        body: JSON.stringify({ turnId, text: 'Where does it hurt?', modality: 'realtime_transcription' })
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ turnId, text: 'I feel pain on my left side.' })
      expect(response.headers.get('server-timing')).toMatch(
        /^interactive_capacity_wait;dur=\d+\.\d{3}, session_lock_attempt;dur=2\.500, redis_turn_state_event_commit;dur=3\.750, responses_first_token;dur=12\.000, responses_completion;dur=24\.000$/
      )
      expect(response.headers.get('access-control-expose-headers')).toBe('Server-Timing')
      expect(recordSessionCommitTiming).toHaveBeenCalledWith('turn', 3.75)
      expect(submitPatientTurn).toHaveBeenCalledWith(
        { subjectId: 'learner-1', tenantId: 'tenant-a', role: 'learner' }, sessionId, turnId,
        'Where does it hurt?', expect.any(Function), 'realtime_transcription', expect.any(Function), expect.any(Function)
      )
    })
  })

  it('rejects malformed turn IDs and learner messages before provider work', async () => {
    const generatePatientTurn = vi.fn()
    const dependencies = createDependencies({ generatePatientTurn })

    await withApi(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/${'s'.repeat(43)}/turns`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ turnId: 'bad', text: 'Where does it hurt?' })
      })
      expect(response.status).toBe(400)
      expect(generatePatientTurn).not.toHaveBeenCalled()
    })
  })

  it('rejects an unknown transcript modality before provider work', async () => {
    const generatePatientTurn = vi.fn()
    const dependencies = createDependencies({ generatePatientTurn })

    await withApi(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/${'s'.repeat(43)}/turns`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ turnId: 'turn-0001', text: 'Where does it hurt?', modality: 'uploaded_audio' })
      })
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({ error: 'modality must be typed or realtime_transcription' })
      expect(generatePatientTurn).not.toHaveBeenCalled()
    })
  })

  it('validates assessment fields before storage and returns an unscored submission result', async () => {
    const sessionId = randomBytes(32).toString('base64url')
    const submitAssessment = vi.fn().mockImplementation(async (...args: Parameters<SessionStore['submitAssessment']>) => {
      args[4]?.('assessment', 3.75)
      return { assessmentId: 'assessment-1', status: 'unscored' as const, submittedAt: '2026-10-01T00:02:00.000Z' }
    })
    const beginAssessment = vi.fn().mockImplementation(async (...args: Parameters<SessionStore['beginAssessment']>) => {
      args[2]?.('phase', 1.25)
      return 'assessment' as const
    })
    const sessionStore = createSessionStore({
      beginAssessment,
      submitAssessment
    })

    await withApi(createDependencies({ sessionStore }), async (baseUrl) => {
      const phase = await fetch(`${baseUrl}/api/sessions/${sessionId}/assessment-phase`, {
        method: 'POST', headers: authHeaders()
      })
      expect(phase.status).toBe(200)
      expect(await phase.json()).toEqual({ sessionId, phase: 'assessment' })
      expect(phase.headers.get('server-timing')).toBe('redis_phase_state_event_commit;dur=1.250')

      const invalid = await fetch(`${baseUrl}/api/sessions/${sessionId}/assessment`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ assessmentId: 'assessment-1', summary: '', differential: 'Possible cyst', rationale: '', plan: 'Follow up' })
      })
      expect(invalid.status).toBe(422)
      expect((await invalid.json()).fieldErrors).toEqual({ summary: 'This field is required.', rationale: 'This field is required.' })
      expect(submitAssessment).not.toHaveBeenCalled()

      const valid = await fetch(`${baseUrl}/api/sessions/${sessionId}/assessment`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          assessmentId: 'assessment-1', summary: 'Pelvic pain', differential: 'Possible cyst',
          rationale: 'Acute onset', plan: 'Follow up'
        })
      })
      expect(valid.status).toBe(200)
      expect(await valid.json()).toEqual({
        assessmentId: 'assessment-1', status: 'unscored', submittedAt: '2026-10-01T00:02:00.000Z'
      })
      expect(valid.headers.get('server-timing')).toBe('redis_assessment_state_event_commit;dur=3.750')
      expect(submitAssessment).toHaveBeenCalledWith(
        { subjectId: 'learner-1', tenantId: 'tenant-a', role: 'learner' }, sessionId,
        'assessment-1', { summary: 'Pelvic pain', differential: 'Possible cyst', rationale: 'Acute onset', plan: 'Follow up' },
        expect.any(Function)
      )
    })
  })

  it('returns a retryable conflict when assessment mutations contend on the session lock', async () => {
    const sessionId = randomBytes(32).toString('base64url')
    const sessionStore = createSessionStore({
      beginAssessment: vi.fn().mockResolvedValue('turn_in_progress'),
      submitAssessment: vi.fn().mockResolvedValue('turn_in_progress')
    })

    await withApi(createDependencies({ sessionStore }), async (baseUrl) => {
      const phase = await fetch(`${baseUrl}/api/sessions/${sessionId}/assessment-phase`, {
        method: 'POST', headers: authHeaders()
      })
      expect(phase.status).toBe(409)
      expect(await phase.json()).toEqual({ error: 'Another action is being processed for this session' })

      const assessment = await fetch(`${baseUrl}/api/sessions/${sessionId}/assessment`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({
          assessmentId: 'assessment-1', summary: 'Pelvic pain', differential: 'Possible cyst',
          rationale: 'Acute onset', plan: 'Evaluate further'
        })
      })
      expect(assessment.status).toBe(409)
      expect(await assessment.json()).toEqual({ error: 'Another action is being processed for this session' })
    })
  })
})
