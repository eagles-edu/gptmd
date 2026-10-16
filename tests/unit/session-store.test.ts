import type { Pool, PoolClient } from 'pg'
import { createHash } from 'node:crypto'
import { canonicalJsonStringify } from '../../services/api/src/canonical-json.ts'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedPrincipal } from '../../services/api/src/auth.ts'
import type { LivePatientState, PatientStateStore, ReadyPatientState } from '../../services/api/src/patient-state-store.ts'
import { createPostgresSessionStore } from '../../services/api/src/session-store.ts'
import { derivePatientSetup } from '../../services/api/src/patient-setup.ts'
import type { GeneratedPatientScenario, PatientScenarioVersionPins } from '../../services/api/src/patient-profile.ts'
import type { ProviderUsageSample } from '../../services/api/src/session-contracts.ts'
import { TEST_PATIENT_PHYSICAL_EXAM_FINDINGS, TEST_PATIENT_VITAL_SIGNS } from '../fixtures/patient-vital-signs.ts'
import { makePainEpisode } from '../fixtures/pain-episodes.ts'

const principal: AuthenticatedPrincipal = { subjectId: 'learner-a', tenantId: 'tenant-a', role: 'learner' }
const sessionId = 's'.repeat(43)
const patientProfileId = 'p'.repeat(43)
const createdAt = new Date('2026-10-01T00:00:00.000Z')
const generated: GeneratedPatientScenario = {
  conversationId: 'conv_private',
  responseId: 'resp_private',
  profile: {
    fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average',
    reasonForVisit: 'Pelvic pain', diagnosis: 'Endometriosis', painHistoryStatus: 'present',
    painEpisodes: [makePainEpisode('pain-1', 'pelvic pain')], history: [],
    vitalSigns: TEST_PATIENT_VITAL_SIGNS,
    physicalExamFindings: TEST_PATIENT_PHYSICAL_EXAM_FINDINGS,
    currentPregnancyStatus: 'unknown', currentMenopausalStatus: 'unknown',
    patientBeliefs: [], supportedExamFindings: [], supportedTestResults: [],
    persona: {
      mood: 'concerned', maturity: 'adult', verbosity: 'moderate',
      educationLevel: 'college', willingnessToDisclose: 'gradual'
    }
  },
  usage: {
    responseId: 'resp_private', model: 'gpt-6-luna', serviceTier: 'default',
    inputTokens: 100, cachedInputTokens: 12, cacheWriteTokens: 0,
    outputTokens: 50, totalTokens: 150, durationMs: 620,
    pricingVersion: 'openai-api-pricing-2026-10-06', estimatedCostUsd: '0.000034920000'
  },
  abandonedConversationIds: [],
  sourceContext: {
    catalogId: 'obgyn-disorders', mode: 'primary_condition_reference_and_simulation_augmentation',
    approvalStatus: 'approved_for_gptmd_educator_input', approvedOn: '2026-10-14',
    approvalScope: 'gptmd_educator_input', sourceRevision: '2026-10-16', sectionCount: 260, conditionCount: 138,
    routineCareRecordCount: 8, probabilityModelReviewedOn: '2026-10-15',
    selectedPrimaryCaseFocus: 'Abnormal uterine bleeding', selectedRecordType: 'condition',
    estimateType: 'modeled encounter relevance, not population incidence',
    sha256: 'a'.repeat(64)
  }
}
const scenarioFingerprint = createHash('sha256').update(canonicalJsonStringify(generated.profile)).digest('hex')
const identityBindingRow = {
  session_id: sessionId,
  tenant_id: principal.tenantId,
  subject_id: principal.subjectId,
  patient_profile_id: patientProfileId,
  provider_conversation_id: generated.conversationId,
  scenario_fingerprint: scenarioFingerprint,
  schema_version: 8
}

function queryResultWithIdentity(defaultRows: unknown[]) {
  return vi.fn(async (sql: string) => sql.includes('FROM session_identity_binding')
    ? { rows: [identityBindingRow], rowCount: 1 }
    : { rows: defaultRows, rowCount: defaultRows.length })
}

describe('tenant membership roles', () => {
  it('returns active workspace IDs and roles for one authenticated subject', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [
        { tenant_id: 'tenant-a', role: 'instructor', sessions_enabled: true, responses_enabled: true, audio_transcription_available: true, brand_name: null, brand_logo_path: null },
        { tenant_id: 'tenant-b', role: 'customer_admin', sessions_enabled: true, responses_enabled: true, audio_transcription_available: true }
      ], rowCount: 2 })
    } as unknown as Pool
    const store = createPostgresSessionStore(pool)

    await expect(store.getActiveMemberships('learner-a')).resolves.toEqual([
      { tenantId: 'tenant-a', role: 'instructor', sessionsEnabled: true, responsesEnabled: true, audioTranscriptionAvailable: true },
      { tenantId: 'tenant-b', role: 'customer_admin', sessionsEnabled: true, responsesEnabled: true, audioTranscriptionAvailable: true }
    ])
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/SELECT m\.tenant_id, m\.role[\s\S]*LEFT JOIN tenant_entitlements[\s\S]*LEFT JOIN tenant_branding[\s\S]*status = 'active'[\s\S]*ORDER BY m\.tenant_id/),
      ['learner-a']
    )
    const query = String(pool.query.mock.calls[0]?.[0])
    expect(query).toContain('audio_transcription_sessions')
    expect(query).toContain('audio_transcription_privacy_approved')
    expect(query).toContain('monthly_audio_transcription_session_quota > audio_usage.used')
  })

  it('returns branding only for the matching branded tenant membership', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [
        { tenant_id: 'vinmed-hospital-demo', role: 'customer_admin', sessions_enabled: false, responses_enabled: false,
          audio_transcription_available: false, brand_name: 'VinMed Hospital', brand_logo_path: '/assets/images/vinmed-logo.svg' },
        { tenant_id: 'other-tenant', role: 'learner', sessions_enabled: false, responses_enabled: false,
          audio_transcription_available: false, brand_name: null, brand_logo_path: null }
      ], rowCount: 2 })
    } as unknown as Pool
    const store = createPostgresSessionStore(pool)

    await expect(store.getActiveMemberships('vinmed-admin')).resolves.toEqual([
      { tenantId: 'vinmed-hospital-demo', role: 'customer_admin', sessionsEnabled: false, responsesEnabled: false,
        audioTranscriptionAvailable: false, branding: { displayName: 'VinMed Hospital', logoPath: '/assets/images/vinmed-logo.svg' } },
      { tenantId: 'other-tenant', role: 'learner', sessionsEnabled: false, responsesEnabled: false,
        audioTranscriptionAvailable: false }
    ])
  })

  it('reports workspace visit features as disabled when no entitlement row exists', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [
        { tenant_id: 'tenant-a', role: 'learner', sessions_enabled: false, responses_enabled: false, audio_transcription_available: false }
      ], rowCount: 1 })
    } as unknown as Pool
    const store = createPostgresSessionStore(pool)

    await expect(store.getActiveMemberships('learner-a')).resolves.toEqual([
      { tenantId: 'tenant-a', role: 'learner', sessionsEnabled: false, responsesEnabled: false, audioTranscriptionAvailable: false }
    ])
  })

  it('takes the tenant snapshot lock before reading assignments and aborts if the tenant is missing', async () => {
    const queries: string[] = []
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql)
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
        if (sql.includes('FROM tenants')) return { rows: [{ tenant_id: principal.tenantId }], rowCount: 1 }
        if (sql.includes('FROM tenant_entitlements')) return { rows: [{
          enabled: true, monthly_quota: null, monthly_user_quota: null, max_active_sessions: null
        }], rowCount: 1 }
        if (sql.includes('tenant_ai_time_budget_settings')) return { rows: [{ settings: {
          schemaVersion: 1, revision: 1, status: 'active',
          organizationPeriod: { months: 1, anchorDate: '2026-10-01' },
          organizationPool: { tokens: 100_000, estimatedMinutes: 0 },
          groups: [{
            code: 'gptnursing', name: 'Nursing', tokenBudget: 100_000,
            estimatedMinuteBudget: 0, monthlyTokensPerUser: null,
            monthlyEstimatedMinutesPerUser: null
          }],
          departments: [{ code: 'obgyn', name: 'OBGYN', monthlyTokensPerUser: 10_000 }]
        } }], rowCount: 1 }
        if (sql.includes('tenant_member_ai_group_assignments')) return { rows: [{ group_code: 'gptnursing' }], rowCount: 1 }
        if (sql.includes('tenant_member_ai_department_assignments')) return { rows: [], rowCount: 0 }
        if (sql.includes('INSERT INTO app_sessions')) return {
          rows: [{ created_at: createdAt, updated_at: createdAt }], rowCount: 1
        }
        return { rows: [{ used: 1 }], rowCount: 1 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const store = createPostgresSessionStore(pool)

    await expect(store.createSession(principal, {
      promptVersion: 'patient-scenario-prompt-v13', modelVersion: 'gpt-6-luna',
      schemaVersion: 8, policyVersion: 'patient-scenario-policy-v3'
    })).resolves.toMatchObject({ status: 'initializing', aiBudgetGroupCode: 'gptnursing' })

    const tenantLockIndex = queries.findIndex((sql) => sql.includes('FROM tenants') && sql.includes('FOR SHARE'))
    const entitlementLockIndex = queries.findIndex((sql) => sql.includes('FROM tenant_entitlements') && sql.includes('FOR UPDATE'))
    const settingsLockIndex = queries.findIndex((sql) => sql.includes('tenant_ai_time_budget_settings') && sql.includes('FOR SHARE'))
    const groupReadIndex = queries.findIndex((sql) => sql.includes('tenant_member_ai_group_assignments'))
    const departmentReadIndex = queries.findIndex((sql) => sql.includes('tenant_member_ai_department_assignments'))
    expect(tenantLockIndex).toBeGreaterThan(queries.indexOf('BEGIN'))
    expect(tenantLockIndex).toBeLessThan(entitlementLockIndex)
    expect(tenantLockIndex).toBeLessThan(settingsLockIndex)
    expect(tenantLockIndex).toBeLessThan(groupReadIndex)
    expect(tenantLockIndex).toBeLessThan(departmentReadIndex)
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('rolls back before reading entitlements when the tenant snapshot lock finds no tenant', async () => {
    const queries: string[] = []
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql)
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
        if (sql.includes('FROM tenants')) return { rows: [], rowCount: 0 }
        return { rows: [], rowCount: 0 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const store = createPostgresSessionStore({
      connect: vi.fn().mockResolvedValue(client)
    } as unknown as Pool)

    await expect(store.createSession(principal, {
      promptVersion: 'patient-scenario-prompt-v13', modelVersion: 'gpt-6-luna',
      schemaVersion: 8, policyVersion: 'patient-scenario-policy-v3'
    })).resolves.toBe('membership_missing')

    expect(queries).toContain('ROLLBACK')
    expect(queries.some((sql) => sql.includes('FROM tenant_entitlements'))).toBe(false)
    expect(queries.some((sql) => sql.includes('INSERT INTO app_sessions'))).toBe(false)
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('persists one independent scenario variation seed when reserving a session', async () => {
    const insert: { sql: string; values: unknown[] | undefined }[] = []
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
        if (sql.includes('FROM tenant_entitlements')) return { rows: [{
          enabled: true, monthly_quota: null, monthly_user_quota: null, max_active_sessions: null
        }], rowCount: 1 }
        if (sql.includes('tenant_ai_time_budget_settings')) return { rows: [], rowCount: 0 }
        if (sql.includes('INSERT INTO app_sessions')) {
          insert.push({ sql, values })
          return { rows: [{ created_at: createdAt, updated_at: createdAt }], rowCount: 1 }
        }
        return { rows: [{ used: 1 }], rowCount: 1 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const store = createPostgresSessionStore(pool)

    await expect(store.createSession(principal, {
      promptVersion: 'patient-scenario-prompt-v13', modelVersion: 'gpt-6-luna',
      schemaVersion: 8, policyVersion: 'patient-scenario-policy-v3'
    })).resolves.toMatchObject({ status: 'initializing' })

    expect(insert).toHaveLength(1)
    expect(insert[0]?.sql).toContain('scenario_seed')
    expect(insert[0]?.values?.[2]).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('keeps saved draft AI budgets inert for session creation', async () => {
    const queries: string[] = []
    const insert: { sql: string; values: unknown[] | undefined }[] = []
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        queries.push(sql)
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
        if (sql.includes('FROM tenant_entitlements')) return { rows: [{
          enabled: true, monthly_quota: null, monthly_user_quota: null, max_active_sessions: null
        }], rowCount: 1 }
        if (sql.includes('tenant_ai_time_budget_settings')) return { rows: [{ settings: {
          schemaVersion: 1, revision: 1, status: 'draft',
          organizationPeriod: { months: 1, anchorDate: '2026-10-01' },
          organizationPool: { tokens: 100_000, estimatedMinutes: 0 },
          groups: [{
            code: 'gptnursing', name: 'Nursing', tokenBudget: 100_000, estimatedMinuteBudget: 0,
            monthlyTokensPerUser: null, monthlyEstimatedMinutesPerUser: null
          }],
          departments: [{ code: 'obgyn', name: 'OBGYN', monthlyTokensPerUser: 10_000 }]
        } }], rowCount: 1 }
        if (sql.includes('INSERT INTO app_sessions')) {
          insert.push({ sql, values })
          return { rows: [{ created_at: createdAt, updated_at: createdAt }], rowCount: 1 }
        }
        return { rows: [{ used: 1 }], rowCount: 1 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const store = createPostgresSessionStore({
      connect: vi.fn().mockResolvedValue(client)
    } as unknown as Pool)

    await expect(store.createSession(principal, {
      promptVersion: 'patient-scenario-prompt-v13', modelVersion: 'gpt-6-luna',
      schemaVersion: 8, policyVersion: 'patient-scenario-policy-v3'
    })).resolves.toMatchObject({ status: 'initializing', aiBudgetGroupCode: null })

    expect(queries.some((sql) => sql.includes('tenant_member_ai_group_assignments'))).toBe(false)
    expect(queries.some((sql) => sql.includes('tenant_member_ai_department_assignments'))).toBe(false)
    expect(insert[0]?.values?.slice(-3)).toEqual([null, null, null])
  })

  it('requires a group choice for multiple assignments and pins the selected group and department', async () => {
    const insert: { sql: string; values: unknown[] | undefined }[] = []
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
        if (sql.includes('FROM tenant_entitlements')) return { rows: [{
          enabled: true, monthly_quota: null, monthly_user_quota: null, max_active_sessions: null
        }], rowCount: 1 }
        if (sql.includes('tenant_ai_time_budget_settings')) return { rows: [{ settings: {
          schemaVersion: 1, revision: 1, status: 'active',
          organizationPeriod: { months: 1, anchorDate: '2026-10-01' },
          organizationPool: { tokens: 100_000, estimatedMinutes: 0 },
          groups: [
            { code: 'gptnursing', name: 'Nursing', tokenBudget: 50_000, estimatedMinuteBudget: 0, monthlyTokensPerUser: 10_000, monthlyEstimatedMinutesPerUser: null },
            { code: 'gptreception', name: 'Reception', tokenBudget: 50_000, estimatedMinuteBudget: 0, monthlyTokensPerUser: 10_000, monthlyEstimatedMinutesPerUser: null }
          ], departments: [{ code: 'obgyn', name: 'OBGYN' }]
        } }], rowCount: 1 }
        if (sql.includes('tenant_member_ai_group_assignments')) return { rows: [
          { group_code: 'gptnursing' }, { group_code: 'gptreception' }
        ], rowCount: 2 }
        if (sql.includes('tenant_member_ai_department_assignments')) return { rows: [{ department_code: 'obgyn', assigned_at: createdAt }], rowCount: 1 }
        if (sql.includes('INSERT INTO app_sessions')) {
          insert.push({ sql, values })
          return { rows: [{ created_at: createdAt, updated_at: createdAt }], rowCount: 1 }
        }
        return { rows: [{ used: 1 }], rowCount: 1 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const store = createPostgresSessionStore(pool)
    const versions = {
      promptVersion: 'patient-scenario-prompt-v13', modelVersion: 'gpt-6-luna',
      schemaVersion: 8 as const, policyVersion: 'patient-scenario-policy-v3'
    }

    await expect(store.createSession(principal, versions)).resolves.toEqual({
      status: 'group_selection_required',
      availableGroups: [
        { code: 'gptnursing', name: 'Nursing' },
        { code: 'gptreception', name: 'Reception' }
      ]
    })
    expect(insert).toHaveLength(0)

    const created = await store.createSession(principal, versions, 'gptreception')
    expect(created).toMatchObject({ status: 'initializing', aiBudgetGroupCode: 'gptreception' })
    expect(insert).toHaveLength(1)
    expect(insert[0]?.sql).toContain('ai_budget_group_code, ai_budget_department_code, ai_budget_department_assigned_at')
    expect(insert[0]?.values?.slice(-3)).toEqual(['gptreception', 'obgyn', createdAt])
  })
})

describe('strict patient scenario version', () => {
  it('rejects an initializing setup session pinned to an older schema without adapting it', async () => {
    const queries: string[] = []
    const client = {
      query: vi.fn(async (sql: string) => {
        queries.push(sql)
        if (sql.includes('FROM app_sessions')) return { rows: [{
          session_id: sessionId, patient_profile_id: null, scenario_seed: null,
          status: 'initializing', created_at: createdAt, setup_idempotency_key_hash: null,
          prompt_version: 'patient-scenario-prompt-v13', model_version: 'gpt-6-luna',
          schema_version: 3, policy_version: 'patient-scenario-policy-v3', sessions_enabled: true
        }], rowCount: 1 }
        return { rows: [], rowCount: 1 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const stateStore = { initialize: vi.fn() } as unknown as PatientStateStore
    const store = createPostgresSessionStore(pool, stateStore)
    const generate = vi.fn()

    await expect(store.setupScenario(principal, sessionId, 'setup-key', generate))
      .resolves.toBe('version_unavailable')
    expect(queries).toContain('ROLLBACK')
    expect(queries.some((sql) => sql.includes('UPDATE app_sessions'))).toBe(false)
    expect(queries.some((sql) => sql.includes('FROM patient_scenarios'))).toBe(false)
    expect(stateStore.initialize).not.toHaveBeenCalled()
    expect(generate).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalledOnce()
  })

  it.each([2, 3])('rejects unsupported stored version %s instead of rebuilding it into current Redis state', async (schemaVersion) => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{
        session_id: sessionId,
        patient_profile_id: patientProfileId,
        status: 'ready',
        created_at: createdAt,
        updated_at: createdAt,
        schema_version: schemaVersion,
        profile_digest: 'a'.repeat(64),
        profile_json: generated.profile,
        provider_conversation_id: generated.conversationId
      }], rowCount: 1 })
    } as unknown as Pool
    const stateStore = {
      read: vi.fn().mockResolvedValue(null),
      restore: vi.fn()
    } as unknown as PatientStateStore
    const store = createPostgresSessionStore(pool, stateStore)

    await expect(store.ensureLiveState?.(principal, sessionId))
      .rejects.toThrow(`Stored patient scenario schema version ${schemaVersion} is unsupported`)
    expect(stateStore.restore).not.toHaveBeenCalled()
    expect(pool.query).toHaveBeenCalledOnce()
  })
})

describe('scoped quota reservations', () => {
  it('rolls back tenant and user usage when a configured per-session response quota is exhausted', async () => {
    const statements: string[] = []
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql)
        if (sql.includes('FROM tenant_entitlements')) {
          return { rows: [{ enabled: true, monthly_quota: 10, monthly_user_quota: 5, session_quota: 1 }], rowCount: 1 }
        }
        if (sql.includes('app_session_usage')) return { rows: [], rowCount: 0 }
        return { rows: [{ used: 1 }], rowCount: 1 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const store = createPostgresSessionStore(pool)

    await expect(store.consumeQuota(principal, 'responses', sessionId)).resolves.toBe('quota_exceeded')

    expect(statements.some((sql) => sql.includes('tenant_monthly_usage'))).toBe(true)
    expect(statements.some((sql) => sql.includes('tenant_user_monthly_usage'))).toBe(true)
    expect(statements.some((sql) => sql.includes('app_session_usage'))).toBe(true)
    expect(statements).toContain('ROLLBACK')
    expect(statements).not.toContain('COMMIT')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('denies a new session when the configured user monthly session quota is exhausted', async () => {
    const statements: string[] = []
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql)
        if (sql.includes('FROM tenant_entitlements')) {
          return { rows: [{ enabled: true, monthly_quota: null, monthly_user_quota: 0, max_active_sessions: null }], rowCount: 1 }
        }
        if (sql.includes('tenant_ai_time_budget_settings')) return { rows: [], rowCount: 0 }
        if (sql.includes('tenant_user_monthly_usage')) return { rows: [], rowCount: 0 }
        return { rows: [{ used: 1 }], rowCount: 1 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const store = createPostgresSessionStore(pool)

    await expect(store.createSession(principal, {
      promptVersion: 'patient-scenario-prompt-v13', modelVersion: 'gpt-6-luna',
      schemaVersion: 8, policyVersion: 'patient-scenario-policy-v3'
    })).resolves.toBe('quota_exceeded')

    expect(statements).toContain('ROLLBACK')
    expect(statements.some((sql) => sql.includes('INSERT INTO app_sessions'))).toBe(false)
    expect(client.release).toHaveBeenCalledOnce()
  })
})

describe('audio transcription policy reservations', () => {
  it('requires both tenant audio entitlement and privacy approval before persisting consent', async () => {
    const statements: string[] = []
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql)
        if (sql.includes('FROM tenant_entitlements')) return { rows: [{
          sessions_enabled: true,
          audio_transcription_enabled: true,
          audio_transcription_privacy_approved: false,
          monthly_quota: 10,
          session_status: 'ready'
        }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const store = createPostgresSessionStore(pool)

    await expect(store.createAudioTranscriptionGrant(principal, sessionId, 'consent-v1'))
      .resolves.toBe('entitlement_denied')
    expect(statements).toContain('ROLLBACK')
    expect(statements).not.toContain('COMMIT')
    expect(statements.some((sql) => sql.includes('INSERT INTO app_audio_transcription_sessions'))).toBe(false)
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('records a consent grant with owner scope after locking a ready session', async () => {
    const statements: Array<{ sql: string; values?: unknown[] }> = []
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values })
        if (sql.includes('FROM tenant_entitlements')) return { rows: [{
          sessions_enabled: true,
          audio_transcription_enabled: true,
          audio_transcription_privacy_approved: true,
          monthly_quota: 10,
          session_status: 'ready'
        }], rowCount: 1 }
        if (sql.includes('INSERT INTO app_audio_transcription_sessions')) return { rows: [], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 1 })
    } as unknown as Pool
    const store = createPostgresSessionStore(pool)

    const result = await store.createAudioTranscriptionGrant(principal, sessionId, 'consent-v1')
    expect(result).toMatchObject({ grantId: expect.any(String) })
    const insert = statements.find(({ sql }) => sql.includes('INSERT INTO app_audio_transcription_sessions'))
    expect(insert?.values).toEqual([expect.any(String), sessionId, 'tenant-a', 'learner-a', 'consent-v1'])
    expect(statements.some(({ sql }) => sql === 'COMMIT')).toBe(true)
    await store.recordAudioProviderSession((result as { grantId: string }).grantId, 'sess_provider', 'call_provider')
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('provider_call_id = $3'), [
      (result as { grantId: string }).grantId, 'sess_provider', 'call_provider'
    ])
    expect(pool.query.mock.calls[0]?.[0]).toContain("disconnect_after = now() + interval '15 minutes'")
  })

  it('deduplicates provider audio duration events before adding them to the grant total', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 })
    const store = createPostgresSessionStore({ query } as unknown as Pool)

    await store.recordAudioTranscriptionUsage('rtc_provider_call', 'event_provider_1', 2.75)

    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(/ON CONFLICT \(provider_call_id, provider_event_id\) DO NOTHING[\s\S]*RETURNING grant_id, audio_seconds[\s\S]*provider_audio_seconds = audio\.provider_audio_seconds \+ inserted\.audio_seconds/),
      ['rtc_provider_call', 'event_provider_1', 2.75]
    )
    await expect(store.recordAudioTranscriptionUsage('rtc_provider_call', 'event_provider_2', Number.NaN))
      .rejects.toThrow('Invalid provider audio duration')
    await expect(store.recordAudioTranscriptionUsage('rtc_provider_call', 'event_provider_3', 901))
      .rejects.toThrow('Invalid provider audio duration')
    expect(query).toHaveBeenCalledOnce()
  })

  it('rejects a grant when the configured monthly per-user audio allowance is exhausted', async () => {
    const statements: string[] = []
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql)
        if (sql.includes('FROM tenant_entitlements')) return { rows: [{
          sessions_enabled: true,
          audio_transcription_enabled: true,
          audio_transcription_privacy_approved: true,
          monthly_quota: 0,
          session_status: 'active'
        }], rowCount: 1 }
        if (sql.includes('count(*)::text')) return { rows: [{ count: '0' }], rowCount: 1 }
        return { rows: [], rowCount: 0 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const store = createPostgresSessionStore(pool)

    await expect(store.createAudioTranscriptionGrant(principal, sessionId, 'consent-v1'))
      .resolves.toBe('quota_exceeded')
    expect(statements).toContain('ROLLBACK')
    expect(statements.some((sql) => sql.includes('INSERT INTO app_audio_transcription_sessions'))).toBe(false)
  })
})

describe('session entitlement authorization', () => {
  it('denies another tenant access to setup, turns, and audio transcription grants', async () => {
    const statements: Array<{ sql: string; values: unknown[] | undefined }> = []
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values })
        return { rows: [], rowCount: 0 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = {
      connect: vi.fn().mockResolvedValue(client),
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values })
        return { rows: [], rowCount: 0 }
      })
    } as unknown as Pool
    const store = createPostgresSessionStore(pool)
    const foreignPrincipal: AuthenticatedPrincipal = {
      subjectId: principal.subjectId, tenantId: 'tenant-b', role: 'learner'
    }
    const generate = vi.fn()

    await expect(store.setupScenario(foreignPrincipal, sessionId, 'setup-key', generate))
      .resolves.toBe('not_found')
    await expect(store.submitPatientTurn(foreignPrincipal, sessionId, 'turn-1', 'Question?', generate))
      .resolves.toBe('not_found')
    await expect(store.createAudioTranscriptionGrant(foreignPrincipal, sessionId, 'consent-v1'))
      .resolves.toBe('membership_missing')
    await expect(store.getOwnedSession(foreignPrincipal, sessionId)).resolves.toBeNull()

    expect(generate).not.toHaveBeenCalled()
    const ownershipQueries = statements.filter(({ sql }) =>
      sql.includes('FROM app_sessions') || sql.includes('JOIN app_sessions')
    )
    expect(ownershipQueries).toHaveLength(4)
    const audioQuery = ownershipQueries.find(({ sql }) => sql.includes('audio_transcription_enabled'))
    expect(audioQuery?.sql).toMatch(/s\.session_id = \$3[\s\S]*e\.tenant_id = \$1/)
    expect(audioQuery?.values).toEqual(['tenant-b', principal.subjectId, sessionId])
    for (const query of ownershipQueries.filter(({ sql }) => !sql.includes('audio_transcription_enabled'))) {
      expect(query.sql).toMatch(/session_id = \$1[\s\S]*tenant_id = \$2[\s\S]*subject_id = \$3/)
      expect(query.values).toEqual([sessionId, 'tenant-b', principal.subjectId])
    }
    expect(client.release).toHaveBeenCalledTimes(2)
  })

  it('does not start setup after the tenant session entitlement has been revoked', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
        if (sql.includes('FROM app_sessions')) return {
          rows: [{
            session_id: sessionId, patient_profile_id: patientProfileId, scenario_seed: 'r'.repeat(43), status: 'initializing',
            created_at: createdAt, setup_idempotency_key_hash: null, sessions_enabled: false,
            prompt_version: 'patient-scenario-prompt-v14', model_version: 'gpt-6-luna',
            schema_version: 8, policy_version: 'patient-scenario-policy-v3'
          }], rowCount: 1
        }
        return { rows: [], rowCount: 0 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const store = createPostgresSessionStore(pool)
    const generate = vi.fn()

    await expect(store.setupScenario(principal, sessionId, 'setup-key', generate))
      .resolves.toBe('entitlement_denied')

    expect(generate).not.toHaveBeenCalled()
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('hides owned sessions when the tenant session entitlement is disabled', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
    } as unknown as Pool
    const store = createPostgresSessionStore(pool)

    await expect(store.getOwnedSession(principal, sessionId)).resolves.toBeNull()
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('e.sessions_enabled = true'),
      [sessionId, principal.tenantId, principal.subjectId]
    )
  })
})

describe('patient setup persistence coordination', () => {
  it('initializes Redis before generation and binds the accepted profile and Conversation to both IDs', async () => {
    const order: string[] = []
    const savedState: ReadyPatientState[] = []
    const usageEvents: unknown[] = []
    const presentationSettings = {
      variantKey: '3039-average' as const,
      settingsRevision: 3,
      voiceProfileId: 'voice-3039-average',
      provider: 'browser-speech-synthesis' as const,
      voiceId: 'preferred-voice',
      locale: 'en-US',
      rate: 1.05,
      pitch: 0.95,
      volume: 0.8,
      fallbackVoiceId: 'fallback-voice'
    }
    const generatedWithPresentation = { ...generated, presentationSettings }
    const scenarioInserts: unknown[][] = []
    const patientStateStore: PatientStateStore = {
      rememberOwnedSession: vi.fn(async () => undefined),
      findOwnedSession: vi.fn(async () => null),
      initialize: vi.fn(async (sid, ppid) => {
        expect(sid).toBe(sessionId)
        expect(ppid).toBe(patientProfileId)
        order.push('redis-initialize')
      }),
      saveReady: vi.fn(async (state) => {
        savedState.push(state)
        order.push('redis-ready')
      }),
      read: vi.fn(async () => null),
      acquireTurnLock: vi.fn(async () => true),
      releaseTurnLock: vi.fn(async () => undefined),
      appendAuditEvent: vi.fn(async () => undefined),
      appendProviderUsage: vi.fn(async (event) => { usageEvents.push(event); order.push('usage-enqueued') }),
      acceptTurn: vi.fn(async () => ({ status: 'missing_state' as const })),
      recordTerminal: vi.fn(async () => 'missing_state' as const),
      restore: vi.fn(async () => 'restored' as const)
    }
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
        if (sql.includes('FROM app_sessions')) return {
          rows: [{
            session_id: sessionId, patient_profile_id: patientProfileId, scenario_seed: 'r'.repeat(43), status: 'initializing',
            created_at: createdAt, setup_idempotency_key_hash: null, sessions_enabled: true,
            prompt_version: 'patient-scenario-prompt-v14', model_version: 'gpt-6-luna',
            schema_version: 8, policy_version: 'patient-scenario-policy-v3'
          }], rowCount: 1
        }
        if (sql.includes('FROM patient_scenarios')) return { rows: [], rowCount: 0 }
        if (sql.includes('INSERT INTO patient_scenarios')) scenarioInserts.push(values ?? [])
        return { rows: [], rowCount: 1 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const store = createPostgresSessionStore(pool, patientStateStore)
    const rejectedAttemptUsage = {
      responseId: 'resp_rejected', model: 'gpt-6-luna', serviceTier: 'default',
      inputTokens: 80, cachedInputTokens: 0, cacheWriteTokens: 0,
      outputTokens: 8, totalTokens: 88, durationMs: 125,
      pricingVersion: 'openai-api-pricing-2026-10-06', estimatedCostUsd: '0.000012000000'
    }
    const generate = vi.fn(async (
      _versions: PatientScenarioVersionPins,
      _asOf: Date,
      _seed: string,
      recordProviderUsage: (usage: ProviderUsageSample) => Promise<void>
    ) => {
      order.push('generate')
      await recordProviderUsage(rejectedAttemptUsage)
      return generatedWithPresentation
    })

    const result = await store.setupScenario(principal, sessionId, 'setup-key', generate)

    expect(order).toEqual(['redis-initialize', 'generate', 'usage-enqueued', 'usage-enqueued', 'redis-ready'])
    expect(generate).toHaveBeenCalledOnce()
    expect(generate).toHaveBeenCalledWith(
      expect.anything(), expect.any(Date), 'r'.repeat(43), expect.any(Function)
    )
    expect(usageEvents).toEqual([
      expect.objectContaining({
        eventId: `usage_${createHash('sha256').update('openai\0resp_rejected').digest('hex')}`,
        sessionId, eventType: 'provider_usage', operation: 'scenario_generation',
        occurredAt: expect.any(String), usage: { ...rejectedAttemptUsage, provider: 'openai' }
      }),
      expect.objectContaining({
        eventId: `usage_${createHash('sha256').update('openai\0resp_private').digest('hex')}`,
        sessionId, eventType: 'provider_usage', operation: 'scenario_generation',
        occurredAt: expect.any(String),
        usage: {
          provider: 'openai',
          responseId: 'resp_private', model: 'gpt-6-luna', serviceTier: 'default',
          inputTokens: 100, cachedInputTokens: 12, cacheWriteTokens: 0,
          outputTokens: 50, totalTokens: 150, durationMs: 620,
          pricingVersion: 'openai-api-pricing-2026-10-06', estimatedCostUsd: '0.000034920000'
        }
      })
    ])
    expect(result).toMatchObject({
      sessionId, status: 'ready',
      patient: {
        fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01',
        bodyType: 'average', reasonForVisit: 'Pelvic pain'
      },
      readiness: { profile: true, redis: true, conversation: true }
    })
    expect(result).not.toHaveProperty('scenarioId')
    expect(result).toMatchObject({ patient: { presentationSettings } })
    expect(savedState).toHaveLength(1)
    expect(savedState[0]).toMatchObject({
      sessionId, patientProfileId, conversationId: 'conv_private',
      setupProjection: { diagnosis: 'Endometriosis', presentationSettings },
      profile: { diagnosis: 'Endometriosis' }, schemaVersion: 8
    })
    expect(scenarioInserts).toHaveLength(1)
    expect(scenarioInserts[0]?.[6]).toEqual(presentationSettings)
    expect(scenarioInserts[0]?.[7]).toBe(
      createHash('sha256').update(canonicalJsonStringify(presentationSettings)).digest('hex')
    )
    expect(scenarioInserts[0]?.[12]).toEqual(generated.sourceContext)
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('does not invoke profile generation when Redis state cannot be initialized', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
        if (sql.includes('FROM app_sessions')) return {
          rows: [{
            session_id: sessionId, patient_profile_id: patientProfileId, scenario_seed: 'r'.repeat(43), status: 'initializing',
            created_at: createdAt, setup_idempotency_key_hash: null, sessions_enabled: true,
            prompt_version: 'patient-scenario-prompt-v14', model_version: 'gpt-6-luna',
            schema_version: 8, policy_version: 'patient-scenario-policy-v3'
          }], rowCount: 1
        }
        if (sql.includes('FROM patient_scenarios')) return { rows: [], rowCount: 0 }
        return { rows: [], rowCount: 1 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const stateStore: PatientStateStore = {
      rememberOwnedSession: vi.fn(async () => undefined),
      findOwnedSession: vi.fn(async () => null),
      initialize: vi.fn().mockRejectedValue(new Error('Redis unavailable')),
      saveReady: vi.fn(),
      read: vi.fn(async () => null),
      acquireTurnLock: vi.fn(async () => true),
      releaseTurnLock: vi.fn(async () => undefined),
      appendAuditEvent: vi.fn(async () => undefined),
      appendProviderUsage: vi.fn(async () => undefined),
      acceptTurn: vi.fn(async () => ({ status: 'missing_state' as const })),
      recordTerminal: vi.fn(async () => 'missing_state' as const),
      restore: vi.fn(async () => 'restored' as const)
    }
    const generate = vi.fn().mockResolvedValue(generated)
    const store = createPostgresSessionStore(pool, stateStore)

    await expect(store.setupScenario(principal, sessionId, 'setup-key', generate)).rejects.toThrow('Redis unavailable')
    expect(generate).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('marks an owned setup session failed when generation fails before activation', async () => {
    const updates: Array<{ sql: string; values: unknown[] | undefined }> = []
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
        if (sql.includes('FROM app_sessions')) return {
          rows: [{
            session_id: sessionId, patient_profile_id: patientProfileId, scenario_seed: 'r'.repeat(43), status: 'initializing',
            created_at: createdAt, setup_idempotency_key_hash: null, sessions_enabled: true,
            prompt_version: 'patient-scenario-prompt-v14', model_version: 'gpt-6-luna',
            schema_version: 8, policy_version: 'patient-scenario-policy-v3'
          }], rowCount: 1
        }
        if (sql.includes('FROM patient_scenarios')) return { rows: [], rowCount: 0 }
        if (sql.includes("SET status = 'failed'")) updates.push({ sql, values })
        return { rows: [], rowCount: 1 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const stateStore = {
      rememberOwnedSession: vi.fn(async () => undefined),
      initialize: vi.fn(async () => undefined),
      saveReady: vi.fn(), read: vi.fn(), acquireTurnLock: vi.fn(), releaseTurnLock: vi.fn(),
      acceptTurn: vi.fn(), recordTerminal: vi.fn(), restore: vi.fn()
    } as unknown as PatientStateStore
    const store = createPostgresSessionStore(pool, stateStore)
    const setupError = new Error('scenario provider failed')

    await expect(store.setupScenario(
      principal, sessionId, 'setup-key', vi.fn().mockRejectedValue(setupError)
    )).rejects.toBe(setupError)

    expect(updates).toHaveLength(1)
    expect(updates[0]?.sql).toContain("status = 'failed'")
    expect(updates[0]?.sql).toContain("status = 'initializing'")
    expect(updates[0]?.values).toEqual([sessionId, principal.tenantId, principal.subjectId])
    expect(stateStore.saveReady).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('repairs Redis from the same saved scenario and Conversation on an idempotent retry', async () => {
    const profileDigest = createHash('sha256').update(canonicalJsonStringify(generated.profile)).digest('hex')
    const presentationSettings = {
      variantKey: '3039-average' as const,
      settingsRevision: 7,
      voiceProfileId: 'voice-3039-average',
      provider: 'browser-speech-synthesis' as const,
      voiceId: 'preferred-voice',
      locale: 'en-US',
      rate: 1.05,
      pitch: 0.95,
      volume: 0.8,
      fallbackVoiceId: 'fallback-voice'
    }
    const presentationSettingsDigest = createHash('sha256')
      .update(canonicalJsonStringify(presentationSettings)).digest('hex')
    const idempotencyHash = createHash('sha256').update('setup-key').digest('hex')
    const savedState: ReadyPatientState[] = []
    const stateStore: PatientStateStore = {
      rememberOwnedSession: vi.fn(async () => undefined),
      findOwnedSession: vi.fn(async () => null),
      initialize: vi.fn(),
      saveReady: vi.fn(async (state) => { savedState.push(state) }),
      read: vi.fn(async () => null),
      acquireTurnLock: vi.fn(async () => true),
      releaseTurnLock: vi.fn(async () => undefined),
      appendAuditEvent: vi.fn(async () => undefined),
      appendProviderUsage: vi.fn(async () => undefined),
      acceptTurn: vi.fn(async () => ({ status: 'missing_state' as const })),
      recordTerminal: vi.fn(async () => 'missing_state' as const),
      restore: vi.fn(async () => 'restored' as const)
    }
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
        if (sql.includes('FROM app_sessions')) return {
          rows: [{
            session_id: sessionId, patient_profile_id: patientProfileId, scenario_seed: 'r'.repeat(43), status: 'ready',
            created_at: createdAt, setup_idempotency_key_hash: idempotencyHash, sessions_enabled: true,
            prompt_version: 'patient-scenario-prompt-v13', model_version: 'gpt-6-luna',
            schema_version: 8, policy_version: 'patient-scenario-policy-v3'
          }], rowCount: 1
        }
        if (sql.includes('FROM patient_scenarios')) return {
          rows: [{
            scenario_id: patientProfileId, created_at: createdAt, profile_digest: profileDigest,
            profile_json: generated.profile, presentation_settings_json: presentationSettings,
            presentation_settings_digest: presentationSettingsDigest,
            provider_conversation_id: generated.conversationId
          }], rowCount: 1
        }
        return { rows: [], rowCount: 1 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const generate = vi.fn().mockResolvedValue(generated)
    const store = createPostgresSessionStore(pool, stateStore)

    const result = await store.setupScenario(principal, sessionId, 'setup-key', generate)

    expect(result).toMatchObject({ sessionId, status: 'ready' })
    expect(generate).not.toHaveBeenCalled()
    expect(stateStore.initialize).toHaveBeenCalledWith(sessionId, patientProfileId)
    expect(savedState[0]).toMatchObject({
      sessionId, patientProfileId, conversationId: 'conv_private', profileDigest,
      profile: { diagnosis: 'Endometriosis' },
      setupProjection: { presentationSettings }
    })
    expect(result).toMatchObject({ patient: { presentationSettings } })
    expect(result).not.toHaveProperty('scenarioId')
  })
})

describe('serialized patient turns', () => {
  it('does not read Redis or generate a response for another tenant session', async () => {
    const stateStore = {
      initialize: vi.fn(), saveReady: vi.fn(), read: vi.fn(), acquireTurnLock: vi.fn(),
      releaseTurnLock: vi.fn(), acceptTurn: vi.fn(), recordTerminal: vi.fn(), restore: vi.fn()
    } as unknown as PatientStateStore
    const pool = {
      query: vi.fn(async () => ({ rows: [], rowCount: 0 })),
      connect: vi.fn()
    } as unknown as Pool
    const store = createPostgresSessionStore(pool, stateStore)
    const generateTurn = vi.fn()

    expect(await store.submitPatientTurn(
      { subjectId: 'other-user', tenantId: 'other-tenant' }, sessionId,
      'turn-0001', 'Where does it hurt?', generateTurn
    )).toBe('not_found')
    expect(stateStore.read).not.toHaveBeenCalled()
    expect(stateStore.acquireTurnLock).not.toHaveBeenCalled()
    expect(generateTurn).not.toHaveBeenCalled()
  })

  it('rejects a history turn after the session leaves the history phase', async () => {
    const live: LivePatientState = {
      sessionId, patientProfileId, openedAt: createdAt.toISOString(),
      profile: generated.profile,
      setupProjection: {
        fullName: generated.profile.fullName, dateOfBirth: generated.profile.dateOfBirth,
        bodyType: generated.profile.bodyType, reasonForVisit: generated.profile.reasonForVisit,
        diagnosis: generated.profile.diagnosis
      },
      conversationId: generated.conversationId,
      profileDigest: scenarioFingerprint, schemaVersion: 8,
      state: {
        sessionId, scenarioId: patientProfileId, status: 'active', phase: 'assessment',
        interactionMode: 'transcript', openedAt: createdAt.toISOString(), updatedAt: createdAt.toISOString(),
        currentTurnSequence: 0, terminalEventId: null
      },
      acceptedTurns: [], terminalEvent: null
    }
    const stateStore = {
      initialize: vi.fn(), saveReady: vi.fn(), read: vi.fn(async () => live),
      acquireTurnLock: vi.fn(async () => true), releaseTurnLock: vi.fn(), acceptTurn: vi.fn(),
      recordTerminal: vi.fn(), restore: vi.fn()
    } as unknown as PatientStateStore
    const pool = {
      query: queryResultWithIdentity([{ status: 'active' }]),
      connect: vi.fn()
    } as unknown as Pool
    const store = createPostgresSessionStore(pool, stateStore)
    const generateTurn = vi.fn()

    expect(await store.submitPatientTurn(
      principal, sessionId, 'turn-0001', 'Where does it hurt?', generateTurn
    )).toBe('not_ready')
    expect(generateTurn).not.toHaveBeenCalled()
    expect(pool.connect).not.toHaveBeenCalled()
    expect(stateStore.releaseTurnLock).toHaveBeenCalledOnce()
  })

  it('serializes generation, commits once, and returns the saved reply on retry', async () => {
    let live: LivePatientState = {
      sessionId, patientProfileId, openedAt: createdAt.toISOString(),
      profile: generated.profile,
      setupProjection: {
        fullName: generated.profile.fullName, dateOfBirth: generated.profile.dateOfBirth,
        bodyType: generated.profile.bodyType, reasonForVisit: generated.profile.reasonForVisit,
        diagnosis: generated.profile.diagnosis
      },
      conversationId: generated.conversationId,
      profileDigest: scenarioFingerprint, schemaVersion: 8,
      state: {
        sessionId, scenarioId: patientProfileId, status: 'ready', phase: 'history',
        interactionMode: 'transcript',
        openedAt: createdAt.toISOString(), updatedAt: createdAt.toISOString(),
        currentTurnSequence: 0, terminalEventId: null
      },
      acceptedTurns: [], terminalEvent: null
    }
    let locked = false
    const stateStore: PatientStateStore = {
      rememberOwnedSession: vi.fn(async () => undefined),
      findOwnedSession: vi.fn(async () => null),
      initialize: vi.fn(), saveReady: vi.fn(),
      read: vi.fn(async () => live),
      acquireTurnLock: vi.fn(async () => {
        if (locked) return false
        locked = true
        return true
      }),
      releaseTurnLock: vi.fn(async () => { locked = false }),
      appendAuditEvent: vi.fn(async () => undefined),
      appendProviderUsage: vi.fn(async () => undefined),
      acceptTurn: vi.fn(async (turn, _providerUsage, phase = 'history') => {
        live = {
          ...live,
          state: { ...live.state, status: 'active', phase, updatedAt: turn.acceptedAt, currentTurnSequence: turn.sequence },
          acceptedTurns: [...live.acceptedTurns, turn]
        }
        return { status: 'accepted' as const, turnId: turn.turnId, sequence: turn.sequence, patientResponse: turn.patientResponse }
      }),
      recordTerminal: vi.fn(async () => 'missing_state' as const),
      restore: vi.fn(async () => 'restored' as const)
    }
    const quotaClient = {
      query: vi.fn(async (sql: string) => sql.includes('responses_enabled')
        ? { rows: [{ enabled: true, monthly_quota: null }], rowCount: 1 }
        : { rows: [{ used: 1 }], rowCount: 1 }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = {
      query: vi.fn(async (sql: string) => sql.includes('FROM session_identity_binding')
        ? { rows: [identityBindingRow], rowCount: 1 }
        : { rows: [{
        status: 'ready', prompt_version: 'patient-scenario-prompt-v13', model_version: 'gpt-6-luna',
        schema_version: 8, policy_version: 'patient-scenario-policy-v3'
        }], rowCount: 1 }),
      connect: vi.fn().mockResolvedValue(quotaClient)
    } as unknown as Pool
    const store = createPostgresSessionStore(pool, stateStore)
    let finishGeneration!: (value: {
      responseId: string
      output: unknown
      provider?: 'openai' | 'anthropic'
      providerUsage: { responseId: string; inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number; durationMs: number } | null
    }) => void
    const generationWait = new Promise<{
      responseId: string
      output: unknown
      provider?: 'openai' | 'anthropic'
      providerUsage: { responseId: string; inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number; durationMs: number } | null
    }>((resolve) => {
      finishGeneration = resolve
    })
    const generateTurn = vi.fn()
      .mockImplementationOnce(() => generationWait)
      .mockResolvedValueOnce({
        responseId: 'msg-second', provider: 'anthropic', providerUsage: null,
        output: {
          patientResponse: 'Yes, I have pelvic pain.', proposedFacts: [], proposedPainFacts: [],
          historyCoverage: [], disclosedHistoryFields: [],
          painHistoryCoverage: [{ painEpisodeId: 'pain-1', field: 'anyPain' }],
          painDisclosures: [{ painEpisodeId: 'pain-1', field: 'anyPain' }]
        }
      })
    const submitting = store.submitPatientTurn(
      principal, sessionId, 'turn-0001', 'Do you have pain?', generateTurn, 'realtime_transcription'
    )
    await vi.waitFor(() => expect(generateTurn).toHaveBeenCalledOnce())

    const contendedLockAttempt = vi.fn()
    expect(await store.submitPatientTurn(
      principal, sessionId, 'turn-0002', 'Any other symptoms?', generateTurn, 'typed', contendedLockAttempt
    )).toBe('turn_in_progress')
    expect(contendedLockAttempt).toHaveBeenCalledOnce()
    expect(Number.isFinite(contendedLockAttempt.mock.calls[0]?.[0])).toBe(true)
    expect(contendedLockAttempt.mock.calls[0]?.[0]).toBeGreaterThanOrEqual(0)
    finishGeneration({
      responseId: 'resp-private',
      provider: 'anthropic',
      providerUsage: {
        responseId: 'resp-private', inputTokens: 10, cachedInputTokens: 0,
        outputTokens: 8, totalTokens: 18, durationMs: 450
      },
      output: {
        patientResponse: 'Yes, I have pelvic pain.', proposedFacts: [], proposedPainFacts: [],
        historyCoverage: [], disclosedHistoryFields: [],
        painHistoryCoverage: [{ painEpisodeId: 'pain-1', field: 'anyPain' }],
        painDisclosures: [{ painEpisodeId: 'pain-1', field: 'anyPain' }]
      }
    })
    expect(await submitting).toMatchObject({
      status: 'accepted', turnId: 'turn-0001', sequence: 1, patientResponse: 'Yes, I have pelvic pain.'
    })
    expect(stateStore.acceptTurn).toHaveBeenCalledWith(expect.any(Object), [{
      responseId: 'resp-private', inputTokens: 10, cachedInputTokens: 0,
      outputTokens: 8, totalTokens: 18, durationMs: 450
    }], undefined)
    expect(stateStore.acceptTurn.mock.calls[0]?.[0]).toMatchObject({ provider: 'anthropic' })
    expect(await store.submitPatientTurn(
      principal, sessionId, 'turn-0003', 'Do you have pain?', generateTurn
    )).toMatchObject({ status: 'accepted', sequence: 2 })
    expect(generateTurn.mock.calls[1]?.[0]).toMatchObject({ provider: 'anthropic' })

    expect(await store.submitPatientTurn(
      principal, sessionId, 'turn-0001', 'Do you have pain?', generateTurn, 'realtime_transcription'
    )).toMatchObject({
      status: 'duplicate', turnId: 'turn-0001', sequence: 1, patientResponse: 'Yes, I have pelvic pain.'
    })
    expect(await store.submitPatientTurn(
      principal, sessionId, 'turn-0001', 'A different message', generateTurn
    )).toBe('conflict')
    expect(await store.submitPatientTurn(
      principal, sessionId, 'turn-0001', 'Do you have pain?', generateTurn, 'typed'
    )).toBe('conflict')
    expect(generateTurn).toHaveBeenCalledTimes(2)
    expect(pool.connect).toHaveBeenCalledTimes(2)
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('e.sessions_enabled = true'),
      [sessionId, principal.tenantId, principal.subjectId]
    )
    expect(stateStore.acceptTurn).toHaveBeenCalledTimes(2)
    expect(stateStore.acceptTurn).toHaveBeenCalledWith(expect.objectContaining({
      learnerModality: 'realtime_transcription'
    }), [{
      responseId: 'resp-private', inputTokens: 10, cachedInputTokens: 0,
      outputTokens: 8, totalTokens: 18, durationMs: 450
    }], undefined)
    expect(stateStore.releaseTurnLock).toHaveBeenCalledTimes(5)
  })

  it('retries invalid model facts and commits only a safe clarification after bounded failure', async () => {
    let failAuditWrite!: (error: Error) => void
    const auditWritePending = new Promise<void>((_resolve, reject) => { failAuditWrite = reject })
    const appendAuditEvent = vi.fn(() => auditWritePending)
    const stateStore = {
      initialize: vi.fn(), saveReady: vi.fn(),
      read: vi.fn(async () => ({
        sessionId, patientProfileId, openedAt: createdAt.toISOString(),
        profile: generated.profile,
        setupProjection: { ...generated.profile },
        conversationId: generated.conversationId, profileDigest: scenarioFingerprint, schemaVersion: 8,
        state: {
          sessionId, scenarioId: patientProfileId, status: 'ready', phase: 'history',
          interactionMode: 'transcript',
          openedAt: createdAt.toISOString(), updatedAt: createdAt.toISOString(),
          currentTurnSequence: 0, terminalEventId: null
        }, acceptedTurns: [], terminalEvent: null
      })),
      acquireTurnLock: vi.fn(async () => true), releaseTurnLock: vi.fn(), appendAuditEvent,
      acceptTurn: vi.fn(async (turn) => ({
        status: 'accepted' as const, turnId: turn.turnId, sequence: turn.sequence,
        patientResponse: turn.patientResponse
      })),
      recordTerminal: vi.fn(), restore: vi.fn()
    } as unknown as PatientStateStore
    const quotaClient = {
      query: vi.fn(async (sql: string) => sql.includes('responses_enabled')
        ? { rows: [{ enabled: true, monthly_quota: null }], rowCount: 1 }
        : { rows: [{ used: 1 }], rowCount: 1 }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = {
      query: vi.fn(async (sql: string) => sql.includes('FROM session_identity_binding')
        ? { rows: [identityBindingRow], rowCount: 1 }
        : { rows: [{
        status: 'ready', prompt_version: 'patient-scenario-prompt-v13', model_version: 'gpt-6-luna',
        schema_version: 8, policy_version: 'patient-scenario-policy-v3'
        }], rowCount: 1 }),
      connect: vi.fn().mockResolvedValue(quotaClient)
    } as unknown as Pool
    const recordHandoffTiming = vi.fn()
    const store = createPostgresSessionStore(pool, stateStore, { recordHandoffTiming })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const generateTurn = vi.fn().mockResolvedValue({
      responseId: 'resp-private',
      providerUsage: null,
      output: {
        patientResponse: 'I have a fever.', proposedFacts: [{ field: 'anyPain', value: 'No pain' }],
        historyCoverage: ['anyPain'], disclosedHistoryFields: ['anyPain']
      }
    })

    expect(await store.submitPatientTurn(principal, sessionId, 'turn-0001', 'Do you have a fever?', generateTurn))
      .toMatchObject({
        status: 'accepted', patientResponse: 'Sorry, could you please repeat or clarify that?'
      })
    expect(generateTurn).toHaveBeenCalledTimes(2)
    expect(stateStore.acceptTurn).toHaveBeenCalledWith(expect.objectContaining({
      patientResponse: 'Sorry, could you please repeat or clarify that?', patientReportedFacts: [],
      patientReportedPainFacts: [],
      painHistoryCoverage: [],
      painDisclosures: [],
      historyCoverage: [], disclosedHistoryFields: [], disclosedFactIds: []
    }), [], undefined)
    expect(stateStore.releaseTurnLock).toHaveBeenCalledOnce()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(appendAuditEvent).toHaveBeenCalledOnce()
    expect(appendAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      eventType: 'patient_turn_validation_failure',
      payload: { turnIdHash: createHash('sha256').update('turn-0001').digest('hex'), attemptCount: 2 }
    }))
    expect(JSON.stringify(appendAuditEvent.mock.calls[0]?.[0])).not.toContain('Do you have a fever?')
    failAuditWrite(new Error('Do you have a fever? sk-test-cookie-audio-sentinel'))
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(recordHandoffTiming).toHaveBeenCalledWith('audit_event_enqueue', expect.any(Number))
    expect(warn).toHaveBeenCalledOnce()
    const warning = String(warn.mock.calls[0]?.[0])
    expect(warning).toContain('session_turn_audit_enqueue_failed')
    expect(warning).toContain(createHash('sha256').update(sessionId).digest('hex').slice(0, 16))
    for (const privateValue of [sessionId, 'turn-0001', 'Do you have a fever?', 'sk-test-cookie-audio-sentinel']) {
      expect(warning).not.toContain(privateValue)
    }
    warn.mockRestore()
  })
})

describe('serialized assessment mutations', () => {
  it('does not change phase while another patient turn owns the session lock', async () => {
    const current = {
      sessionId, patientProfileId, openedAt: createdAt.toISOString(),
      profile: generated.profile, setupProjection: { ...generated.profile },
      conversationId: generated.conversationId, profileDigest: scenarioFingerprint, schemaVersion: 8,
      state: {
        sessionId, scenarioId: patientProfileId, status: 'active', phase: 'history',
        interactionMode: 'transcript', openedAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(), currentTurnSequence: 1, terminalEventId: null
      },
      acceptedTurns: [{ disclosedHistoryFields: [] }], assessment: null, terminalEvent: null
    } as unknown as LivePatientState
    const stateStore = {
      read: vi.fn(async () => current),
      acquireTurnLock: vi.fn(async () => false),
      releaseTurnLock: vi.fn(),
      changePhase: vi.fn(async () => 'accepted' as const)
    } as unknown as PatientStateStore
    const pool = {
      query: queryResultWithIdentity([{ status: 'active' }])
    } as unknown as Pool
    const store = createPostgresSessionStore(pool, stateStore)

    await expect(store.beginAssessment(principal, sessionId)).resolves.toBe('turn_in_progress')
    expect(stateStore.acquireTurnLock).toHaveBeenCalledOnce()
    expect(stateStore.read).toHaveBeenCalledOnce()
    expect(stateStore.changePhase).not.toHaveBeenCalled()
    expect(stateStore.releaseTurnLock).not.toHaveBeenCalled()
  })

  it('does not submit or complete assessment while another session mutation owns the lock', async () => {
    const current = {
      sessionId, patientProfileId, openedAt: createdAt.toISOString(),
      profile: generated.profile, setupProjection: { ...generated.profile },
      conversationId: generated.conversationId, profileDigest: scenarioFingerprint, schemaVersion: 8,
      state: {
        sessionId, scenarioId: patientProfileId, status: 'active', phase: 'assessment',
        interactionMode: 'transcript', openedAt: createdAt.toISOString(),
        updatedAt: createdAt.toISOString(), currentTurnSequence: 1, terminalEventId: null
      },
      acceptedTurns: [{ disclosedHistoryFields: [] }], assessment: null, terminalEvent: null
    } as unknown as LivePatientState
    const stateStore = {
      read: vi.fn(async () => current),
      acquireTurnLock: vi.fn(async () => false),
      releaseTurnLock: vi.fn(),
      acceptAssessment: vi.fn(),
      recordTerminal: vi.fn()
    } as unknown as PatientStateStore
    const pool = {
      query: queryResultWithIdentity([{ status: 'active' }])
    } as unknown as Pool
    const store = createPostgresSessionStore(pool, stateStore)

    await expect(store.submitAssessment(principal, sessionId, 'assessment-1', {
      summary: 'Pelvic pain', differential: 'Possible cyst', rationale: 'Acute onset', plan: 'Evaluate further'
    })).resolves.toBe('turn_in_progress')
    expect(stateStore.acquireTurnLock).toHaveBeenCalledOnce()
    expect(stateStore.read).toHaveBeenCalledOnce()
    expect(stateStore.acceptAssessment).not.toHaveBeenCalled()
    expect(stateStore.recordTerminal).not.toHaveBeenCalled()
    expect(stateStore.releaseTurnLock).not.toHaveBeenCalled()
  })
})

describe('serialized session cancellation', () => {
  const current = {
    sessionId, patientProfileId, openedAt: createdAt.toISOString(),
    profile: generated.profile,
    setupProjection: derivePatientSetup(generated.profile),
    conversationId: generated.conversationId, profileDigest: scenarioFingerprint, schemaVersion: 8,
    state: {
      sessionId, scenarioId: patientProfileId, status: 'active', phase: 'assessment',
      interactionMode: 'transcript', openedAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(), currentTurnSequence: 2, terminalEventId: null
    },
    acceptedTurns: [], assessment: null, terminalEvent: null
  } as unknown as LivePatientState

  it('commits one owner-scoped cancellation under the session lock and removes its draft', async () => {
    const stateStore = {
      read: vi.fn(async () => current),
      acquireTurnLock: vi.fn(async () => true),
      releaseTurnLock: vi.fn(),
      recordTerminal: vi.fn(async () => 'accepted' as const)
    } as unknown as PatientStateStore
    const pool = { query: queryResultWithIdentity([{ status: 'active' }]) } as unknown as Pool
    const store = createPostgresSessionStore(pool, stateStore)

    await expect(store.cancelSession(principal, sessionId)).resolves.toEqual({ sessionId, status: 'cancelled' })
    const terminal = (stateStore.recordTerminal as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(terminal).toMatchObject({
      sessionId, outcome: 'cancelled', reason: null, finalTurnSequence: 2
    })
    expect(terminal.occurredAt).toMatch(/^\d{4}-\d\d-\d\dT/)
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringMatching(/DELETE FROM app_assessment_drafts/),
      [sessionId, principal.tenantId, principal.subjectId]
    )
    expect(stateStore.releaseTurnLock).toHaveBeenCalledOnce()
  })

  it('does not cancel while another session mutation holds the lock', async () => {
    const stateStore = {
      read: vi.fn(async () => current),
      acquireTurnLock: vi.fn(async () => false),
      releaseTurnLock: vi.fn(),
      recordTerminal: vi.fn()
    } as unknown as PatientStateStore
    const pool = { query: queryResultWithIdentity([{ status: 'active' }]) } as unknown as Pool
    const store = createPostgresSessionStore(pool, stateStore)

    await expect(store.cancelSession(principal, sessionId)).resolves.toBe('turn_in_progress')
    expect(stateStore.recordTerminal).not.toHaveBeenCalled()
    expect(stateStore.releaseTurnLock).not.toHaveBeenCalled()
  })

  it('returns the already-cancelled outcome idempotently without requiring Redis', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ status: 'cancelled' }], rowCount: 1 }) } as unknown as Pool
    const store = createPostgresSessionStore(pool)

    await expect(store.cancelSession(principal, sessionId)).resolves.toEqual({ sessionId, status: 'cancelled' })
    expect(pool.query).toHaveBeenCalledOnce()
  })
})

describe('current owned encounter recovery', () => {
  it('restores the immutable presentation snapshot from PostgreSQL after Redis loss', async () => {
    const presentationSettings = {
      variantKey: '3039-average' as const,
      settingsRevision: 5,
      voiceProfileId: 'voice-3039-average',
      provider: 'browser-speech-synthesis' as const,
      voiceId: 'preferred-voice',
      locale: 'en-US',
      rate: 0.9,
      pitch: 1.1,
      volume: 0.7,
      fallbackVoiceId: 'fallback-voice'
    }
    const presentationSettingsDigest = createHash('sha256')
      .update(canonicalJsonStringify(presentationSettings)).digest('hex')
    let restored: LivePatientState | null = null
    const stateStore = {
      read: vi.fn(async () => restored),
      restore: vi.fn(async (state: LivePatientState) => {
        restored = state
        return 'restored' as const
      })
    } as unknown as PatientStateStore
    const sessionRow = {
      session_id: sessionId,
      patient_profile_id: patientProfileId,
      status: 'ready',
      created_at: createdAt,
      updated_at: createdAt,
      schema_version: 8,
      profile_digest: scenarioFingerprint,
      profile_json: generated.profile,
      presentation_settings_json: presentationSettings,
      presentation_settings_digest: presentationSettingsDigest,
      provider_conversation_id: generated.conversationId
    }
    const pool = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM app_sessions s') && sql.includes('presentation_settings_json')) {
          return { rows: [sessionRow], rowCount: 1 }
        }
        if (sql.includes('FROM session_events')) return { rows: [], rowCount: 0 }
        if (sql.includes('FROM session_identity_binding')) return { rows: [identityBindingRow], rowCount: 1 }
        return { rows: [], rowCount: 1 }
      })
    } as unknown as Pool
    const store = createPostgresSessionStore(pool, stateStore)

    await store.ensureLiveState?.(principal, sessionId)

    expect(stateStore.restore).toHaveBeenCalledOnce()
    expect(restored).toMatchObject({
      sessionId,
      setupProjection: { presentationSettings },
      profile: { diagnosis: 'Endometriosis' }
    })
    expect(stateStore.read).toHaveBeenCalledTimes(2)
  })

  it('returns Redis live status and transcript ahead of the PostgreSQL event worker', async () => {
    const acceptedAt = new Date('2026-10-01T00:05:00.000Z').toISOString()
    const live = {
      sessionId,
      patientProfileId,
      openedAt: createdAt.toISOString(),
      profile: generated.profile,
      setupProjection: derivePatientSetup(generated.profile),
      conversationId: generated.conversationId,
      profileDigest: scenarioFingerprint,
      schemaVersion: 8,
      state: {
        sessionId,
        scenarioId: patientProfileId,
        status: 'active',
        phase: 'history',
        interactionMode: 'transcript',
        openedAt: createdAt.toISOString(),
        updatedAt: acceptedAt,
        currentTurnSequence: 1,
        terminalEventId: null
      },
      acceptedTurns: [{
        turnId: 'turn-live-0001', sequence: 1, acceptedAt, phase: 'history',
        learnerModality: 'typed', learnerMessage: 'When did this start?',
        patientResponse: 'It started yesterday.', disclosedHistoryFields: []
      }],
      assessment: null,
      terminalEvent: null
    }
    const stateStore = {
      findOwnedSession: vi.fn(async () => sessionId),
      rememberOwnedSession: vi.fn(async () => undefined),
      read: vi.fn(async () => live)
    } as unknown as PatientStateStore
    const readyRow = {
      session_id: sessionId,
      status: 'ready',
      created_at: createdAt,
      updated_at: createdAt,
      prompt_version: 'patient-scenario-prompt-v13',
      model_version: 'gpt-6-luna',
      schema_version: 8,
      policy_version: 'patient-scenario-policy-v3'
    }
    const pool = {
      query: vi.fn(async (sql: string) => sql.includes('FROM session_identity_binding')
          ? { rows: [identityBindingRow], rowCount: 1 }
        : sql.includes('UPDATE session_identity_binding')
          ? { rows: [], rowCount: 1 }
        : sql.includes('FROM session_local_utterances')
          ? { rows: [], rowCount: 0 }
        : sql.includes('FROM app_assessment_drafts')
            ? { rows: [], rowCount: 0 }
          : { rows: [readyRow], rowCount: 1 })
    } as unknown as Pool
    const store = createPostgresSessionStore(pool, stateStore)

    await expect(store.getCurrentOwnedEncounter(principal)).resolves.toMatchObject({
      sessionId,
      status: 'active',
      updatedAt: acceptedAt,
      currentTurnSequence: 1,
      assessmentDraft: null,
      transcript: [{ learnerMessage: 'When did this start?', patientResponse: 'It started yesterday.' }]
    })
  })

  it('selects the newest eligible session when Redis points to an older open session', async () => {
    const olderSessionId = 'o'.repeat(43)
    const newest = {
      session_id: sessionId,
      status: 'initializing',
      created_at: new Date('2026-10-02T00:00:00.000Z'),
      updated_at: new Date('2026-10-02T00:00:00.000Z'),
      prompt_version: 'patient-scenario-prompt-v13',
      model_version: 'gpt-6-luna',
      schema_version: 8,
      policy_version: 'patient-scenario-policy-v3'
    }
    const stateStore = {
      findOwnedSession: vi.fn(async () => olderSessionId),
      rememberOwnedSession: vi.fn(async () => undefined),
      read: vi.fn()
    } as unknown as PatientStateStore
    const pool = {
      query: vi.fn(async (_sql: string, values?: unknown[]) => values?.[2] === olderSessionId
        ? { rows: [], rowCount: 0 }
        : { rows: [newest], rowCount: 1 })
    } as unknown as Pool
    const store = createPostgresSessionStore(pool, stateStore)

    await expect(store.getCurrentOwnedEncounter(principal)).resolves.toMatchObject({
      sessionId, status: 'initializing', patient: null
    })
    expect(stateStore.rememberOwnedSession).toHaveBeenCalledWith(principal.tenantId, principal.subjectId, sessionId)
    expect(stateStore.read).not.toHaveBeenCalled()
  })
})

describe('assessment submission retries', () => {
  it('retries terminal completion from an already saved assessment after the session is completed', async () => {
    const submission = {
      assessmentId: 'assessment-1', sessionId, turnSequence: 1,
      submittedAt: '2026-10-01T00:02:00.000Z', summary: 'Pelvic pain since yesterday.',
      differential: 'Ovarian cyst.', rationale: 'Acute onset.', plan: 'Evaluate further.'
    }
    const live = {
      sessionId, patientProfileId, openedAt: createdAt.toISOString(),
      profile: generated.profile,
      setupProjection: {
        fullName: generated.profile.fullName, dateOfBirth: generated.profile.dateOfBirth,
        bodyType: generated.profile.bodyType, reasonForVisit: generated.profile.reasonForVisit,
        diagnosis: generated.profile.diagnosis
      },
      conversationId: generated.conversationId, profileDigest: scenarioFingerprint, schemaVersion: 8,
      state: {
        sessionId, scenarioId: patientProfileId, status: 'completed', phase: 'debrief',
        interactionMode: 'transcript', openedAt: createdAt.toISOString(),
        updatedAt: submission.submittedAt, currentTurnSequence: 1, terminalEventId: null
      },
      acceptedTurns: [], assessment: submission, terminalEvent: null
    } as unknown as LivePatientState
    const stateStore = {
      initialize: vi.fn(), saveReady: vi.fn(), read: vi.fn(async () => live),
      acquireTurnLock: vi.fn(async () => true), releaseTurnLock: vi.fn(),
      acceptAssessment: vi.fn(), recordTerminal: vi.fn(async () => 'accepted' as const), restore: vi.fn()
    } as unknown as PatientStateStore
    const pool = {
      query: queryResultWithIdentity([{ status: 'completed' }]),
      connect: vi.fn()
    } as unknown as Pool
    const store = createPostgresSessionStore(pool, stateStore)

    await expect(store.submitAssessment(principal, sessionId, submission.assessmentId, {
      summary: submission.summary, differential: submission.differential,
      rationale: submission.rationale, plan: submission.plan
    })).resolves.toEqual({
      assessmentId: submission.assessmentId, status: 'unscored', submittedAt: submission.submittedAt
    })
    expect(stateStore.acceptAssessment).not.toHaveBeenCalled()
    expect(stateStore.recordTerminal).toHaveBeenCalledOnce()
  })
})

describe('session engagement pulses', () => {
  it('serializes pulses on the owned active session and accepts only the first recent pulse', async () => {
    const statements: string[] = []
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql)
        if (sql.includes('FROM app_sessions')) return { rows: [{ session_id: sessionId }], rowCount: 1 }
        if (sql.includes('INSERT INTO session_engagement_pulses')) return { rows: [{ pulse_id: 'pulse' }], rowCount: 1 }
        return { rows: [], rowCount: null }
      }),
      release: vi.fn()
    }
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const store = createPostgresSessionStore(pool)

    await expect(store.recordEngagementPulse(principal, sessionId, '123e4567-e89b-42d3-a456-426614174000'))
      .resolves.toBe('recorded')
    expect(statements[0]).toBe('BEGIN')
    expect(statements.find((sql) => sql.includes('FROM app_sessions'))).toContain("s.status = 'active'")
    expect(statements.find((sql) => sql.includes('FROM app_sessions'))).toContain("m.status = 'active'")
    expect(statements.find((sql) => sql.includes('INSERT INTO session_engagement_pulses'))).toContain("interval '25 seconds'")
    expect(statements).toContain('COMMIT')
    expect(client.release).toHaveBeenCalledOnce()
  })
})
