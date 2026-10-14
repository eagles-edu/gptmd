import { createHash, randomUUID } from 'node:crypto'
import express, { type ErrorRequestHandler, type Express } from 'express'
import {
  DEFAULT_REQUEST_RATE_LIMITS,
  hashRateLimitKey,
  type RequestRateLimitLimits,
  type RequestRateLimitStore
} from './request-rate-limit.ts'
import { isJwtConfigurationReady, verifyAccessToken, type JwtConfiguration } from './auth.ts'
import {
  BoundedSetupQueue,
  DEFAULT_SETUP_QUEUE_LIMITS,
  SetupQueueFullError,
  SetupQueueTimeoutError,
  type SetupQueueLimits
} from './bounded-setup-queue.ts'
import {
  BoundedProviderCapacity,
  DEFAULT_PROVIDER_CAPACITY_LIMITS,
  ProviderCapacityFullError,
  ProviderCapacityTimeoutError,
  type ProviderCapacityLimits
} from './provider-capacity.ts'
import {
  PATIENT_SCENARIO_POLICY_VERSION,
  PATIENT_SCENARIO_PROMPT_VERSION,
  PATIENT_SCENARIO_SCHEMA_VERSION,
  type GeneratedPatientScenario,
  type PatientScenarioVersionPins
} from './patient-profile.ts'
import {
  AssessmentDraftFieldsSchema,
  AssessmentDraftResponseSchema,
  AssessmentFieldsSchema,
  CurrentEncounterResponseSchema,
  LearnerInputModalitySchema,
  LocalTranscriptUtteranceSchema,
  LocalUtteranceRequestSchema,
  PatientScenarioSetupResponseSchema,
  SessionCreatedResponseSchema,
  type ProviderUsageSample
} from './session-contracts.ts'
import type { PatientTurnGenerationContext } from './patient-turn.ts'
import type { ResponsesTimingRecorder } from './response-timing.ts'
import type { SessionCommitTimingRecorder } from './patient-state-store.ts'
import type { PatientTurnResult, ScenarioSetupResult, SessionStore, StoreResult } from './session-store.ts'
import type { TenantEntitlementAdminStore, TenantEntitlementPolicy } from './tenant-entitlements.ts'
import {
  applyApprovedPatientVariantSettings,
  PatientVariantSettingsSchema,
  type PatientVariantSettings,
  type PatientVariantSettingsStore
} from './patient-variant-settings.ts'
import {
  getOrganizationAiTimePeriodBounds,
  OrganizationAiMemberAssignmentInputSchema,
  OrganizationAiMemberAssignmentImportSchema,
  OrganizationAiTimeBudgetSettingsSchema,
  type OrganizationAiTimeBudgetStore
} from './organization-ai-time-budget.ts'

export interface RedisProbe {
  readonly isOpen: boolean
  connect(): Promise<unknown>
  ping(): Promise<string>
}

export interface PostgresProbe {
  query(): Promise<unknown>
}

export interface ApiDependencies {
  redis: RedisProbe | null
  postgres: PostgresProbe | null
  openaiConfigured: boolean
  generateResponse: ((input: string, recordTiming?: ResponsesTimingRecorder) => Promise<{ id: string; outputText: string }>) | null
  generatePatientScenario: ((
    versions: PatientScenarioVersionPins,
    asOf: Date,
    scenarioSeed: string,
    recordTiming?: ResponsesTimingRecorder,
    recordProviderUsage?: (usage: ProviderUsageSample) => Promise<void>
  ) => Promise<GeneratedPatientScenario>) | null
  generatePatientTurn: ((context: PatientTurnGenerationContext, recordTiming?: ResponsesTimingRecorder) => Promise<{
    responseId: string
    output: unknown
    providerUsage: ProviderUsageSample | null
  }>) | null
  createTranscriptionCall: ((sdpOffer: string) => Promise<{
    answerSdp: string
    providerCallId: string
    providerSessionId: string
  }>) | null
  observeTranscriptionUsage: ((
    providerCallId: string,
    onUsage: (usage: { eventId: string; seconds: number }) => Promise<void>,
    onDisconnect: () => Promise<void>
  ) => Promise<() => Promise<void>>) | null
  hangupTranscriptionCall: ((providerCallId: string) => Promise<void>) | null
  model: string
  jwt: JwtConfiguration
  sessionStore: SessionStore | null
  tenantEntitlementAdminStore?: TenantEntitlementAdminStore | null
  patientVariantSettingsStore?: PatientVariantSettingsStore | null
  organizationAiTimeBudgetStore?: OrganizationAiTimeBudgetStore | null
  setupQueueLimits?: SetupQueueLimits
  providerCapacityLimits?: ProviderCapacityLimits
  recordSessionCommitTiming?: SessionCommitTimingRecorder
  allowedOrigins?: string[]
  trustedProxyAddresses?: string[]
  requestRateLimitStore: RequestRateLimitStore | null
  requestRateLimitLimits?: RequestRateLimitLimits
}

const validInput = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= 12_000

const entitlementLimitKeys = [
  'monthlySessionQuota', 'monthlySessionQuotaPerUser', 'monthlyResponseQuota',
  'monthlyResponseQuotaPerUser', 'responseQuotaPerSession', 'maxActiveSessions',
  'monthlyAudioTranscriptionSessionQuota'
] as const

function parseTenantEntitlementPolicy(value: unknown): TenantEntitlementPolicy | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const booleanKeys = [
    'sessionsEnabled', 'responsesEnabled', 'audioTranscriptionEnabled',
    'audioTranscriptionPrivacyApproved'
  ] as const
  if (booleanKeys.some((key) => typeof record[key] !== 'boolean')) return null
  if (entitlementLimitKeys.some((key) => record[key] !== null &&
    (!Number.isInteger(record[key]) || (record[key] as number) < 0 || (record[key] as number) > 2_147_483_647))) return null
  const allowedKeys = new Set<string>([...booleanKeys, ...entitlementLimitKeys])
  if (Object.keys(record).some((key) => !allowedKeys.has(key)) || Object.keys(record).length !== allowedKeys.size) return null
  return Object.fromEntries([...booleanKeys, ...entitlementLimitKeys].map((key) => [key, record[key]])) as unknown as TenantEntitlementPolicy
}

export function createApiApp(dependencies: ApiDependencies): Express {
  const app = express()
  const setupQueue = new BoundedSetupQueue(dependencies.setupQueueLimits ?? DEFAULT_SETUP_QUEUE_LIMITS)
  const providerCapacity = new BoundedProviderCapacity(
    dependencies.providerCapacityLimits ?? DEFAULT_PROVIDER_CAPACITY_LIMITS
  )
  const requestRateLimits = dependencies.requestRateLimitLimits ?? DEFAULT_REQUEST_RATE_LIMITS
  app.disable('x-powered-by')
  app.set('trust proxy', dependencies.trustedProxyAddresses ?? [])
  app.use((_request, response, next) => {
    response.setHeader('X-Request-ID', randomUUID())
    next()
  })
  app.use((request, response, next) => {
    const origin = request.header('origin')
    const allowed = origin && dependencies.allowedOrigins?.includes(origin)
    if (origin && !allowed) {
      if (request.method === 'OPTIONS') response.sendStatus(403)
      else response.status(403).json({ error: 'Origin is not allowed' })
      return
    }
    if (allowed && origin) {
      response.setHeader('Access-Control-Allow-Origin', origin)
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Idempotency-Key, X-GPTMD-Tenant-ID')
      response.setHeader('Access-Control-Expose-Headers', 'Server-Timing, X-Request-ID, X-GPTMD-Turn-ID')
      response.setHeader('Vary', 'Origin')
    }
    next()
  })
  app.use('/api', async (request, response, next) => {
    const rateLimitStore = dependencies.requestRateLimitStore
    if (!rateLimitStore) {
      response.status(503).json({ error: 'Request rate limiting is unavailable' })
      return
    }
    const clientAddress = request.ip || request.socket.remoteAddress || 'unknown'
    try {
      const allowed = await applyRequestRateLimit(
        rateLimitStore,
        hashRateLimitKey('ip', clientAddress),
        requestRateLimits.perIp,
        requestRateLimits,
        response
      )
      if (allowed) next()
    } catch {
      response.status(503).json({ error: 'Request rate limiting is unavailable' })
    }
  })
  app.use((request, response, next) => {
    if (request.method === 'OPTIONS') response.sendStatus(204)
    else next()
  })
  app.use(express.json({ limit: '1mb' }))

  app.use('/api', async (request, response, next) => {
    if (!dependencies.sessionStore || !isJwtConfigurationReady(dependencies.jwt)) {
      response.status(503).json({ error: 'Authentication and session storage are not configured' })
      return
    }
    const authorization = request.header('authorization')
    const match = authorization?.match(/^Bearer ([A-Za-z0-9_.-]+)$/)
    const identity = match ? await verifyAccessToken(match[1] ?? '', dependencies.jwt) : null
    if (!identity) {
      response.status(401).json({ error: 'Valid bearer authentication is required' })
      return
    }
    try {
      const rateLimitStore = dependencies.requestRateLimitStore
      if (!rateLimitStore) {
        response.status(503).json({ error: 'Request rate limiting is unavailable' })
        return
      }
      const allowed = await applyRequestRateLimit(
        rateLimitStore,
        hashRateLimitKey(
          'identity',
          `${request.header('x-gptmd-tenant-id') ?? identity.tenantId ?? ''}\u0000${identity.subjectId}`
        ),
        requestRateLimits.perIdentity,
        requestRateLimits,
        response
      )
      if (!allowed) return
      if (request.method === 'GET' && request.path === '/account/tenants') {
        request.identity = identity
        next()
        return
      }
      const memberships = await dependencies.sessionStore.getActiveMemberships(identity.subjectId)
      const requestedTenant = request.header('x-gptmd-tenant-id') ?? identity.tenantId
      const selectedMembership = requestedTenant
        ? memberships.find((membership) => membership.tenantId === requestedTenant)
        : memberships.length === 1 ? memberships[0] : undefined
      if (memberships.length === 0) {
        response.status(403).json({ error: 'Active tenant membership is required' })
        return
      }
      if (!selectedMembership && memberships.length > 1 && !requestedTenant) {
        response.status(409).json({ error: 'Choose an active GPTMD tenant before continuing' })
        return
      }
      if (!selectedMembership) {
        response.status(403).json({ error: 'Active tenant membership is required' })
        return
      }
      const principal = {
        subjectId: identity.subjectId,
        tenantId: selectedMembership.tenantId,
        role: selectedMembership.role
      }
      if (request.path.startsWith('/admin/')) {
        if (principal.role !== 'customer_admin') {
          response.status(403).json({ error: 'Customer administrator role is required' })
          return
        }
      } else if (request.path.startsWith('/instructor/')) {
        if (principal.role !== 'instructor') {
          response.status(403).json({ error: 'Instructor role is required' })
          return
        }
      } else if (principal.role !== 'learner') {
        response.status(403).json({ error: 'Learner role is required for encounter API routes' })
        return
      }
      request.principal = principal
      next()
    } catch {
      response.status(503).json({ error: 'Authentication service is unavailable' })
    }
  })

  app.get('/healthz', (_request, response) => {
    response.json({ status: 'ok', service: 'gptmd-api' })
  })

  app.get('/api/account/tenants', async (request, response) => {
    const identity = request.identity
    if (!identity || !dependencies.sessionStore) {
      response.status(401).json({ error: 'Valid bearer authentication is required' })
      return
    }
    try {
      response.json({ memberships: await dependencies.sessionStore.getActiveMemberships(identity.subjectId) })
    } catch {
      response.status(503).json({ error: 'Account service is unavailable' })
    }
  })

  app.get('/api/admin/entitlements', async (request, response) => {
    const principal = request.principal
    const store = dependencies.tenantEntitlementAdminStore
    if (!principal || principal.role !== 'customer_admin') {
      response.status(403).json({ error: 'Customer administrator role is required' })
      return
    }
    if (!store) {
      response.status(503).json({ error: 'Entitlement administration is unavailable' })
      return
    }
    try {
      const policy = await store.getPolicy(principal.tenantId)
      if (!policy) response.status(404).json({ error: 'Workspace not found' })
      else response.json({ policy })
    } catch {
      response.status(503).json({ error: 'Entitlement policy could not be loaded' })
    }
  })

  app.put('/api/admin/entitlements', async (request, response) => {
    const principal = request.principal
    const store = dependencies.tenantEntitlementAdminStore
    if (!principal || principal.role !== 'customer_admin') {
      response.status(403).json({ error: 'Customer administrator role is required' })
      return
    }
    if (!store) {
      response.status(503).json({ error: 'Entitlement administration is unavailable' })
      return
    }
    const policy = parseTenantEntitlementPolicy(request.body)
    if (!policy) {
      response.status(400).json({ error: 'Provide all entitlement flags and non-negative integer limits; use null for unlimited limits' })
      return
    }
    try {
      const updated = await store.updatePolicy(principal.tenantId, principal.subjectId, policy)
      if (!updated) response.status(404).json({ error: 'Workspace not found' })
      else response.json({ policy: updated })
    } catch {
      response.status(503).json({ error: 'Entitlement policy could not be saved' })
    }
  })

  app.get('/api/admin/ai-time-budget', async (request, response) => {
    const principal = request.principal
    const store = dependencies.organizationAiTimeBudgetStore
    if (!principal || principal.role !== 'customer_admin') {
      response.status(403).json({ error: 'Customer administrator role is required' })
      return
    }
    if (!store) {
      response.status(503).json({ error: 'AI-time budget controls are unavailable' })
      return
    }
    try {
      const settings = await store.getSettings(principal.tenantId)
      let usage = null
      if (settings) {
        const period = getOrganizationAiTimePeriodBounds(
          settings.organizationPeriod.anchorDate,
          settings.organizationPeriod.months
        )
        usage = await store.getUsageSummary(principal.tenantId, period.startAt, period.endAt)
      }
      response.json({ settings, usage })
    } catch {
      response.status(503).json({ error: 'AI-time budget settings could not be loaded' })
    }
  })

  app.put('/api/admin/ai-time-budget', async (request, response) => {
    const principal = request.principal
    const store = dependencies.organizationAiTimeBudgetStore
    if (!principal || principal.role !== 'customer_admin') {
      response.status(403).json({ error: 'Customer administrator role is required' })
      return
    }
    if (!store) {
      response.status(503).json({ error: 'AI-time budget controls are unavailable' })
      return
    }
    const parsed = OrganizationAiTimeBudgetSettingsSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Provide bounded pool and group budgets, a period, and unique group and department codes' })
      return
    }
    try {
      const settings = await store.saveSettings(principal.tenantId, principal.subjectId, parsed.data)
      if (settings === 'conflict') response.status(409).json({ error: 'AI-time budget settings changed; reload before saving' })
      else if (settings === 'assignments_exist') {
        response.status(409).json({ error: 'Move member assignments before deleting an assigned group or department' })
      }
      else if (!settings) response.status(404).json({ error: 'Workspace not found' })
      else {
        const period = getOrganizationAiTimePeriodBounds(
          settings.organizationPeriod.anchorDate,
          settings.organizationPeriod.months
        )
        const usage = await store.getUsageSummary(principal.tenantId, period.startAt, period.endAt)
        response.json({ settings, usage })
      }
    } catch {
      response.status(503).json({ error: 'AI-time budget settings could not be saved' })
    }
  })

  app.get('/api/admin/ai-time-budget/assignments', async (request, response) => {
    const principal = request.principal
    const store = dependencies.organizationAiTimeBudgetStore
    if (!principal || principal.role !== 'customer_admin') {
      response.status(403).json({ error: 'Customer administrator role is required' })
      return
    }
    if (!store) {
      response.status(503).json({ error: 'AI-time assignment controls are unavailable' })
      return
    }
    try {
      const settings = await store.getSettings(principal.tenantId)
      const members = await store.listMemberAssignments(principal.tenantId)
      response.json({
        members,
        groups: settings?.groups.map(({ code, name }) => ({ code, name })) ?? [],
        departments: settings?.departments ?? []
      })
    } catch {
      response.status(503).json({ error: 'AI-time member assignments could not be loaded' })
    }
  })

  app.put('/api/admin/ai-time-budget/assignments', async (request, response) => {
    const principal = request.principal
    const store = dependencies.organizationAiTimeBudgetStore
    if (!principal || principal.role !== 'customer_admin') {
      response.status(403).json({ error: 'Customer administrator role is required' })
      return
    }
    if (!store) {
      response.status(503).json({ error: 'AI-time assignment controls are unavailable' })
      return
    }
    const parsed = OrganizationAiMemberAssignmentInputSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Provide one active member, unique group codes, and a department code or null' })
      return
    }
    try {
      const assignment = await store.saveMemberAssignment(
        principal.tenantId, principal.subjectId, parsed.data
      )
      if (assignment === 'conflict') {
        response.status(409).json({ error: 'Save organization groups and departments before assigning members' })
      } else if (assignment === 'invalid') {
        response.status(400).json({ error: 'Assignments must reference groups and departments in this workspace' })
      } else if (!assignment) {
        response.status(404).json({ error: 'Active workspace member not found' })
      } else response.json({ assignment })
    } catch {
      response.status(503).json({ error: 'AI-time member assignment could not be saved' })
    }
  })

  app.post('/api/admin/ai-time-budget/assignments/import', async (request, response) => {
    const principal = request.principal
    const store = dependencies.organizationAiTimeBudgetStore
    if (!principal || principal.role !== 'customer_admin') {
      response.status(403).json({ error: 'Customer administrator role is required' })
      return
    }
    if (!store) {
      response.status(503).json({ error: 'AI-time assignment controls are unavailable' })
      return
    }
    const parsed = OrganizationAiMemberAssignmentImportSchema.safeParse(request.body?.assignments)
    if (!parsed.success) {
      response.status(400).json({ error: 'Provide 1 to 500 valid spreadsheet rows' })
      return
    }
    if (new Set(parsed.data.map(({ subjectId }) => subjectId)).size !== parsed.data.length) {
      response.status(400).json({ error: 'Spreadsheet rows must not repeat a member' })
      return
    }
    try {
      const saved = []
      const failures: Array<{ subjectId: string; error: string }> = []
      for (const assignment of parsed.data) {
        const result = await store.saveMemberAssignment(principal.tenantId, principal.subjectId, assignment)
        if (result === 'invalid') failures.push({ subjectId: assignment.subjectId, error: 'Unknown group or department' })
        else if (result === 'conflict') failures.push({ subjectId: assignment.subjectId, error: 'Save department and group catalogs first' })
        else if (!result) failures.push({ subjectId: assignment.subjectId, error: 'Active workspace member not found' })
        else saved.push(result)
      }
      response.json({ imported: saved.length, failures })
    } catch {
      response.status(503).json({ error: 'Spreadsheet assignments could not be imported' })
    }
  })

  app.get('/api/instructor/patient-variant-settings', async (request, response) => {
    const principal = request.principal
    const store = dependencies.patientVariantSettingsStore
    if (!principal || principal.role !== 'instructor') {
      response.status(403).json({ error: 'Instructor role is required' })
      return
    }
    if (!store) {
      response.status(503).json({ error: 'Patient variant settings are unavailable' })
      return
    }
    try {
      const settings = await store.getSettings(principal.tenantId)
      response.json({ settings })
    } catch {
      response.status(503).json({ error: 'Patient variant settings could not be loaded' })
    }
  })

  app.put('/api/instructor/patient-variant-settings', async (request, response) => {
    const principal = request.principal
    const store = dependencies.patientVariantSettingsStore
    if (!principal || principal.role !== 'instructor') {
      response.status(403).json({ error: 'Instructor role is required' })
      return
    }
    if (!store) {
      response.status(503).json({ error: 'Patient variant settings are unavailable' })
      return
    }
    const parsed = PatientVariantSettingsSchema.safeParse(request.body)
    if (!parsed.success) {
      response.status(400).json({ error: 'Provide settings for all ten variants; approved settings must be complete and bounded' })
      return
    }
    try {
      const settings = await store.saveSettings(principal.tenantId, principal.subjectId, parsed.data)
      if (settings === 'conflict') response.status(409).json({ error: 'Patient variant settings changed; reload before saving' })
      else if (!settings) response.status(404).json({ error: 'Workspace not found' })
      else response.json({ settings })
    } catch {
      response.status(503).json({ error: 'Patient variant settings could not be saved' })
    }
  })

  app.post('/api/sessions/:sessionId/audio-transcription', async (request, response) => {
    const principal = request.principal
    const store = dependencies.sessionStore
    const sessionId = request.params.sessionId ?? ''
    if (!principal || !store) {
      response.status(401).json({ error: 'Valid bearer authentication is required' })
      return
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId)) {
      response.status(404).json({ error: 'Session not found' })
      return
    }
    if (request.body?.consentVersion !== 'gptmd-audio-transcription-v1') {
      response.status(400).json({ error: 'Current explicit audio-transcription consent is required' })
      return
    }
    const sdpOffer = request.body?.sdp
    if (typeof sdpOffer !== 'string' || !sdpOffer.trim() || sdpOffer.length > 128_000) {
      response.status(400).json({ error: 'A valid secure audio connection offer is required' })
      return
    }
    if (!dependencies.createTranscriptionCall || !dependencies.observeTranscriptionUsage || !dependencies.hangupTranscriptionCall) {
      response.status(503).json({ error: 'Cross-browser speech transcription is not configured' })
      return
    }
    try {
      const grant = await store.createAudioTranscriptionGrant(
        principal, sessionId, 'gptmd-audio-transcription-v1'
      )
      if (typeof grant === 'string') {
        if (grant === 'membership_missing') response.status(403).json({ error: 'Active tenant membership is required' })
        else if (grant === 'entitlement_denied') response.status(403).json({ error: 'Tenant plan or audio privacy approval does not allow voice transcription' })
        else response.status(429).json({ error: 'Monthly voice transcription allowance is exhausted' })
        return
      }
      const call = await dependencies.createTranscriptionCall(sdpOffer)
      let closeUsageObserver: (() => Promise<void>) | null = null
      try {
        await store.recordAudioProviderSession(
          grant.grantId, call.providerSessionId, call.providerCallId
        )
        closeUsageObserver = await dependencies.observeTranscriptionUsage(
          call.providerCallId,
          (usage) => store.recordAudioTranscriptionUsage(call.providerCallId, usage.eventId, usage.seconds),
          async () => {
            await store.setAudioUsageObserverStatus(call.providerCallId, 'interrupted').catch(() => undefined)
            await dependencies.hangupTranscriptionCall?.(call.providerCallId).catch(() => undefined)
          }
        )
        await store.setAudioUsageObserverStatus(call.providerCallId, 'connected')
      } catch (error) {
        await closeUsageObserver?.()
        await store.setAudioUsageObserverStatus(call.providerCallId, 'interrupted').catch(() => undefined)
        await dependencies.hangupTranscriptionCall(call.providerCallId).catch(() => undefined)
        throw error
      }
      response.json({
        answerSdp: call.answerSdp,
        maxDurationSeconds: 900
      })
    } catch {
      response.status(503).json({ error: 'Voice transcription could not be authorized or initialized' })
    }
  })

  app.get('/readyz', async (_request, response) => {
    const checks = await Promise.allSettled([
      dependencies.redis
        ? (async () => {
            if (!dependencies.redis?.isOpen) await dependencies.redis?.connect()
            await dependencies.redis?.ping()
          })()
        : Promise.reject(new Error('not configured')),
      dependencies.postgres
        ? dependencies.postgres.query()
        : Promise.reject(new Error('not configured'))
    ])

    const redis = checks[0]?.status === 'fulfilled'
      ? 'ready'
      : dependencies.redis ? 'unavailable' : 'missing'
    const postgres = checks[1]?.status === 'fulfilled'
      ? 'ready'
      : dependencies.postgres ? 'unavailable' : 'missing'
    const openai = dependencies.openaiConfigured ? 'configured' : 'missing'
    const auth = isJwtConfigurationReady(dependencies.jwt) ? 'configured' : 'missing'
    const ready = redis === 'ready' && postgres === 'ready' && openai === 'configured' && auth === 'configured'

    response.status(ready ? 200 : 503).json({
      status: ready ? 'ready' : 'not_ready',
      service: 'gptmd-api',
      dependencies: { redis, postgres, openai, auth }
    })
  })

  app.post('/api/openai/responses', async (request, response) => {
    if (!validInput(request.body?.input)) {
      response.status(400).json({ error: 'input must be a non-empty string of at most 12000 characters' })
      return
    }

    if (!dependencies.generateResponse) {
      response.status(503).json({ error: 'OpenAI is not configured' })
      return
    }

    const principal = request.principal
    if (!principal || !dependencies.sessionStore) {
      response.status(401).json({ error: 'Valid bearer authentication is required' })
      return
    }

    try {
      let usageResult: StoreResult = 'allowed'
      const result = await providerCapacity.run('interactive', async () => {
        try {
          usageResult = await dependencies.sessionStore!.consumeQuota(principal, 'responses')
        } catch {
          throw new Error('usage_authorization_failed')
        }
        if (usageResult !== 'allowed') return null
        return dependencies.generateResponse!(
          request.body.input,
          (stage, elapsedMs) => appendResponseTiming(response, stage, elapsedMs)
        )
      },
        (waitMs) => appendServerTiming(response, 'interactive_capacity_wait', waitMs))
      if (usageResult !== 'allowed') {
        quotaResponse(usageResult, response)
        return
      }
      if (!result) return
      response.json({ id: result.id, outputText: result.outputText })
    } catch (error) {
      if (isProviderCapacityError(error)) {
        providerCapacityResponse(response, 'Interactive response capacity is unavailable; retry the request.')
        return
      }
      if (error instanceof Error && error.message === 'usage_authorization_failed') {
        response.status(503).json({ error: 'Usage authorization is unavailable' })
        return
      }
      response.status(502).json({ error: 'OpenAI request failed' })
    }
  })

  app.post('/api/sessions', async (request, response) => {
    const principal = request.principal
    const store = dependencies.sessionStore
    if (!principal || !store) {
      response.status(401).json({ error: 'Valid bearer authentication is required' })
      return
    }
    try {
      const requestedGroupCode = request.body?.groupCode
      if (requestedGroupCode !== undefined &&
          (typeof requestedGroupCode !== 'string' || !/^[a-z][a-z0-9_-]{1,39}$/.test(requestedGroupCode))) {
        response.status(400).json({ error: 'groupCode must name an assigned budget group' })
        return
      }
      const versions: PatientScenarioVersionPins = {
        promptVersion: PATIENT_SCENARIO_PROMPT_VERSION,
        modelVersion: dependencies.model,
        schemaVersion: PATIENT_SCENARIO_SCHEMA_VERSION,
        policyVersion: PATIENT_SCENARIO_POLICY_VERSION
      }
      const result = requestedGroupCode === undefined
        ? await store.createSession(principal, versions)
        : await store.createSession(principal, versions, requestedGroupCode)
      if (typeof result === 'object' && result.status === 'group_selection_required') {
        response.status(409).json({
          error: 'Choose one assigned budget group for this session',
          availableGroups: result.availableGroups
        })
        return
      }
      if (typeof result === 'string') {
        if (result === 'group_assignment_missing') {
          response.status(403).json({ error: 'A budget group must be assigned before starting a session' })
          return
        }
        if (result === 'group_assignment_denied') {
          response.status(403).json({ error: 'The selected budget group is not assigned to this member' })
          return
        }
        quotaResponse(result, response)
        return
      }
      response.status(201).json(SessionCreatedResponseSchema.parse(result))
    } catch {
      response.status(503).json({ error: 'Session service is unavailable' })
    }
  })

  app.get('/api/encounters/current', async (request, response) => {
    const principal = request.principal
    const store = dependencies.sessionStore
    if (!principal || !store) {
      response.status(401).json({ error: 'Valid bearer authentication is required' })
      return
    }
    try {
      const encounter = await store.getCurrentOwnedEncounter(principal)
      response.json(CurrentEncounterResponseSchema.parse({ encounter }))
    } catch {
      response.status(503).json({ error: 'Current encounter could not be restored' })
    }
  })

  app.post('/api/sessions/:sessionId/setup', async (request, response) => {
    const principal = request.principal
    const store = dependencies.sessionStore
    const sessionId = request.params.sessionId
    const idempotencyKey = request.header('idempotency-key')
    if (!principal || !store) {
      response.status(401).json({ error: 'Valid bearer authentication is required' })
      return
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId ?? '')) {
      response.status(404).json({ error: 'Session not found' })
      return
    }
    if (!idempotencyKey || !/^[\x21-\x7e]{8,200}$/.test(idempotencyKey)) {
      response.status(400).json({ error: 'A printable Idempotency-Key of 8 to 200 characters is required' })
      return
    }
    if (!dependencies.generatePatientScenario) {
      response.status(503).json({ error: 'Patient scenario generation is not configured' })
      return
    }

    try {
      const result: ScenarioSetupResult = await setupQueue.run(() => store.setupScenario(
        principal,
        sessionId,
        idempotencyKey,
        async (versions, asOf, scenarioSeed, recordProviderUsage) => {
          const settings: PatientVariantSettings | null | undefined =
            await dependencies.patientVariantSettingsStore?.getSettings(principal.tenantId)
          return providerCapacity.run('setup', async () => {
            const generated = await dependencies.generatePatientScenario!(
              versions,
              asOf,
              scenarioSeed,
              (stage, elapsedMs) => appendResponseTiming(response, stage, elapsedMs),
              recordProviderUsage
            )
            if (settings?.status !== 'approved') return generated
            return {
              ...generated,
              ...applyApprovedPatientVariantSettings(generated.profile, asOf, scenarioSeed, settings)
            }
          }, (waitMs) => appendServerTiming(response, 'setup_provider_capacity_wait', waitMs))
        }
      ), (waitMs) => appendServerTiming(response, 'setup_queue_wait', waitMs))
      if (typeof result === 'string') {
        if (result === 'not_found') response.status(404).json({ error: 'Session not found' })
        else if (result === 'idempotency_conflict') {
          response.status(409).json({ error: 'Session setup was already started with another Idempotency-Key' })
        } else if (result === 'version_unavailable') {
          response.status(503).json({ error: 'Pinned patient scenario versions are unavailable' })
        } else if (result === 'state_unavailable') {
          response.status(503).json({ error: 'Patient state storage is unavailable' })
        } else if (result === 'entitlement_denied') {
          response.status(403).json({ error: 'Tenant plan does not include this capability' })
        } else response.status(409).json({ error: 'Session is not available for setup' })
        return
      }
      response.json(PatientScenarioSetupResponseSchema.parse(result))
    } catch (error) {
      if (isProviderCapacityError(error)) {
        providerCapacityResponse(response, 'Patient setup provider capacity is unavailable; retry with the same Idempotency-Key.')
        return
      }
      if (error instanceof SetupQueueFullError || error instanceof SetupQueueTimeoutError) {
        response.setHeader('Retry-After', '1')
        response.status(503).json({
          error: 'Patient setup capacity is unavailable; retry with the same Idempotency-Key.'
        })
        return
      }
      response.status(503).json({ error: 'Patient scenario setup could not be completed' })
    }
  })

  app.post('/api/sessions/:sessionId/turns', async (request, response) => {
    const principal = request.principal
    const store = dependencies.sessionStore
    const sessionId = request.params.sessionId ?? ''
    const turnId = request.body?.turnId
    const learnerMessage = request.body?.text
    const rawModality = request.body?.modality
    if (!principal || !store) {
      response.status(401).json({ error: 'Valid bearer authentication is required' })
      return
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId)) {
      response.status(404).json({ error: 'Session not found' })
      return
    }
    if (typeof turnId !== 'string' || !/^[\x21-\x7e]{8,200}$/.test(turnId)) {
      response.status(400).json({ error: 'A printable turnId of 8 to 200 characters is required' })
      return
    }
    if (!validInput(learnerMessage) || learnerMessage.length > 8_000) {
      response.status(400).json({ error: 'text must be a non-empty string of at most 8000 characters' })
      return
    }
    const requestId = response.getHeader('X-Request-ID')
    const turnIdHash = createHash('sha256').update(turnId).digest('hex')
    response.setHeader('X-GPTMD-Turn-ID', turnId)
    console.info(JSON.stringify({ event: 'patient_turn_request', requestId, turnIdHash }))
    const parsedModality = rawModality === undefined
      ? { success: true as const, data: 'typed' as const }
      : LearnerInputModalitySchema.safeParse(rawModality)
    if (!parsedModality.success) {
      response.status(400).json({ error: 'modality must be typed or realtime_transcription' })
      return
    }
    if (!dependencies.generatePatientTurn) {
      response.status(503).json({ error: 'Patient turn generation is not configured' })
      return
    }

    try {
      const result = await providerCapacity.run('interactive',
        () => store.submitPatientTurn(
          principal,
          sessionId,
          turnId,
          learnerMessage.trim(),
          (context) => dependencies.generatePatientTurn!(
            context,
            (stage, elapsedMs) => appendResponseTiming(response, stage, elapsedMs)
          ),
          parsedModality.data,
          (waitMs) => appendServerTiming(response, 'session_lock_attempt', waitMs),
          (operation, elapsedMs) => reportSessionCommitTiming(response, dependencies, operation, elapsedMs)
        ),
        (waitMs) => appendServerTiming(response, 'interactive_capacity_wait', waitMs))
      if (typeof result === 'object') {
        response.json({ turnId: result.turnId, text: result.patientResponse })
        return
      }
      turnResultResponse(result, response)
    } catch (error) {
      if (isProviderCapacityError(error)) {
        providerCapacityResponse(response, 'Interactive response capacity is unavailable; retry with the same turnId.')
        return
      }
      response.status(503).json({ error: 'Patient turn could not be completed' })
    }
  })

  app.post('/api/sessions/:sessionId/assessment-phase', async (request, response) => {
    const principal = request.principal
    const store = dependencies.sessionStore
    const sessionId = request.params.sessionId ?? ''
    if (!principal || !store) {
      response.status(401).json({ error: 'Valid bearer authentication is required' })
      return
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId)) {
      response.status(404).json({ error: 'Session not found' })
      return
    }
    try {
      const result = await store.beginAssessment(
        principal,
        sessionId,
        (operation, elapsedMs) => reportSessionCommitTiming(response, dependencies, operation, elapsedMs)
      )
      if (result === 'assessment') {
        response.json({ sessionId, phase: 'assessment' })
      } else if (result === 'not_found') {
        response.status(404).json({ error: 'Session not found' })
      } else if (result === 'not_ready') {
        response.status(409).json({ error: 'Complete at least one history turn before beginning assessment' })
      } else if (result === 'turn_in_progress') {
        response.status(409).json({ error: 'Another action is being processed for this session' })
      } else if (result === 'phase_conflict') {
        response.status(409).json({ error: 'The encounter phase could not be changed' })
      } else {
        response.status(503).json({ error: 'Encounter state is unavailable' })
      }
    } catch {
      response.status(503).json({ error: 'Encounter phase could not be saved' })
    }
  })

  app.post('/api/sessions/:sessionId/local-utterances', async (request, response) => {
    const principal = request.principal
    const store = dependencies.sessionStore
    const sessionId = request.params.sessionId ?? ''
    if (!principal || !store) {
      response.status(401).json({ error: 'Valid bearer authentication is required' })
      return
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId)) {
      response.status(404).json({ error: 'Session not found' })
      return
    }
    const utterance = LocalUtteranceRequestSchema.safeParse(request.body)
    if (!utterance.success) {
      response.status(400).json({ error: 'A valid local transcript utterance is required' })
      return
    }
    try {
      const result = await store.recordLocalUtterance(principal, sessionId, utterance.data)
      if (typeof result === 'object') {
        response.json(LocalTranscriptUtteranceSchema.parse(result))
      } else if (result === 'not_found') {
        response.status(404).json({ error: 'Session not found' })
      } else if (result === 'not_ready') {
        response.status(409).json({ error: 'The encounter is not ready to save a local transcript utterance' })
      } else if (result === 'turn_in_progress') {
        response.status(409).json({ error: 'Another action is being processed for this session' })
      } else if (result === 'phase_conflict') {
        response.status(409).json({ error: 'Local voice repair is only available during history taking' })
      } else {
        response.status(503).json({ error: 'Transcript storage is unavailable' })
      }
    } catch {
      response.status(503).json({ error: 'Local transcript utterance could not be saved' })
    }
  })

  app.put('/api/sessions/:sessionId/assessment-draft', async (request, response) => {
    const principal = request.principal
    const store = dependencies.sessionStore
    const sessionId = request.params.sessionId ?? ''
    if (!principal || !store) {
      response.status(401).json({ error: 'Valid bearer authentication is required' })
      return
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId)) {
      response.status(404).json({ error: 'Session not found' })
      return
    }
    const revision = request.body?.revision
    if (!Number.isSafeInteger(revision) || revision < 1) {
      response.status(400).json({ error: 'A positive draft revision is required' })
      return
    }
    const fields = AssessmentDraftFieldsSchema.safeParse({
      summary: request.body?.summary,
      differential: request.body?.differential,
      rationale: request.body?.rationale,
      plan: request.body?.plan
    })
    if (!fields.success) {
      response.status(400).json({ error: 'Assessment draft fields exceed their allowed lengths' })
      return
    }
    try {
      const result = await store.saveAssessmentDraft(principal, sessionId, revision, fields.data)
      if (typeof result === 'object') {
        response.json(AssessmentDraftResponseSchema.parse(result))
      } else if (result === 'not_found') {
        response.status(404).json({ error: 'Session not found' })
      } else if (result === 'not_ready') {
        response.status(409).json({ error: 'Begin the assessment phase before saving a draft' })
      } else if (result === 'turn_in_progress') {
        response.status(409).json({ error: 'Another action is being processed for this session' })
      } else if (result === 'phase_conflict') {
        response.status(409).json({ error: 'The assessment is already submitted or this session is no longer editable' })
      } else {
        response.status(503).json({ error: 'Assessment draft storage is unavailable' })
      }
    } catch {
      response.status(503).json({ error: 'Assessment draft could not be saved' })
    }
  })

  app.post('/api/sessions/:sessionId/assessment', async (request, response) => {
    const principal = request.principal
    const store = dependencies.sessionStore
    const sessionId = request.params.sessionId ?? ''
    if (!principal || !store) {
      response.status(401).json({ error: 'Valid bearer authentication is required' })
      return
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId)) {
      response.status(404).json({ error: 'Session not found' })
      return
    }
    const assessmentId = request.body?.assessmentId
    if (typeof assessmentId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(assessmentId)) {
      response.status(400).json({ error: 'A valid assessmentId is required' })
      return
    }
    const fields = AssessmentFieldsSchema.safeParse({
      summary: request.body?.summary,
      differential: request.body?.differential,
      rationale: request.body?.rationale,
      plan: request.body?.plan
    })
    if (!fields.success) {
      const fieldErrors: Record<string, string> = {}
      for (const issue of fields.error.issues) {
        const field = issue.path[0]
        if (typeof field === 'string' && !fieldErrors[field]) {
          fieldErrors[field] = issue.code === 'too_small'
            ? 'This field is required.'
            : `Use no more than ${issue.code === 'too_big' ? issue.maximum : 'the allowed'} characters.`
        }
      }
      response.status(422).json({ error: 'Complete each assessment field before submitting.', fieldErrors })
      return
    }
    try {
      const result = await store.submitAssessment(
        principal,
        sessionId,
        assessmentId,
        fields.data,
        (operation, elapsedMs) => reportSessionCommitTiming(response, dependencies, operation, elapsedMs)
      )
      if (typeof result === 'object') {
        response.json(result)
      } else if (result === 'not_found') {
        response.status(404).json({ error: 'Session not found' })
      } else if (result === 'not_ready') {
        response.status(409).json({ error: 'Begin the assessment phase before submitting' })
      } else if (result === 'turn_in_progress') {
        response.status(409).json({ error: 'Another action is being processed for this session' })
      } else if (result === 'phase_conflict') {
        response.status(409).json({ error: 'An assessment has already been submitted for this encounter' })
      } else {
        response.status(503).json({ error: 'Assessment could not be saved' })
      }
    } catch {
      response.status(503).json({ error: 'Assessment could not be saved' })
    }
  })

  app.post('/api/sessions/:sessionId/cancel', async (request, response) => {
    const principal = request.principal
    const store = dependencies.sessionStore
    const sessionId = request.params.sessionId ?? ''
    if (!principal || !store) {
      response.status(401).json({ error: 'Valid bearer authentication is required' })
      return
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId)) {
      response.status(404).json({ error: 'Session not found' })
      return
    }
    try {
      const result = await store.cancelSession(
        principal,
        sessionId,
        (operation, elapsedMs) => reportSessionCommitTiming(response, dependencies, operation, elapsedMs)
      )
      if (typeof result === 'object') {
        response.json(result)
      } else if (result === 'not_found') {
        response.status(404).json({ error: 'Session not found' })
      } else if (result === 'not_ready') {
        response.status(409).json({ error: 'Only a ready or active visit can be cancelled' })
      } else if (result === 'turn_in_progress') {
        response.status(409).json({ error: 'Another action is being processed for this session' })
      } else if (result === 'phase_conflict') {
        response.status(409).json({ error: 'A completed visit cannot be cancelled' })
      } else {
        response.status(503).json({ error: 'Visit cancellation could not be saved' })
      }
    } catch {
      response.status(503).json({ error: 'Visit cancellation could not be saved' })
    }
  })

  app.get('/api/sessions/:sessionId', async (request, response) => {
    const principal = request.principal
    const store = dependencies.sessionStore
    const sessionId = request.params.sessionId
    if (!principal || !store) {
      response.status(401).json({ error: 'Valid bearer authentication is required' })
      return
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(sessionId ?? '')) {
      response.status(404).json({ error: 'Session not found' })
      return
    }
    try {
      const session = await store.getOwnedSession(principal, sessionId ?? '')
      if (!session) {
        response.status(404).json({ error: 'Session not found' })
        return
      }
      await store.ensureLiveState?.(principal, sessionId ?? '')
      response.json(session)
    } catch {
      response.status(503).json({ error: 'Session service is unavailable' })
    }
  })

  const requestErrorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
    const type = typeof error === 'object' && error !== null && 'type' in error
      ? error.type
      : undefined
    if (type === 'entity.too.large') {
      response.status(413).json({ error: 'Request body exceeds the 1 MB limit' })
      return
    }
    if (type === 'entity.parse.failed') {
      response.status(400).json({ error: 'Request body must contain valid JSON' })
      return
    }
    response.status(500).json({ error: 'Internal server error' })
  }
  app.use(requestErrorHandler)

  return app
}

function quotaResponse(result: StoreResult, response: import('express').Response): boolean {
  if (result === 'allowed') return false
  if (result === 'membership_missing') {
    response.status(403).json({ error: 'Active tenant membership is required' })
  } else if (result === 'entitlement_denied') {
    response.status(403).json({ error: 'Tenant plan does not include this capability' })
  } else {
    response.status(429).json({ error: 'Tenant usage quota exceeded' })
  }
  return true
}

async function applyRequestRateLimit(
  store: RequestRateLimitStore,
  key: string,
  maximum: number,
  limits: RequestRateLimitLimits,
  response: import('express').Response
): Promise<boolean> {
  const counter = await store.increment(key, limits.windowSeconds)
  if (!Number.isSafeInteger(counter.count) || counter.count < 1 ||
      !Number.isSafeInteger(counter.ttlSeconds) || counter.ttlSeconds < 0) {
    throw new Error('Request rate limiter returned an invalid counter')
  }
  if (counter.count <= maximum) return true
  const retryAfterSeconds = Math.max(1, counter.ttlSeconds)
  response.setHeader('Retry-After', String(retryAfterSeconds))
  response.status(429).json({ error: 'Too many requests; retry later' })
  return false
}

function appendServerTiming(response: import('express').Response, name: string, durationMs: number): void {
  const current = response.getHeader('Server-Timing')
  const entry = `${name};dur=${Math.max(0, durationMs).toFixed(3)}`
  response.setHeader('Server-Timing', current ? `${current}, ${entry}` : entry)
}

function reportSessionCommitTiming(
  response: import('express').Response,
  dependencies: ApiDependencies,
  operation: Parameters<SessionCommitTimingRecorder>[0],
  elapsedMs: number
): void {
  appendServerTiming(response, `redis_${operation}_state_event_commit`, elapsedMs)
  try {
    dependencies.recordSessionCommitTiming?.(operation, elapsedMs)
  } catch {
    // Operational metrics must not change the payload-critical Redis commit.
  }
}

function appendResponseTiming(
  response: import('express').Response,
  stage: 'first_token' | 'completed',
  elapsedMs: number
): void {
  const metric = stage === 'first_token' ? 'responses_first_token' : 'responses_completion'
  appendServerTiming(response, metric, elapsedMs)
}

function isProviderCapacityError(error: unknown): error is ProviderCapacityFullError | ProviderCapacityTimeoutError {
  return error instanceof ProviderCapacityFullError || error instanceof ProviderCapacityTimeoutError
}

function providerCapacityResponse(
  response: import('express').Response,
  message: string
): void {
  response.setHeader('Retry-After', '1')
  response.status(503).json({ error: message })
}

function turnResultResponse(result: PatientTurnResult, response: import('express').Response): void {
  if (result === 'not_found') response.status(404).json({ error: 'Session not found' })
  else if (result === 'not_ready') response.status(409).json({ error: 'Session is not ready for another turn' })
  else if (result === 'turn_in_progress') response.status(409).json({ error: 'Another turn is being processed for this session' })
  else if (result === 'conflict') response.status(409).json({ error: 'Turn conflicts with the accepted session history' })
  else if (result === 'membership_missing' || result === 'entitlement_denied') {
    response.status(403).json({ error: 'Tenant membership or response entitlement is unavailable' })
  } else if (result === 'quota_exceeded') response.status(429).json({ error: 'Tenant usage quota exceeded' })
  else if (result === 'provider_error') response.status(502).json({ error: 'Patient turn generation failed' })
  else if (result === 'validation_error') response.status(502).json({ error: 'Patient turn did not pass scenario validation' })
  else response.status(503).json({ error: 'Patient session state is unavailable' })
}
