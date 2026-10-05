import { once } from 'node:events'
import type { Server } from 'node:http'
import { createHmac, randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiApp, type ApiDependencies } from '../../services/api/src/app.js'
import { createServiceClients, realtimeTranscriptionSessionConfig } from '../../services/api/src/clients.js'
import type { AuthenticatedPrincipal } from '../../services/api/src/auth.ts'
import type { GeneratedPatientScenario, PatientScenarioVersionPins } from '../../services/api/src/patient-profile.ts'
import type { PatientScenarioSetupResult, SessionRecord, SessionStore } from '../../services/api/src/session-store.ts'

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
const sessionVersions: PatientScenarioVersionPins = {
  promptVersion: 'patient-scenario-prompt-v3',
  modelVersion: 'gpt-6-luna',
  schemaVersion: 3,
  policyVersion: 'patient-scenario-policy-v1'
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
    getActiveTenantIds: vi.fn().mockResolvedValue(['tenant-a', 'tenant-b']),
    getActiveMembershipRole: vi.fn().mockResolvedValue('learner'),
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
    output: {
      patientResponse: 'I have been having pain.', proposedFacts: [], historyCoverage: [], disclosedHistoryFields: []
    }
  }),
  createTranscriptionCredential: vi.fn().mockResolvedValue({
    clientSecret: 'ephemeral-secret-test', expiresAt: 1_800_000_000, providerSessionId: 'sess_provider_test'
  }),
  model: 'gpt-6-luna',
  jwt: { secret: jwtSecret, issuer: 'https://issuer.test', audience: 'gptmd-api' },
  sessionStore: createSessionStore(),
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
    const generateResponse = vi.fn().mockResolvedValue({ id: 'resp_test', outputText: 'A test response.' })
    const dependencies = createDependencies({ generateResponse })

    await withApi(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/openai/responses`, {
        method: 'POST',
        headers: authHeaders(),
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
        headers: authHeaders(),
        body: JSON.stringify({ input: 'Use fictional data.' })
      })
      expect(response.status).toBe(502)
      expect(await response.json()).toEqual({ error: 'OpenAI request failed' })
    })
  })

  it('requires a valid signed bearer token and active tenant membership for API routes', async () => {
    const sessionStore = createSessionStore({ getActiveMembershipRole: vi.fn().mockResolvedValue(null) })
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

  it('loads the active tenant role and denies non-learners from encounter routes', async () => {
    const getActiveMembershipRole = vi.fn().mockResolvedValue('instructor')
    const sessionStore = createSessionStore({ getActiveMembershipRole })
    await withApi(createDependencies({ sessionStore }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST', headers: authHeaders()
      })

      expect(getActiveMembershipRole).toHaveBeenCalledWith('learner-1', 'tenant-a')
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({ error: 'Learner role is required for encounter API routes' })
      expect(sessionStore.createSession).not.toHaveBeenCalled()
    })
  })

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
      expect(setupScenario).toHaveBeenCalledOnce()

      finishSetup('not_found')
      expect((await firstResponse).status).toBe(404)
    })
  })

  it('mints a scoped transcription credential only after authenticated consent and tenant authorization', async () => {
    const sessionStore = createSessionStore()
    const createTranscriptionCredential = vi.fn().mockResolvedValue({
      clientSecret: 'ephemeral-secret-test', expiresAt: 1_800_000_000, providerSessionId: 'sess_provider_test'
    })
    await withApi(createDependencies({ sessionStore, createTranscriptionCredential }), async (baseUrl) => {
      const url = `${baseUrl}/api/sessions/${randomBytes(32).toString('base64url')}/audio-transcription`
      const denied = await fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify({}) })
      expect(denied.status).toBe(400)
      expect(createTranscriptionCredential).not.toHaveBeenCalled()

      const response = await fetch(url, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ consentVersion: 'gptmd-audio-transcription-v1' })
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({
        clientSecret: 'ephemeral-secret-test', expiresAt: 1_800_000_000, maxDurationSeconds: 900
      })
      expect(sessionStore.createAudioTranscriptionGrant).toHaveBeenCalledWith(
        { subjectId: 'learner-1', tenantId: 'tenant-a', role: 'learner' },
        expect.any(String), 'gptmd-audio-transcription-v1'
      )
      expect(sessionStore.recordAudioProviderSession).toHaveBeenCalledWith('audio-grant-test', 'sess_provider_test')
      expect(createTranscriptionCredential).toHaveBeenCalledOnce()
    })
  })

  it('does not mint a provider credential when tenant audio approval is denied', async () => {
    const sessionStore = createSessionStore({ createAudioTranscriptionGrant: vi.fn().mockResolvedValue('entitlement_denied') })
    const createTranscriptionCredential = vi.fn()
    await withApi(createDependencies({ sessionStore, createTranscriptionCredential }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/${randomBytes(32).toString('base64url')}/audio-transcription`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ consentVersion: 'gptmd-audio-transcription-v1' })
      })
      expect(response.status).toBe(403)
      expect(await response.json()).toEqual({
        error: 'Tenant plan or audio privacy approval does not allow voice transcription'
      })
      expect(createTranscriptionCredential).not.toHaveBeenCalled()
      expect(sessionStore.recordAudioProviderSession).not.toHaveBeenCalled()
    })
  })

  it('resolves Supabase identities against GPTMD memberships and rejects unlisted tenant headers', async () => {
    const getActiveTenantIds = vi.fn().mockResolvedValue(['tenant-a', 'tenant-b'])
    const sessionStore = createSessionStore({ getActiveTenantIds })
    const dependencies = createDependencies({ sessionStore })
    await withApi(dependencies, async (baseUrl) => {
      const token = makeToken({ tenant_id: undefined })
      const tenants = await fetch(`${baseUrl}/api/account/tenants`, {
        headers: { authorization: `Bearer ${token}` }
      })
      expect(tenants.status).toBe(200)
      expect(await tenants.json()).toEqual({ tenantIds: ['tenant-a', 'tenant-b'] })

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
      getActiveTenantIds: vi.fn().mockResolvedValue(['tenant-only'])
    })
    const dependencies = createDependencies({
      sessionStore,
      allowedOrigins: ['https://gptmd.example.test']
    })
    await withApi(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${makeToken({ tenant_id: undefined })}` }
      })
      expect(response.status).toBe(201)
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
        history: [],
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
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
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
        reasonForVisit: 'Pelvic pain'
      },
      versions: sessionVersions,
      readiness: { profile: true, redis: true, conversation: true }
    }
    const generatePatientScenario = vi.fn().mockResolvedValue(generated)
    let stored: PatientScenarioSetupResult | null = null
    let storedKey: string | null = null
    let pending: Promise<PatientScenarioSetupResult> | null = null
    const setupScenario = vi.fn(async (
      _principal: AuthenticatedPrincipal,
      _id: string,
      key: string,
      generate: (versions: PatientScenarioVersionPins, asOf: Date, seed: string) => Promise<GeneratedPatientScenario>
    ) => {
      if (stored) return storedKey === key ? stored : 'idempotency_conflict' as const
      if (!pending) {
        pending = (async () => {
          await generate(sessionVersions, new Date('2026-10-01T00:00:00.000Z'), 'z'.repeat(43))
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
      expect(firstBody).toEqual(duplicateBody)
      expect(firstBody.patient).not.toHaveProperty('diagnosis')
      expect(firstBody).not.toHaveProperty('scenarioId')
      expect(firstBody.readiness).toEqual({ profile: true, redis: true, conversation: true })
      expect(JSON.stringify(firstBody)).not.toContain('conv_internal_only')
      expect(JSON.stringify(firstBody)).not.toContain('resp_internal_only')
      expect(generatePatientScenario).toHaveBeenCalledOnce()
      expect(generatePatientScenario).toHaveBeenCalledWith(
        sessionVersions, new Date('2026-10-01T00:00:00.000Z'), 'z'.repeat(43)
      )

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
    const submitPatientTurn = vi.fn().mockResolvedValue({
      status: 'accepted', turnId, sequence: 1, patientResponse: 'I feel pain on my left side.'
    })
    const sessionStore = createSessionStore({ submitPatientTurn })
    const generatePatientTurn = vi.fn().mockResolvedValue({
      responseId: 'resp-turn', output: {
        patientResponse: 'I feel pain on my left side.', proposedFacts: [],
        historyCoverage: [], disclosedHistoryFields: []
      }
    })
    const dependencies = createDependencies({ sessionStore, generatePatientTurn })

    await withApi(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/turns`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ turnId, text: 'Where does it hurt?', modality: 'realtime_transcription' })
      })

      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ turnId, text: 'I feel pain on my left side.' })
      expect(submitPatientTurn).toHaveBeenCalledWith(
        { subjectId: 'learner-1', tenantId: 'tenant-a', role: 'learner' }, sessionId, turnId,
        'Where does it hurt?', generatePatientTurn, 'realtime_transcription'
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
    const submitAssessment = vi.fn().mockResolvedValue({
      assessmentId: 'assessment-1', status: 'unscored', submittedAt: '2026-10-01T00:02:00.000Z'
    })
    const sessionStore = createSessionStore({
      beginAssessment: vi.fn().mockResolvedValue('assessment'),
      submitAssessment
    })

    await withApi(createDependencies({ sessionStore }), async (baseUrl) => {
      const phase = await fetch(`${baseUrl}/api/sessions/${sessionId}/assessment-phase`, {
        method: 'POST', headers: authHeaders()
      })
      expect(phase.status).toBe(200)
      expect(await phase.json()).toEqual({ sessionId, phase: 'assessment' })

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
      expect(submitAssessment).toHaveBeenCalledWith(
        { subjectId: 'learner-1', tenantId: 'tenant-a', role: 'learner' }, sessionId,
        'assessment-1', { summary: 'Pelvic pain', differential: 'Possible cyst', rationale: 'Acute onset', plan: 'Follow up' }
      )
    })
  })
})
