import { once } from 'node:events'
import type { Server } from 'node:http'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApiApp, type ApiDependencies } from '../../services/api/src/app.js'
import { createServiceClients, realtimeTranscriptionSessionConfig } from '../../services/api/src/clients.js'
import type { AuthenticatedPrincipal } from '../../services/api/src/auth.ts'
import type { GeneratedPatientScenario, PatientScenarioVersionPins } from '../../services/api/src/patient-profile.ts'
import type { ProviderUsageSample } from '../../services/api/src/session-contracts.ts'
import type { PatientScenarioSetupResult, SessionRecord, SessionStore } from '../../services/api/src/session-store.ts'
import type { TenantEntitlementAdminStore, TenantEntitlementPolicy } from '../../services/api/src/tenant-entitlements.ts'
import { PATIENT_VARIANT_KEYS, type PatientVariantSettingsStore } from '../../services/api/src/patient-variant-settings.ts'
import type { OrganizationAiTimeBudgetStore, OrganizationAiTimeBudgetSettings } from '../../services/api/src/organization-ai-time-budget.ts'
import type { SessionArchiveStore } from '../../services/api/src/session-archives.ts'
import type { ConsumerTokenCatalog, ConsumerTokenCatalogStore } from '../../services/api/src/consumer-token-catalog.ts'
import type { TokenEntitlementStore } from '../../services/api/src/token-entitlements.ts'
import { createRedisRequestRateLimitStore, hashRateLimitKey } from '../../services/api/src/request-rate-limit.ts'
import { ProviderTokenBudgetExceeded } from '../../services/api/src/provider-token-reservations.ts'
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
  promptVersion: 'patient-scenario-prompt-v15',
  modelVersion: 'gpt-6-luna',
  schemaVersion: 8,
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
      { tenantId: 'tenant-a', role: 'learner', sessionsEnabled: true, responsesEnabled: true, audioTranscriptionAvailable: true }, { tenantId: 'tenant-b', role: 'learner', sessionsEnabled: true, responsesEnabled: true, audioTranscriptionAvailable: true }
    ]),
    consumeQuota: vi.fn().mockResolvedValue('allowed'),
    createAudioTranscriptionGrant: vi.fn().mockResolvedValue({ grantId: 'audio-grant-test' }),
    recordAudioProviderSession: vi.fn().mockResolvedValue(undefined),
    recordAudioTranscriptionUsage: vi.fn().mockResolvedValue(undefined),
    setAudioUsageObserverStatus: vi.fn().mockResolvedValue(undefined),
    recordEngagementPulse: vi.fn().mockResolvedValue('recorded'),
    createSession: vi.fn().mockResolvedValue(record),
    setupScenario: vi.fn().mockResolvedValue('not_found'),
    submitPatientTurn: vi.fn().mockResolvedValue('not_found'),
    beginAssessment: vi.fn().mockResolvedValue('not_ready'),
    submitAssessment: vi.fn().mockResolvedValue('not_ready'),
    cancelSession: vi.fn().mockResolvedValue('not_ready'),
    getOwnedSession: vi.fn().mockImplementation(async (principal: AuthenticatedPrincipal, id: string) =>
      principal.tenantId === 'tenant-a' && principal.subjectId === 'learner-1' && id === sessionId
        ? record
        : null
    ),
    getCurrentOwnedEncounter: vi.fn().mockResolvedValue(null),
    acknowledgeAddonSpendNotice: vi.fn().mockResolvedValue(false),
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
  reserveProviderTokens: vi.fn().mockImplementation(async () => ({
    reservationId: 'reservation-test',
    settle: vi.fn().mockResolvedValue(undefined),
    hold: vi.fn().mockResolvedValue(undefined)
  })),
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
  observeTranscriptionUsage: vi.fn().mockResolvedValue(vi.fn()),
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
  it('lets only the owner learner acknowledge an add-on spend notice', async () => {
    const sessionId = randomBytes(32).toString('base64url')
    const acknowledgeAddonSpendNotice = vi.fn().mockResolvedValue(true)
    const learnerStore = createSessionStore({ acknowledgeAddonSpendNotice })

    await withApi(createDependencies({ sessionStore: learnerStore }), async (baseUrl) => {
      const acknowledged = await fetch(`${baseUrl}/api/sessions/${sessionId}/addon-spend-notice/acknowledge`, {
        method: 'POST', headers: authHeaders()
      })
      expect(acknowledged.status).toBe(204)
      expect(acknowledgeAddonSpendNotice).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 'tenant-a', subjectId: 'learner-1', role: 'learner' }), sessionId
      )
    })

    const adminStore = createSessionStore({
      getActiveMemberships: vi.fn().mockResolvedValue([
        { tenantId: 'tenant-a', role: 'customer_admin', sessionsEnabled: true, responsesEnabled: true, audioTranscriptionAvailable: false }
      ]),
      acknowledgeAddonSpendNotice
    })
    await withApi(createDependencies({ sessionStore: adminStore }), async (baseUrl) => {
      const denied = await fetch(`${baseUrl}/api/sessions/${sessionId}/addon-spend-notice/acknowledge`, {
        method: 'POST', headers: authHeaders()
      })
      expect(denied.status).toBe(403)
    })
    expect(acknowledgeAddonSpendNotice).toHaveBeenCalledTimes(1)
  })

  it('allows only the separately configured system-admin subject to use platform operations without tenant membership', async () => {
    const execute = vi.fn().mockResolvedValue({
      ok: true,
      units: [{
        service: 'api', activeState: 'active', subState: 'running', activeSince: null,
        restartCount: 0, memoryBytes: 1024, cpuNanoseconds: 1000
      }]
    })
    const getActiveMemberships = vi.fn().mockRejectedValue(new Error('System admins do not need tenant membership'))
    const dependencies = createDependencies({
      systemAdminSubjectIds: new Set(['platform-operator']),
      systemOperations: { execute },
      sessionStore: createSessionStore({ getActiveMemberships })
    })

    await withApi(dependencies, async (baseUrl) => {
      const allowed = await fetch(`${baseUrl}/api/system-admin/overview`, {
        headers: { authorization: `Bearer ${makeToken({ sub: 'platform-operator' })}` }
      })
      expect(allowed.status).toBe(200)
      expect((await allowed.json()).systemdUnits).toHaveLength(1)

      const tenantAdmin = await fetch(`${baseUrl}/api/system-admin/overview`, {
        headers: { authorization: `Bearer ${makeToken({ sub: 'tenant-admin' })}` }
      })
      expect(tenantAdmin.status).toBe(403)
      expect(await tenantAdmin.json()).toEqual({ error: 'GPTMD system administrator access is required' })
    })

    expect(getActiveMemberships).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('keeps consumer catalog reads and writes behind the in-house system-admin allowlist', async () => {
    const catalog: ConsumerTokenCatalog = {
      schemaVersion: 1,
      revision: 1,
      baseMonthlyTokens: 100_000,
      currency: 'VND',
      tiers: [
        { code: 'lunar', monthlyPriceMinor: 100_000, status: 'published' },
        { code: 'solar', monthlyPriceMinor: 200_000, status: 'published' },
        { code: 'stellar', monthlyPriceMinor: null, status: 'draft' }
      ],
      addOns: [{
        code: 'extra-small', name: 'Extra Small', description: 'A top-up',
        tokens: 10_000, priceMinor: 20_000, status: 'published'
      }]
    }
    const store: ConsumerTokenCatalogStore = {
      get: vi.fn().mockResolvedValue(catalog),
      save: vi.fn().mockResolvedValue(catalog)
    }
    await withApi(createDependencies({
      systemAdminSubjectIds: new Set(['platform-operator']),
      consumerTokenCatalogStore: store
    }), async (baseUrl) => {
      const allowed = await fetch(`${baseUrl}/api/system-admin/consumer-catalog`, {
        headers: { authorization: `Bearer ${makeToken({ sub: 'platform-operator' })}` }
      })
      expect(allowed.status).toBe(200)
      const result = await allowed.json()
      expect(result.storefront.checkoutEnabled).toBe(false)
      expect(result.storefront.products.map((product: { tokens: number }) => product.tokens)).toEqual([
        100_000, 200_000, 10_000
      ])

      const hospitalAdmin = await fetch(`${baseUrl}/api/system-admin/consumer-catalog`, {
        headers: { authorization: `Bearer ${makeToken({ sub: 'hospital-admin' })}` }
      })
      expect(hospitalAdmin.status).toBe(403)

      const update = await fetch(`${baseUrl}/api/system-admin/consumer-catalog`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${makeToken({ sub: 'platform-operator' })}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(catalog)
      })
      expect(update.status).toBe(200)
    })
    expect(store.get).toHaveBeenCalledTimes(1)
    expect(store.save).toHaveBeenCalledWith('platform-operator', catalog)
  })

  it('publishes only configured consumer token offers to signed-in users without a tenant workspace', async () => {
    const catalog: ConsumerTokenCatalog = {
      schemaVersion: 1, revision: 2, baseMonthlyTokens: 50_000, currency: 'USD',
      tiers: [
        { code: 'lunar', monthlyPriceMinor: 900, status: 'published' },
        { code: 'solar', monthlyPriceMinor: 1700, status: 'published' },
        { code: 'stellar', monthlyPriceMinor: 2400, status: 'draft' }
      ],
      addOns: [{
        code: 'top-up-1', name: 'Token top-up', description: 'Carry-forward token credit',
        tokens: 12_000, priceMinor: 300, status: 'published'
      }]
    }
    const getActiveMemberships = vi.fn().mockResolvedValue([])
    const catalogStore: ConsumerTokenCatalogStore = {
      get: vi.fn().mockResolvedValue(catalog), save: vi.fn()
    }
    await withApi(createDependencies({
      sessionStore: createSessionStore({ getActiveMemberships }),
      consumerTokenCatalogStore: catalogStore
    }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/store/consumer-tokens`, { headers: authHeaders() })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store, private')
      const result = await response.json()
      expect(result.storefront.checkoutEnabled).toBe(false)
      expect(result.storefront.products.map((product: { code: string }) => product.code))
        .toEqual(['lunar', 'solar', 'top-up-1'])
      expect(JSON.stringify(result)).not.toContain('stellar')
    })
    expect(catalogStore.get).toHaveBeenCalledOnce()
    expect(getActiveMemberships).not.toHaveBeenCalled()
  })

  it('rejects malformed or published-without-price consumer catalog updates', async () => {
    const save = vi.fn()
    const store: ConsumerTokenCatalogStore = {
      get: vi.fn().mockResolvedValue(null),
      save: save.mockResolvedValue('conflict')
    }
    await withApi(createDependencies({
      systemAdminSubjectIds: new Set(['platform-operator']),
      consumerTokenCatalogStore: store
    }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/system-admin/consumer-catalog`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${makeToken({ sub: 'platform-operator' })}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          schemaVersion: 1, revision: 0, baseMonthlyTokens: 100,
          currency: 'USD',
          tiers: [
            { code: 'lunar', monthlyPriceMinor: null, status: 'published' },
            { code: 'solar', monthlyPriceMinor: null, status: 'draft' },
            { code: 'stellar', monthlyPriceMinor: null, status: 'draft' }
          ], addOns: []
        })
      })
      expect(response.status).toBe(400)
    })
    expect(save).not.toHaveBeenCalled()
  })

  it('returns a conflict when another system administrator has already advanced the catalog revision', async () => {
    const catalog: ConsumerTokenCatalog = {
      schemaVersion: 1, revision: 0, baseMonthlyTokens: 1000, currency: 'USD',
      tiers: [
        { code: 'lunar', monthlyPriceMinor: 100, status: 'draft' },
        { code: 'solar', monthlyPriceMinor: 200, status: 'draft' },
        { code: 'stellar', monthlyPriceMinor: 300, status: 'draft' }
      ],
      addOns: []
    }
    await withApi(createDependencies({
      systemAdminSubjectIds: new Set(['platform-operator']),
      consumerTokenCatalogStore: {
        get: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockResolvedValue('conflict')
      }
    }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/system-admin/consumer-catalog`, {
        method: 'PUT',
        headers: {
          authorization: `Bearer ${makeToken({ sub: 'platform-operator' })}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify(catalog)
      })
      expect(response.status).toBe(409)
    })
  })

  it('rejects invalid operations inputs before invoking the restricted operator', async () => {
    const execute = vi.fn()
    await withApi(createDependencies({
      systemAdminSubjectIds: new Set(['platform-operator']),
      systemOperations: { execute }
    }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/system-admin/logs?service=postgres&limit=999`, {
        headers: { authorization: `Bearer ${makeToken({ sub: 'platform-operator' })}` }
      })
      expect(response.status).toBe(400)
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('lists only the active learner workspace archives and records a completed private transcript download', async () => {
    const sessionId = randomBytes(32).toString('base64url')
    const listedArchive = {
      archiveId: sessionId,
      sessionId,
      updatedAt: '2026-10-15T10:00:00.000Z',
      status: 'available' as const,
      artifactId: 'artifact-test',
      downloadExpiresAt: '2026-10-18T10:00:00.000Z',
      errorCode: null
    }
    const archiveStore: SessionArchiveStore = {
      listOwnedArchives: vi.fn().mockResolvedValue([listedArchive]),
      resolveDownload: vi.fn().mockResolvedValue({
        status: 'ready', downloadId: 'download-test', artifactId: 'artifact-test',
        filename: 'gptmd-transcript-2026-10-15-test.txt',
        contentType: 'text/plain; charset=utf-8', content: Buffer.from('Learner: hello\nPatient: hi\n', 'utf8')
      }),
      recordDownloadOutcome: vi.fn().mockResolvedValue(undefined)
    }
    await withApi(createDependencies({ sessionArchiveStore: archiveStore }), async (baseUrl) => {
      const listing = await fetch(`${baseUrl}/api/account/archives`, { headers: authHeaders() })
      expect(listing.status).toBe(200)
      expect(listing.headers.get('cache-control')).toBe('no-store, private')
      expect(await listing.json()).toEqual({ archives: [listedArchive] })

      const download = await fetch(`${baseUrl}/api/sessions/${sessionId}/archive/download`, { headers: authHeaders() })
      expect(download.status).toBe(200)
      expect(download.headers.get('cache-control')).toBe('no-store, private')
      expect(download.headers.get('x-content-type-options')).toBe('nosniff')
      expect(download.headers.get('content-disposition')).toContain('attachment; filename=')
      expect(await download.text()).toBe('Learner: hello\nPatient: hi\n')
    })

    expect(archiveStore.resolveDownload).toHaveBeenCalledWith(
      { subjectId: 'learner-1', tenantId: 'tenant-a', role: 'learner' },
      sessionId,
      expect.any(String),
      expect.any(Date)
    )
    expect(archiveStore.recordDownloadOutcome).toHaveBeenCalledWith(expect.objectContaining({
      sessionId, tenantId: 'tenant-a', subjectId: 'learner-1', artifactId: 'artifact-test',
      downloadId: 'download-test', result: 'completed', bytesDownloaded: Buffer.byteLength('Learner: hello\nPatient: hi\n')
    }))
  })

  it('returns only the authenticated learner subject usage for the current UTC month', async () => {
    const getSubjectUsageSummary = vi.fn().mockResolvedValue({ totalTokens: '12345', responseCount: 8 })
    const budgetStore = {
      getSubjectUsageSummary,
      getSettings: vi.fn(), getUsageSummary: vi.fn(), getReservationSummary: vi.fn(),
      saveSettings: vi.fn(), listMemberAssignments: vi.fn(), saveMemberAssignment: vi.fn()
    } as unknown as OrganizationAiTimeBudgetStore
    await withApi(createDependencies({ organizationAiTimeBudgetStore: budgetStore }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/account/usage`, { headers: authHeaders() })
      const body = await response.json() as {
        periodStart: string
        periodEnd: string
        usage: { totalTokens: string; responseCount: number }
      }
      const now = new Date()
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store, private')
      expect(body).toEqual({
        periodStart: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
        periodEnd: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
        usage: { totalTokens: '12345', responseCount: 8 }
      })
      const [tenantId, subjectId, startAt, endAt] = getSubjectUsageSummary.mock.calls[0] ?? []
      expect([tenantId, subjectId]).toEqual(['tenant-a', 'learner-1'])
      expect(startAt).toBeInstanceOf(Date)
      expect(endAt).toBeInstanceOf(Date)
    })

    const adminSessionStore = createSessionStore({
      getActiveMemberships: vi.fn().mockResolvedValue([{
        tenantId: 'tenant-a', role: 'customer_admin', sessionsEnabled: false,
        responsesEnabled: false, audioTranscriptionAvailable: false
      }])
    })
    await withApi(createDependencies({ organizationAiTimeBudgetStore: budgetStore, sessionStore: adminSessionStore }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/account/usage`, { headers: authHeaders() })
      expect(response.status).toBe(403)
    })
    expect(getSubjectUsageSummary).toHaveBeenCalledOnce()
  })

  it('returns a bounded learner-only usage ledger scoped to the authenticated workspace and subject', async () => {
    const getSubjectUsageLedger = vi.fn().mockResolvedValue([{
      occurredAt: '2026-10-08T12:00:00.000Z', sessionId: 'session-1',
      provider: 'openai', operation: 'patient_turn', inputTokens: 100,
      outputTokens: 20, totalTokens: '120'
    }])
    const budgetStore = { getSubjectUsageLedger } as unknown as OrganizationAiTimeBudgetStore
    await withApi(createDependencies({ organizationAiTimeBudgetStore: budgetStore }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/account/usage-ledger`, { headers: authHeaders() })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store, private')
      expect(await response.json()).toEqual({ entries: [{
        occurredAt: '2026-10-08T12:00:00.000Z', sessionId: 'session-1',
        provider: 'openai', operation: 'patient_turn', inputTokens: 100,
        outputTokens: 20, totalTokens: '120'
      }] })
      expect(getSubjectUsageLedger).toHaveBeenCalledWith('tenant-a', 'learner-1', 100)
    })

    const adminSessionStore = createSessionStore({
      getActiveMemberships: vi.fn().mockResolvedValue([{
        tenantId: 'tenant-a', role: 'customer_admin', sessionsEnabled: false,
        responsesEnabled: false, audioTranscriptionAvailable: false
      }])
    })
    await withApi(createDependencies({
      organizationAiTimeBudgetStore: budgetStore,
      sessionStore: adminSessionStore
    }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/account/usage-ledger`, { headers: authHeaders() })
      expect(response.status).toBe(403)
    })
    expect(getSubjectUsageLedger).toHaveBeenCalledOnce()
  })

  it('returns token buckets only to the authenticated learner and never caches balances', async () => {
    const getSubjectBuckets = vi.fn().mockResolvedValue([{
      accountScope: 'consumer', bucketKind: 'included', groupCode: null,
      grantedTokens: '10000', usedTokens: '2500', reservedTokens: '500',
      remainingTokens: '7000', renewalAt: '2026-11-01T00:00:00.000Z',
      expiresAt: '2026-11-01T00:00:00.000Z', daysRemaining: 16
    }])
    const tokenEntitlementStore = { getSubjectBuckets } as unknown as TokenEntitlementStore
    await withApi(createDependencies({ tokenEntitlementStore }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/account/token-buckets`, { headers: authHeaders() })
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store, private')
      expect(await response.json()).toEqual({ buckets: [{
        accountScope: 'consumer', bucketKind: 'included', groupCode: null,
        grantedTokens: '10000', usedTokens: '2500', reservedTokens: '500',
        remainingTokens: '7000', renewalAt: '2026-11-01T00:00:00.000Z',
        expiresAt: '2026-11-01T00:00:00.000Z', daysRemaining: 16
      }] })
      expect(getSubjectBuckets).toHaveBeenCalledWith('tenant-a', 'learner-1')
    })

    const adminSessionStore = createSessionStore({
      getActiveMemberships: vi.fn().mockResolvedValue([{
        tenantId: 'tenant-a', role: 'customer_admin', sessionsEnabled: false,
        responsesEnabled: false, audioTranscriptionAvailable: false
      }])
    })
    await withApi(createDependencies({ tokenEntitlementStore, sessionStore: adminSessionStore }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/account/token-buckets`, { headers: authHeaders() })
      expect(response.status).toBe(403)
    })
    expect(getSubjectBuckets).toHaveBeenCalledOnce()
  })

  it.each([
    { result: 'pending' as const, status: 409 },
    { result: 'expired' as const, status: 410 },
    { result: 'failed' as const, status: 503 },
    { result: 'not_found' as const, status: 404 }
  ])('maps unavailable archive state $result to HTTP $status without sending an artifact', async ({ result, status }) => {
    const sessionId = randomBytes(32).toString('base64url')
    const archiveStore: SessionArchiveStore = {
      listOwnedArchives: vi.fn().mockResolvedValue([]),
      resolveDownload: vi.fn().mockResolvedValue({ status: result }),
      recordDownloadOutcome: vi.fn().mockResolvedValue(undefined)
    }
    await withApi(createDependencies({ sessionArchiveStore: archiveStore }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/archive/download`, { headers: authHeaders() })
      expect(response.status).toBe(status)
      expect(response.headers.get('content-disposition')).toBeNull()
    })
    expect(archiveStore.recordDownloadOutcome).not.toHaveBeenCalled()
  })

  it('denies archive listing and download to customer admins', async () => {
    const archiveStore: SessionArchiveStore = {
      listOwnedArchives: vi.fn().mockResolvedValue([]),
      resolveDownload: vi.fn(),
      recordDownloadOutcome: vi.fn()
    }
    const sessionStore = createSessionStore({
      getActiveMemberships: vi.fn().mockResolvedValue([{
        tenantId: 'tenant-a', role: 'customer_admin', sessionsEnabled: false,
        responsesEnabled: false, audioTranscriptionAvailable: false
      }])
    })
    await withApi(createDependencies({ sessionArchiveStore: archiveStore, sessionStore }), async (baseUrl) => {
      const token = makeToken({ sub: 'admin-1' })
      const listing = await fetch(`${baseUrl}/api/account/archives`, { headers: { authorization: `Bearer ${token}` } })
      const download = await fetch(`${baseUrl}/api/sessions/${'b'.repeat(43)}/archive/download`, {
        headers: { authorization: `Bearer ${token}` }
      })
      expect(listing.status).toBe(403)
      expect(download.status).toBe(403)
    })
    expect(archiveStore.listOwnedArchives).not.toHaveBeenCalled()
    expect(archiveStore.resolveDownload).not.toHaveBeenCalled()
  })

  it('limits entitlement controls to customer admins and persists only validated tenant policy', async () => {
    const policy: TenantEntitlementPolicy = {
      sessionsEnabled: false,
      responsesEnabled: false,
      monthlySessionQuota: null,
      monthlySessionQuotaPerUser: null,
      monthlyResponseQuota: null,
      monthlyResponseQuotaPerUser: null,
      responseQuotaPerSession: null,
      maxActiveSessions: null,
      audioTranscriptionEnabled: false,
      audioTranscriptionPrivacyApproved: false,
      monthlyAudioTranscriptionSessionQuota: null
    }
    const adminStore: TenantEntitlementAdminStore = {
      getPolicy: vi.fn().mockResolvedValue(policy),
      updatePolicy: vi.fn().mockImplementation(async (_tenantId, _changedBy, next) => next)
    }
    const sessionStore = createSessionStore({
      getActiveMemberships: vi.fn().mockImplementation(async (subjectId) => [{
        tenantId: 'tenant-a',
        role: subjectId === 'admin-1' ? 'customer_admin' : 'learner',
        sessionsEnabled: false,
        responsesEnabled: false,
        audioTranscriptionAvailable: false
      }])
    })
    await withApi(createDependencies({ sessionStore, tenantEntitlementAdminStore: adminStore }), async (baseUrl) => {
      const admin = makeToken({ sub: 'admin-1' })
      const read = await fetch(`${baseUrl}/api/admin/entitlements`, {
        headers: { authorization: `Bearer ${admin}` }
      })
      expect(read.status).toBe(200)
      expect(await read.json()).toEqual({ policy })

      const updatedPolicy = { ...policy, sessionsEnabled: true, responsesEnabled: true, monthlySessionQuota: 20 }
      const update = await fetch(`${baseUrl}/api/admin/entitlements`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: JSON.stringify(updatedPolicy)
      })
      expect(update.status).toBe(200)
      expect(await update.json()).toEqual({ policy: updatedPolicy })
      expect(adminStore.updatePolicy).toHaveBeenCalledWith('tenant-a', 'admin-1', updatedPolicy)

      const learner = makeToken({ sub: 'learner-1' })
      const denied = await fetch(`${baseUrl}/api/admin/entitlements`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${learner}`, 'content-type': 'application/json' },
        body: JSON.stringify(updatedPolicy)
      })
      expect(denied.status).toBe(403)
      expect(adminStore.updatePolicy).toHaveBeenCalledTimes(1)

      const wrongTenant = await fetch(`${baseUrl}/api/admin/entitlements`, {
        headers: { authorization: `Bearer ${admin}`, 'x-gptmd-tenant-id': 'tenant-b' }
      })
      expect(wrongTenant.status).toBe(403)

      const invalid = await fetch(`${baseUrl}/api/admin/entitlements`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...updatedPolicy, monthlySessionQuota: -1 })
      })
      expect(invalid.status).toBe(400)
      expect(adminStore.updatePolicy).toHaveBeenCalledTimes(1)
    })
  })

  it('limits AI-time budget drafts to customer admins and the authenticated tenant', async () => {
    const settings: OrganizationAiTimeBudgetSettings = {
      schemaVersion: 1,
      revision: 1,
      status: 'draft',
      organizationPeriod: { months: 3, anchorDate: '2026-01-01' },
      organizationPool: { tokens: 100_000, estimatedMinutes: 600 },
      groups: [{
        code: 'gptnursing', name: 'GPT Nursing', tokenBudget: 70_000, estimatedMinuteBudget: 400,
        monthlyTokensPerUser: 20_000, monthlyEstimatedMinutesPerUser: 120
      }],
      departments: [{ code: 'obgyn', name: 'OBGYN', monthlyTokensPerUser: 10_000 }]
    }
    const budgetStore: OrganizationAiTimeBudgetStore = {
      getSettings: vi.fn().mockResolvedValue(settings),
      getUsageSummary: vi.fn().mockResolvedValue({ totalTokens: '3210', responseCount: 7 }),
      getMemberUsageSummary: vi.fn().mockResolvedValue([{
        subjectId: 'learner-subject', role: 'learner', sessionsStarted: 4, sessionsCompleted: 2,
        providerResponseCount: 7, totalTokens: '3210', lastAiActivityAt: '2026-10-15T12:00:00.000Z',
        estimatedEngagementSeconds: 930, lastEngagementAt: '2026-10-15T12:10:00.000Z'
      }]),
      getCompletedSessionRecords: vi.fn().mockResolvedValue({ records: [{
        sessionId: 'completed-session', subjectId: 'learner-subject',
        startedAt: '2026-10-15T12:00:00.000Z', completedAt: '2026-10-15T12:20:00.000Z',
        estimatedEngagementSeconds: 930
      }], hasMore: false }),
      getReservationSummary: vi.fn().mockResolvedValue({
        reservedTokens: '9216', reservedCount: 2, heldTokens: '4096', heldCount: 1
      }),
      saveSettings: vi.fn().mockResolvedValue(settings),
      listMemberAssignments: vi.fn().mockResolvedValue([{
        subjectId: 'learner-subject', role: 'learner', groupCodes: ['gptnursing'], departmentCode: 'obgyn'
      }]),
      saveMemberAssignment: vi.fn().mockResolvedValue({
        subjectId: 'learner-subject', role: 'learner', groupCodes: ['gptnursing'], departmentCode: 'obgyn'
      })
    }
    const sessionStore = createSessionStore({
      getActiveMemberships: vi.fn().mockImplementation(async (subjectId) => [{
        tenantId: 'tenant-a',
        role: subjectId === 'admin-1' ? 'customer_admin' : 'learner',
        sessionsEnabled: false,
        responsesEnabled: false,
        audioTranscriptionAvailable: false
      }])
    })
    await withApi(createDependencies({ sessionStore, organizationAiTimeBudgetStore: budgetStore }), async (baseUrl) => {
      const admin = makeToken({ sub: 'admin-1' })
      const read = await fetch(`${baseUrl}/api/admin/ai-time-budget`, {
        headers: { authorization: `Bearer ${admin}` }
      })
      expect(read.status).toBe(200)
      expect(await read.json()).toEqual({
        settings,
        usage: { totalTokens: '3210', responseCount: 7 },
        reservationSummary: { reservedTokens: '9216', reservedCount: 2, heldTokens: '4096', heldCount: 1 }
      })
      expect(budgetStore.getUsageSummary).toHaveBeenCalledWith(
        'tenant-a', expect.any(Date), expect.any(Date)
      )
      expect(budgetStore.getReservationSummary).toHaveBeenCalledWith(
        'tenant-a', expect.any(Date), expect.any(Date)
      )

      const report = await fetch(`${baseUrl}/api/admin/ai-time-budget/member-usage`, {
        headers: { authorization: `Bearer ${admin}` }
      })
      const reportBody = await report.json() as {
        periodStart: string
        periodEnd: string
        members: Array<{ subjectId: string; totalTokens: string; sessionsStarted: number }>
      }
      expect(report.status).toBe(200)
      expect(report.headers.get('cache-control')).toBe('no-store, private')
      expect(reportBody.members).toEqual([expect.objectContaining({
        subjectId: 'learner-subject', totalTokens: '3210', sessionsStarted: 4,
        estimatedEngagementSeconds: 930, lastEngagementAt: '2026-10-15T12:10:00.000Z'
      })])
      const [reportTenant, reportStart, reportEnd] = budgetStore.getMemberUsageSummary.mock.calls[0] ?? []
      expect(reportTenant).toBe('tenant-a')
      expect(reportStart?.toISOString()).toBe(reportBody.periodStart)
      expect(reportEnd?.toISOString()).toBe(reportBody.periodEnd)

      const completionResponse = await fetch(`${baseUrl}/api/admin/ai-time-budget/completed-sessions`, {
        headers: { authorization: `Bearer ${admin}` }
      })
      expect(completionResponse.status).toBe(200)
      expect(completionResponse.headers.get('cache-control')).toBe('no-store, private')
      expect(await completionResponse.json()).toMatchObject({
        records: [{
          sessionId: 'completed-session', subjectId: 'learner-subject',
          estimatedEngagementSeconds: 930
        }],
        hasMore: false,
        certificateBasis: 'completed_simulation_no_ceu_credit'
      })
      expect(budgetStore.getCompletedSessionRecords).toHaveBeenCalledWith(
        'tenant-a', expect.any(Date), expect.any(Date)
      )

      const learnerCompletionResponse = await fetch(`${baseUrl}/api/admin/ai-time-budget/completed-sessions`, {
        headers: { authorization: `Bearer ${makeToken({ sub: 'learner-1' })}` }
      })
      expect(learnerCompletionResponse.status).toBe(403)
      expect(budgetStore.getCompletedSessionRecords).toHaveBeenCalledOnce()

      const update = await fetch(`${baseUrl}/api/admin/ai-time-budget`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...settings, revision: 0 })
      })
      expect(update.status).toBe(200)
      expect(budgetStore.getUsageSummary).toHaveBeenCalledTimes(2)
      expect(budgetStore.saveSettings).toHaveBeenCalledWith('tenant-a', 'admin-1', { ...settings, revision: 0 })

      budgetStore.saveSettings.mockResolvedValueOnce('allocation_below_usage')
      const reductionBlocked = await fetch(`${baseUrl}/api/admin/ai-time-budget`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...settings, revision: 1, status: 'active' })
      })
      expect(reductionBlocked.status).toBe(409)
      expect(await reductionBlocked.json()).toEqual({
        error: 'A group allocation cannot be reduced below settled and reserved tokens in this period'
      })

      budgetStore.saveSettings.mockResolvedValueOnce('period_locked')
      const renewalLocked = await fetch(`${baseUrl}/api/admin/ai-time-budget`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          ...settings, revision: 1,
          organizationPeriod: { months: 1, anchorDate: '2026-10-01' }
        })
      })
      expect(renewalLocked.status).toBe(409)
      expect(await renewalLocked.json()).toEqual({
        error: 'The organization renewal period cannot change while included tokens remain valid'
      })

      const learner = makeToken({ sub: 'learner-1' })
      const denied = await fetch(`${baseUrl}/api/admin/ai-time-budget`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${learner}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...settings, revision: 0 })
      })
      expect(denied.status).toBe(403)
      expect(budgetStore.saveSettings).toHaveBeenCalledTimes(3)

      const invalid = await fetch(`${baseUrl}/api/admin/ai-time-budget`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: JSON.stringify({ ...settings, revision: 0, groups: [{ ...settings.groups[0]!, tokenBudget: 100_001 }] })
      })
      expect(invalid.status).toBe(400)
      expect(budgetStore.saveSettings).toHaveBeenCalledTimes(3)

      const assignments = await fetch(`${baseUrl}/api/admin/ai-time-budget/assignments`, {
        headers: { authorization: `Bearer ${admin}` }
      })
      expect(assignments.status).toBe(200)
      expect(await assignments.json()).toEqual({
        members: [{ subjectId: 'learner-subject', role: 'learner', groupCodes: ['gptnursing'], departmentCode: 'obgyn' }],
        groups: [{ code: 'gptnursing', name: 'GPT Nursing' }],
        departments: settings.departments
      })

      const assignmentUpdate = await fetch(`${baseUrl}/api/admin/ai-time-budget/assignments`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: JSON.stringify({ subjectId: 'learner-subject', groupCodes: ['gptnursing'], departmentCode: 'obgyn' })
      })
      expect(assignmentUpdate.status).toBe(200)
      const assignmentUpdateBody = await assignmentUpdate.json() as {
        departmentAllocation: { monthlyTokens?: number; tokens: number | null; fraction: number }
      }
      expect(assignmentUpdateBody.departmentAllocation.monthlyTokens).toBeUndefined()
      expect(assignmentUpdateBody.departmentAllocation.tokens).toBeGreaterThan(0)
      expect(assignmentUpdateBody.departmentAllocation.fraction).toBeGreaterThan(0)
      expect(budgetStore.saveMemberAssignment).toHaveBeenCalledWith('tenant-a', 'admin-1', {
        subjectId: 'learner-subject', groupCodes: ['gptnursing'], departmentCode: 'obgyn'
      })

      const learnerAssignment = await fetch(`${baseUrl}/api/admin/ai-time-budget/assignments`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${learner}`, 'content-type': 'application/json' },
        body: JSON.stringify({ subjectId: 'learner-1', groupCodes: ['gptnursing'], departmentCode: 'obgyn' })
      })
      expect(learnerAssignment.status).toBe(403)

      const learnerReport = await fetch(`${baseUrl}/api/admin/ai-time-budget/member-usage`, {
        headers: { authorization: `Bearer ${learner}` }
      })
      expect(learnerReport.status).toBe(403)
      expect(budgetStore.saveMemberAssignment).toHaveBeenCalledTimes(1)

      const invalidAssignment = await fetch(`${baseUrl}/api/admin/ai-time-budget/assignments`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: JSON.stringify({ subjectId: 'learner-subject', groupCodes: ['gptnursing', 'gptnursing'], departmentCode: 'obgyn' })
      })
      expect(invalidAssignment.status).toBe(400)

      const imported = await fetch(`${baseUrl}/api/admin/ai-time-budget/assignments/import`, {
        method: 'POST',
        headers: { authorization: `Bearer ${admin}`, 'content-type': 'application/json' },
        body: JSON.stringify({ assignments: [{
          subjectId: 'learner-subject', groupCodes: ['gptnursing'], departmentCode: 'obgyn'
        }] })
      })
      expect(imported.status).toBe(200)
      expect(await imported.json()).toEqual({ imported: 1, failures: [] })
      expect(budgetStore.saveMemberAssignment).toHaveBeenLastCalledWith('tenant-a', 'admin-1', {
        subjectId: 'learner-subject', groupCodes: ['gptnursing'], departmentCode: 'obgyn'
      })

      const learnerImport = await fetch(`${baseUrl}/api/admin/ai-time-budget/assignments/import`, {
        method: 'POST',
        headers: { authorization: `Bearer ${learner}`, 'content-type': 'application/json' },
        body: JSON.stringify({ assignments: [{
          subjectId: 'learner-1', groupCodes: ['gptnursing'], departmentCode: 'obgyn'
        }] })
      })
      expect(learnerImport.status).toBe(403)
      expect(budgetStore.saveMemberAssignment).toHaveBeenCalledTimes(2)

    })
  })

  it('lets only customer admins import normalized learner email rosters', async () => {
    const importMemberRosterInvitations = vi.fn().mockResolvedValue({ imported: 1, alreadyAccepted: 0 })
    const budgetStore = {
      importMemberRosterInvitations,
      getSettings: vi.fn(), getUsageSummary: vi.fn(), getReservationSummary: vi.fn(),
      saveSettings: vi.fn(), listMemberAssignments: vi.fn(), saveMemberAssignment: vi.fn()
    } as unknown as OrganizationAiTimeBudgetStore
    const sessionStore = createSessionStore({
      getActiveMemberships: vi.fn().mockImplementation(async (subjectId: string) => [{
        tenantId: 'tenant-a', role: subjectId === 'admin-1' ? 'customer_admin' as const : 'learner' as const,
        sessionsEnabled: false, responsesEnabled: false, audioTranscriptionAvailable: false
      }])
    })
    await withApi(createDependencies({ sessionStore, organizationAiTimeBudgetStore: budgetStore }), async (baseUrl) => {
      const accepted = await fetch(`${baseUrl}/api/admin/member-roster/invitations/import`, {
        method: 'POST',
        headers: { authorization: `Bearer ${makeToken({ sub: 'admin-1' })}`, 'content-type': 'application/json' },
        body: JSON.stringify({ invitations: [{
          email: 'Employee@Example.test', groupCodes: ['gptnursing'], departmentCode: 'obgyn'
        }] })
      })
      expect(accepted.status).toBe(200)
      expect(await accepted.json()).toEqual({ imported: 1, alreadyAccepted: 0 })
      expect(importMemberRosterInvitations).toHaveBeenCalledWith('tenant-a', 'admin-1', [{
        email: 'employee@example.test', groupCodes: ['gptnursing'], departmentCode: 'obgyn'
      }])

      const learner = await fetch(`${baseUrl}/api/admin/member-roster/invitations/import`, {
        method: 'POST',
        headers: { authorization: `Bearer ${makeToken({ sub: 'learner-1' })}`, 'content-type': 'application/json' },
        body: JSON.stringify({ invitations: [{
          email: 'other@example.test', groupCodes: [], departmentCode: null
        }] })
      })
      expect(learner.status).toBe(403)
      expect(importMemberRosterInvitations).toHaveBeenCalledTimes(1)

      const duplicate = await fetch(`${baseUrl}/api/admin/member-roster/invitations/import`, {
        method: 'POST',
        headers: { authorization: `Bearer ${makeToken({ sub: 'admin-1' })}`, 'content-type': 'application/json' },
        body: JSON.stringify({ invitations: [
          { email: 'employee@example.test', groupCodes: [], departmentCode: null },
          { email: 'EMPLOYEE@example.test', groupCodes: [], departmentCode: null }
        ] })
      })
      expect(duplicate.status).toBe(400)
      expect(importMemberRosterInvitations).toHaveBeenCalledTimes(1)
    })
  })

  it('scopes patient variant settings to the instructor role and selected tenant', async () => {
    const settings = {
      schemaVersion: 1 as const,
      status: 'draft' as const,
      revision: 1,
      variants: PATIENT_VARIANT_KEYS.map((variantKey) => ({
        variantKey,
        voiceProfileId: `voice-${variantKey}`,
        voice: { provider: null, voiceId: null, locale: null, rate: null, pitch: null, volume: null, fallbackVoiceId: null },
        variabilityProfileId: `variability-${variantKey}`,
        variability: {
          mood: { allowedValues: [] }, maturity: { allowedValues: [] }, verbosity: { allowedValues: [] },
          educationLevel: { allowedValues: [] }, willingnessToDisclose: { allowedValues: [] }
        }
      }))
    }
    const settingsStore: PatientVariantSettingsStore = {
      getSettings: vi.fn().mockResolvedValue(settings),
      saveSettings: vi.fn().mockResolvedValue(settings)
    }
    const sessionStore = createSessionStore({
      getActiveMemberships: vi.fn().mockImplementation(async (subjectId) => [{
        tenantId: 'tenant-a',
        role: subjectId === 'instructor-1' ? 'instructor' : subjectId === 'admin-1' ? 'customer_admin' : 'learner',
        sessionsEnabled: false,
        responsesEnabled: false,
        audioTranscriptionAvailable: false
      }])
    })

    await withApi(createDependencies({ sessionStore, patientVariantSettingsStore: settingsStore }), async (baseUrl) => {
      const instructor = makeToken({ sub: 'instructor-1' })
      const read = await fetch(`${baseUrl}/api/instructor/patient-variant-settings`, {
        headers: { authorization: `Bearer ${instructor}` }
      })
      expect(read.status).toBe(200)
      expect(await read.json()).toEqual({ settings })

      const update = await fetch(`${baseUrl}/api/instructor/patient-variant-settings`, {
        method: 'PUT',
        headers: { authorization: `Bearer ${instructor}`, 'content-type': 'application/json' },
        body: JSON.stringify(settings)
      })
      expect(update.status).toBe(200)
      expect(settingsStore.saveSettings).toHaveBeenCalledWith('tenant-a', 'instructor-1', settings)

      const learner = await fetch(`${baseUrl}/api/instructor/patient-variant-settings`, {
        headers: { authorization: `Bearer ${makeToken({ sub: 'learner-1' })}` }
      })
      expect(learner.status).toBe(403)
      const administrator = await fetch(`${baseUrl}/api/instructor/patient-variant-settings`, {
        headers: { authorization: `Bearer ${makeToken({ sub: 'admin-1' })}` }
      })
      expect(administrator.status).toBe(403)
      const wrongTenant = await fetch(`${baseUrl}/api/instructor/patient-variant-settings`, {
        headers: { authorization: `Bearer ${instructor}`, 'x-gptmd-tenant-id': 'tenant-b' }
      })
      expect(wrongTenant.status).toBe(403)
      expect(settingsStore.getSettings).toHaveBeenCalledTimes(1)
      expect(settingsStore.saveSettings).toHaveBeenCalledTimes(1)
    })
  })

  it('uses the current Realtime transcription language configuration', () => {
    expect(realtimeTranscriptionSessionConfig()).toEqual({
      type: 'transcription',
      audio: {
        input: {
          transcription: { model: 'gpt-live-transcribe', languages: ['en'] },
          turn_detection: null
        }
      }
    })
  })

  it('reports bounded provider call errors without exposing the ephemeral secret', async () => {
    const requestId = 'req_live_test_123'
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        value: 'ek_ephemeral-secret-value',
        expires_at: 1_800_000_000,
        session: { id: 'sess_test', object: 'realtime.transcription_session', type: 'transcription' }
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { type: 'server_error', message: 'Temporary provider failure' }
      }), {
        status: 500,
        headers: { 'content-type': 'application/json', 'x-request-id': requestId }
      }))
    const clients = createServiceClients({ OPENAI_API_KEY: 'unit-test-openai-key' })
    try {
      const failure = await clients.dependencies.createTranscriptionCall?.('v=0\r\n').catch((error: unknown) => error)
      expect(failure).toMatchObject({
        status: 500,
        message: expect.stringContaining(`HTTP 500, code server_error, details Temporary provider failure, request ${requestId}`)
      })
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).message).not.toContain('ek_ephemeral-secret-value')
    } finally {
      await clients.close()
    }
  })

  it('preserves safe gateway headers for non-JSON Realtime failures without exposing the response body', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({
        value: 'ek_ephemeral-secret-value',
        expires_at: 1_800_000_000,
        session: { id: 'sess_test', object: 'realtime.transcription_session', type: 'transcription' }
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response('Internal Server Error', {
        status: 500,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          server: 'gateway-test',
          'cf-ray': 'ray-test-123'
        }
      }))
    const clients = createServiceClients({ OPENAI_API_KEY: 'unit-test-openai-key' })
    try {
      const failure = await clients.dependencies.createTranscriptionCall?.('v=0\r\n').catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(Error)
      expect((failure as Error).message).toContain('HTTP 500')
      expect((failure as Error).message).toContain('details non-JSON text/plain; charset=utf-8 (21 bytes)')
      expect((failure as Error).message).toContain('server gateway-test')
      expect((failure as Error).message).toContain('cf-ray ray-test-123')
      expect((failure as Error).message).not.toContain('Internal Server Error')
      expect((failure as Error).message).not.toContain('ek_ephemeral-secret-value')
    } finally {
      await clients.close()
    }
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

  it('ignores caller-supplied forwarded IP when no proxy is trusted', async () => {
    const increment = vi.fn().mockResolvedValue({ count: 1, ttlSeconds: 60 })
    await withApi(createDependencies({
      trustedProxyAddresses: [],
      requestRateLimitStore: { increment }
    }), async (baseUrl) => {
      await fetch(`${baseUrl}/api/not-found`, {
        headers: { 'x-forwarded-for': '198.51.100.99' }
      })

      expect(increment).toHaveBeenCalledOnce()
      expect(increment).toHaveBeenCalledWith(hashRateLimitKey('ip', '127.0.0.1'), 60)
    })
  })

  it('uses the single client IP resolved by the configured loopback ingress proxy', async () => {
    const increment = vi.fn().mockResolvedValue({ count: 1, ttlSeconds: 60 })
    await withApi(createDependencies({
      trustedProxyAddresses: ['127.0.0.1'],
      requestRateLimitStore: { increment }
    }), async (baseUrl) => {
      await fetch(`${baseUrl}/api/not-found`, {
        headers: { 'x-forwarded-for': '203.0.113.25' }
      })

      expect(increment).toHaveBeenCalledOnce()
      expect(increment).toHaveBeenCalledWith(hashRateLimitKey('ip', '203.0.113.25'), 60)
    })
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

  it('issues a unique server-generated request ID and ignores caller-supplied IDs', async () => {
    await withApi(createDependencies(), async (baseUrl) => {
      const suppliedId = 'attacker-controlled-request-id'
      const first = await fetch(`${baseUrl}/healthz`, { headers: { 'x-request-id': suppliedId } })
      const second = await fetch(`${baseUrl}/healthz`)
      const firstId = first.headers.get('x-request-id')
      const secondId = second.headers.get('x-request-id')

      expect(firstId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      expect(secondId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      expect(firstId).not.toBe(suppliedId)
      expect(secondId).not.toBe(firstId)
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

  it('retires generic Responses before quota or provider work', async () => {
    const consumeQuota = vi.fn().mockResolvedValue('allowed')
    const dependencies = createDependencies({
      sessionStore: createSessionStore({ consumeQuota }),
      generatePatientScenario: vi.fn(),
      generatePatientTurn: vi.fn()
    })
    await withApi(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/openai/responses`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ input: 'Explain the symptom.' })
      })
      expect(response.status).toBe(410)
      expect(await response.json()).toEqual({
        error: 'Generic Responses are retired; use a session-scoped setup or patient-turn endpoint'
      })
      expect(consumeQuota).not.toHaveBeenCalled()
      expect(dependencies.generatePatientScenario).not.toHaveBeenCalled()
      expect(dependencies.generatePatientTurn).not.toHaveBeenCalled()
    })
  })

  it('rejects a second patient turn before session state work when interactive provider capacity is full', async () => {
    const pendingTurn = deferred<{ responseId: string; output: unknown; providerUsage: ProviderUsageSample | null }>()
    const generatePatientTurn = vi.fn(() => pendingTurn.promise)
    const submitPatientTurn = vi.fn(async (...args: Parameters<SessionStore['submitPatientTurn']>) => {
      await args[4]({} as never)
      return 'provider_error' as const
    })
    const sessionStore = createSessionStore({ submitPatientTurn })
    const sessionId = randomBytes(32).toString('base64url')
    await withApi(createDependencies({
      sessionStore, generatePatientTurn,
      providerCapacityLimits: {
        maxConcurrent: 1,
        reservedInteractive: 0,
        maxQueuedInteractive: 0,
        interactiveWaitTimeoutMs: 1_000,
        maxQueuedSetup: 0,
        setupWaitTimeoutMs: 1_000
      }
    }), async (baseUrl) => {
      const firstTurn = fetch(`${baseUrl}/api/sessions/${sessionId}/turns`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ turnId: 'turn-capacity-0001', text: 'When did it start?' })
      })
      await vi.waitFor(() => expect(generatePatientTurn).toHaveBeenCalledOnce())

      const secondTurn = await fetch(`${baseUrl}/api/sessions/${sessionId}/turns`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ turnId: 'turn-capacity-0002', text: 'Is it getting worse?' })
      })
      expect(secondTurn.status).toBe(503)
      expect(secondTurn.headers.get('retry-after')).toBe('1')
      expect(await secondTurn.json()).toEqual({
        error: 'Interactive response capacity is unavailable; retry with the same turnId.'
      })
      expect(submitPatientTurn).toHaveBeenCalledOnce()

      pendingTurn.resolve({ responseId: 'resp-capacity', output: {}, providerUsage: null })
      expect((await firstTurn).status).toBe(502)
    })
  })

  it('returns a clear 429 and never generates a patient turn after reservation exhaustion', async () => {
    const generatePatientTurn = vi.fn(async (_context, _timing, reserve) => {
      await reserve?.(400, 1_024)
      return {
        responseId: 'resp-should-not-exist', providerUsage: null,
        output: { patientResponse: 'unreachable', proposedFacts: [], historyCoverage: [], disclosedHistoryFields: [] }
      }
    })
    const submitPatientTurn = vi.fn(async (...args: Parameters<SessionStore['submitPatientTurn']>) => {
      await args[4]({} as never)
      return 'provider_error' as const
    })
    const reserveProviderTokens = vi.fn().mockRejectedValue(new ProviderTokenBudgetExceeded())
    await withApi(createDependencies({
      sessionStore: createSessionStore({ submitPatientTurn }),
      generatePatientTurn,
      reserveProviderTokens
    }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/${randomBytes(32).toString('base64url')}/turns`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ turnId: 'turn-budget-0001', text: 'When did it begin?' })
      })
      expect(response.status).toBe(429)
      expect(await response.json()).toEqual({ error: 'Selected AI token allowance is exhausted' })
      expect(reserveProviderTokens).toHaveBeenCalledOnce()
      expect(generatePatientTurn).toHaveBeenCalledOnce()
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

  it('claims email-matched learner roster invitations before listing account workspaces', async () => {
    const claimPendingMemberRosterInvitations = vi.fn().mockResolvedValue(undefined)
    const memberships = [{
      tenantId: 'tenant-vinmed', role: 'learner' as const,
      sessionsEnabled: false, responsesEnabled: false, audioTranscriptionAvailable: false
    }]
    const sessionStore = createSessionStore({
      getActiveMemberships: vi.fn().mockResolvedValue(memberships)
    })
    const budgetStore = {
      claimPendingMemberRosterInvitations,
      getSettings: vi.fn(), getUsageSummary: vi.fn(), getReservationSummary: vi.fn(),
      saveSettings: vi.fn(), listMemberAssignments: vi.fn(), saveMemberAssignment: vi.fn()
    } as unknown as OrganizationAiTimeBudgetStore
    await withApi(createDependencies({ sessionStore, organizationAiTimeBudgetStore: budgetStore }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/account/tenants`, {
        headers: { authorization: `Bearer ${makeToken({
          sub: 'invited-user', email: 'VinMed.Employee@example.test', app_metadata: { provider: 'google' }
        })}` }
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ memberships })
      expect(claimPendingMemberRosterInvitations).toHaveBeenCalledWith('invited-user', 'vinmed.employee@example.test')

      const unverifiedProvider = await fetch(`${baseUrl}/api/account/tenants`, {
        headers: { authorization: `Bearer ${makeToken({ sub: 'other-user', email: 'employee@example.test' })}` }
      })
      expect(unverifiedProvider.status).toBe(200)
      expect(claimPendingMemberRosterInvitations).toHaveBeenCalledTimes(1)
    })
  })

  it.each(['instructor', 'customer_admin'] as const)(
    'loads the active %s role and denies non-learners from encounter routes', async (role) => {
      const getActiveMemberships = vi.fn().mockResolvedValue([{ tenantId: 'tenant-a', role, sessionsEnabled: true, responsesEnabled: true, audioTranscriptionAvailable: true }])
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
    const observeTranscriptionUsage = vi.fn().mockResolvedValue(vi.fn().mockResolvedValue(undefined))
    const hangupTranscriptionCall = vi.fn().mockResolvedValue(undefined)
    await withApi(createDependencies({ sessionStore, createTranscriptionCall, observeTranscriptionUsage, hangupTranscriptionCall }), async (baseUrl) => {
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
      expect(sessionStore.setAudioUsageObserverStatus).toHaveBeenCalledWith('call_provider_test', 'connected')
      expect(observeTranscriptionUsage).toHaveBeenCalledWith(
        'call_provider_test', expect.any(Function), expect.any(Function)
      )
      expect(createTranscriptionCall).toHaveBeenCalledWith('v=0\\r\\n')
    })
  })

  it('persists only provider-reported transcription duration from the server observer', async () => {
    const sessionStore = createSessionStore()
    let observedUsage: ((usage: { eventId: string; seconds: number }) => Promise<void>) | undefined
    const observeTranscriptionUsage = vi.fn(async (
      _callId: string,
      onUsage: (usage: { eventId: string; seconds: number }) => Promise<void>
    ) => {
      observedUsage = onUsage
      return vi.fn()
    })
    await withApi(createDependencies({ sessionStore, observeTranscriptionUsage }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/${randomBytes(32).toString('base64url')}/audio-transcription`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ consentVersion: 'gptmd-audio-transcription-v1', sdp: 'v=0\\r\\n' })
      })
      expect(response.status).toBe(200)
      await observedUsage?.({ eventId: 'event_provider_1', seconds: 4.25 })
      expect(sessionStore.recordAudioTranscriptionUsage).toHaveBeenCalledWith(
        'call_provider_test', 'event_provider_1', 4.25
      )
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

  it('hangs up and marks the provider call interrupted if its usage observer cannot attach', async () => {
    const sessionStore = createSessionStore()
    const hangupTranscriptionCall = vi.fn().mockResolvedValue(undefined)
    const observeTranscriptionUsage = vi.fn().mockRejectedValue(new Error('sideband unavailable'))
    await withApi(createDependencies({ sessionStore, hangupTranscriptionCall, observeTranscriptionUsage }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/${randomBytes(32).toString('base64url')}/audio-transcription`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ consentVersion: 'gptmd-audio-transcription-v1', sdp: 'v=0\\r\\n' })
      })
      expect(response.status).toBe(503)
      expect(await response.json()).toEqual({ error: 'Voice transcription could not be authorized or initialized' })
      expect(sessionStore.setAudioUsageObserverStatus).toHaveBeenCalledWith('call_provider_test', 'interrupted')
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
      { tenantId: 'tenant-a', role: 'instructor', sessionsEnabled: true, responsesEnabled: true, audioTranscriptionAvailable: true }, { tenantId: 'tenant-b', role: 'learner', sessionsEnabled: true, responsesEnabled: true, audioTranscriptionAvailable: true }
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
        { tenantId: 'tenant-a', role: 'instructor', sessionsEnabled: true, responsesEnabled: true, audioTranscriptionAvailable: true },
        { tenantId: 'tenant-b', role: 'learner', sessionsEnabled: true, responsesEnabled: true, audioTranscriptionAvailable: true }
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
      getActiveMemberships: vi.fn().mockResolvedValue([{ tenantId: 'tenant-only', role: 'learner', sessionsEnabled: true, responsesEnabled: true, audioTranscriptionAvailable: true }])
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

  it('returns assigned group choices and forwards an explicit per-session budget group', async () => {
    const sessionStore = createSessionStore({
      createSession: vi.fn()
        .mockResolvedValueOnce({
          status: 'group_selection_required',
          availableGroups: [{ code: 'gptnursing', name: 'GPT Nursing' }, { code: 'gptreception', name: 'GPT Reception' }]
        })
        .mockResolvedValueOnce({
          sessionId: randomBytes(32).toString('base64url'),
          status: 'initializing',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:00:00.000Z',
          aiBudgetGroupCode: 'gptreception',
          versions: sessionVersions
        })
    })
    await withApi(createDependencies({ sessionStore }), async (baseUrl) => {
      const selection = await fetch(`${baseUrl}/api/sessions`, { method: 'POST', headers: authHeaders() })
      expect(selection.status).toBe(409)
      expect(await selection.json()).toEqual({
        error: 'Choose one assigned budget group for this session',
        availableGroups: [{ code: 'gptnursing', name: 'GPT Nursing' }, { code: 'gptreception', name: 'GPT Reception' }]
      })

      const created = await fetch(`${baseUrl}/api/sessions`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ groupCode: 'gptreception' })
      })
      expect(created.status).toBe(201)
      expect((await created.json()).aiBudgetGroupCode).toBe('gptreception')
      expect(sessionStore.createSession).toHaveBeenLastCalledWith(
        { subjectId: 'learner-1', tenantId: 'tenant-a', role: 'learner' },
        sessionVersions,
        'gptreception'
      )
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
    const approvedVariantSettings = {
      schemaVersion: 1 as const,
      status: 'approved' as const,
      revision: 4,
      variants: PATIENT_VARIANT_KEYS.map((variantKey) => ({
        variantKey,
        voiceProfileId: `voice-${variantKey}`,
        voice: {
          provider: 'browser-speech-synthesis' as const,
          voiceId: `voice-${variantKey}`,
          locale: 'en-US',
          rate: 1.1,
          pitch: 0.9,
          volume: 0.75,
          fallbackVoiceId: `fallback-${variantKey}`
        },
        variabilityProfileId: `variability-${variantKey}`,
        variability: {
          mood: { allowedValues: [`mood-${variantKey}`] },
          maturity: { allowedValues: [`maturity-${variantKey}`] },
          verbosity: { allowedValues: [`verbosity-${variantKey}`] },
          educationLevel: { allowedValues: [`education-${variantKey}`] },
          willingnessToDisclose: { allowedValues: [`disclosure-${variantKey}`] }
        }
      }))
    }
    const patientVariantSettingsStore: PatientVariantSettingsStore = {
      getSettings: vi.fn().mockResolvedValue(approvedVariantSettings),
      saveSettings: vi.fn()
    }
    let generatedWithSettings: GeneratedPatientScenario | null = null
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
      readiness: { profile: true, redis: true, conversation: true },
      addonSpendNotice: false
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
          generatedWithSettings = await generate(
            sessionVersions,
            new Date('2026-10-01T00:00:00.000Z'),
            'z'.repeat(43),
            async (usage) => { recordedProviderUsage.push(usage) }
          )
          return {
            ...setupResponse,
            patient: {
              ...setupResponse.patient,
              presentationSettings: generatedWithSettings.presentationSettings
            }
          }
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
    const dependencies = createDependencies({ sessionStore, generatePatientScenario, patientVariantSettingsStore })

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
      expect(firstBody.patient.presentationSettings).toMatchObject({
        variantKey: '3039-average', settingsRevision: 4,
        voiceProfileId: 'voice-3039-average', voiceId: 'voice-3039-average',
        fallbackVoiceId: 'fallback-3039-average'
      })
      expect(generatedWithSettings?.profile.persona).toEqual({
        mood: 'mood-3039-average', maturity: 'maturity-3039-average',
        verbosity: 'verbosity-3039-average', educationLevel: 'education-3039-average',
        willingnessToDisclose: 'disclosure-3039-average'
      })
      expect(patientVariantSettingsStore.getSettings).toHaveBeenCalledWith('tenant-a')
      expect(JSON.stringify(firstBody)).not.toContain('conv_internal_only')
      expect(JSON.stringify(firstBody)).not.toContain('resp_internal_only')
      expect(generatePatientScenario).toHaveBeenCalledOnce()
      expect(generatePatientScenario).toHaveBeenCalledWith(
        sessionVersions, new Date('2026-10-01T00:00:00.000Z'), 'z'.repeat(43),
        expect.any(Function), expect.any(Function), expect.any(Function)
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

  it('enforces capability entitlements before session creation', async () => {
    const sessionStore = createSessionStore({
      createSession: vi.fn().mockResolvedValue('entitlement_denied')
    })
    const dependencies = createDependencies({ sessionStore })
    await withApi(dependencies, async (baseUrl) => {
      const session = await fetch(`${baseUrl}/api/sessions`, { method: 'POST', headers: authHeaders() })
      expect(session.status).toBe(403)
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
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
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
      expect(response.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/i)
      expect(response.headers.get('x-gptmd-turn-id')).toBe(turnId)
      expect(response.headers.get('access-control-expose-headers')).toBe(
        'Server-Timing, X-Request-ID, X-GPTMD-Turn-ID, Content-Disposition'
      )
      const correlationLog = info.mock.calls
        .map(([message]) => JSON.parse(String(message)) as Record<string, unknown>)
        .find((entry) => entry.event === 'patient_turn_request')
      expect(correlationLog).toEqual({
        event: 'patient_turn_request',
        requestId: response.headers.get('x-request-id'),
        turnIdHash: createHash('sha256').update(turnId).digest('hex')
      })
      expect(JSON.stringify(correlationLog)).not.toContain(turnId)
      expect(JSON.stringify(correlationLog)).not.toContain('Where does it hurt?')
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

  it('fails closed when patient-turn token reservations are unavailable', async () => {
    const submitPatientTurn = vi.fn()
    const generatePatientTurn = vi.fn()
    const dependencies = createDependencies({
      generatePatientTurn,
      reserveProviderTokens: null,
      sessionStore: createSessionStore({ submitPatientTurn })
    })

    await withApi(dependencies, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/${'s'.repeat(43)}/turns`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ turnId: 'turn-0001', text: 'Where does it hurt?' })
      })
      expect(response.status).toBe(503)
      expect(generatePatientTurn).not.toHaveBeenCalled()
      expect(submitPatientTurn).not.toHaveBeenCalled()
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

  it('cancels a visit through the authenticated owner-scoped session boundary', async () => {
    const sessionId = randomBytes(32).toString('base64url')
    const cancelSession = vi.fn().mockResolvedValue({ sessionId, status: 'cancelled' as const })
    const sessionStore = createSessionStore({ cancelSession })

    await withApi(createDependencies({ sessionStore }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/cancel`, {
        method: 'POST', headers: authHeaders()
      })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ sessionId, status: 'cancelled' })
      expect(cancelSession).toHaveBeenCalledWith(
        { subjectId: 'learner-1', tenantId: 'tenant-a', role: 'learner' },
        sessionId,
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

  it('records engagement pulses only for authenticated valid session and pulse identifiers', async () => {
    const sessionId = randomBytes(32).toString('base64url')
    const pulseId = '123e4567-e89b-42d3-a456-426614174000'
    const recordEngagementPulse = vi.fn().mockResolvedValue('recorded')
    const sessionStore = createSessionStore({ recordEngagementPulse })
    await withApi(createDependencies({ sessionStore }), async (baseUrl) => {
      const valid = await fetch(`${baseUrl}/api/sessions/${sessionId}/engagement-pulses`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ pulseId })
      })
      expect(valid.status).toBe(204)
      expect(recordEngagementPulse).toHaveBeenCalledWith(
        { subjectId: 'learner-1', tenantId: 'tenant-a', role: 'learner' }, sessionId, pulseId
      )

      const invalid = await fetch(`${baseUrl}/api/sessions/${sessionId}/engagement-pulses`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ pulseId: 'not-a-uuid' })
      })
      expect(invalid.status).toBe(400)
      expect(recordEngagementPulse).toHaveBeenCalledOnce()
    })
  })

  it('hides inactive or foreign sessions when recording engagement', async () => {
    const sessionId = randomBytes(32).toString('base64url')
    const recordEngagementPulse = vi.fn().mockResolvedValue('not_found')
    const sessionStore = createSessionStore({ recordEngagementPulse })
    await withApi(createDependencies({ sessionStore }), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sessions/${sessionId}/engagement-pulses`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ pulseId: '123e4567-e89b-42d3-a456-426614174000' })
      })
      expect(response.status).toBe(404)
    })
  })
})
