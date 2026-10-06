import type { Pool, PoolClient } from 'pg'
import { createHash } from 'node:crypto'
import { canonicalJsonStringify } from '../../services/api/src/canonical-json.ts'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedPrincipal } from '../../services/api/src/auth.ts'
import type { LivePatientState, PatientStateStore, ReadyPatientState } from '../../services/api/src/patient-state-store.ts'
import { createPostgresSessionStore } from '../../services/api/src/session-store.ts'
import type { GeneratedPatientScenario, PatientScenarioVersionPins } from '../../services/api/src/patient-profile.ts'
import type { ProviderUsageSample } from '../../services/api/src/session-contracts.ts'

const principal: AuthenticatedPrincipal = { subjectId: 'learner-a', tenantId: 'tenant-a', role: 'learner' }
const sessionId = 's'.repeat(43)
const patientProfileId = 'p'.repeat(43)
const createdAt = new Date('2026-10-01T00:00:00.000Z')
const generated: GeneratedPatientScenario = {
  conversationId: 'conv_private',
  responseId: 'resp_private',
  profile: {
    fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average',
    reasonForVisit: 'Pelvic pain', diagnosis: 'Endometriosis', history: [],
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
  abandonedConversationIds: []
}

describe('tenant membership roles', () => {
  it('returns a role only for the active user and tenant membership', async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ role: 'instructor' }], rowCount: 1 })
    } as unknown as Pool
    const store = createPostgresSessionStore(pool)

    await expect(store.getActiveMembershipRole('learner-a', 'tenant-a')).resolves.toBe('instructor')
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("status = 'active'"),
      ['tenant-a', 'learner-a']
    )
  })

  it('persists one independent scenario variation seed when reserving a session', async () => {
    const insert: { sql: string; values: unknown[] | undefined }[] = []
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
        if (sql.includes('FROM tenant_entitlements')) return { rows: [{
          enabled: true, monthly_quota: null, monthly_user_quota: null, max_active_sessions: null
        }], rowCount: 1 }
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
      promptVersion: 'patient-scenario-prompt-v6', modelVersion: 'gpt-6-luna',
      schemaVersion: 5, policyVersion: 'patient-scenario-policy-v3'
    })).resolves.toMatchObject({ status: 'initializing' })

    expect(insert).toHaveLength(1)
    expect(insert[0]?.sql).toContain('scenario_seed')
    expect(insert[0]?.values?.[2]).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(client.release).toHaveBeenCalledOnce()
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
          prompt_version: 'patient-scenario-prompt-v6', model_version: 'gpt-6-luna',
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
        if (sql.includes('tenant_user_monthly_usage')) return { rows: [], rowCount: 0 }
        return { rows: [{ used: 1 }], rowCount: 1 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const store = createPostgresSessionStore(pool)

    await expect(store.createSession(principal, {
      promptVersion: 'patient-scenario-prompt-v6', modelVersion: 'gpt-6-luna',
      schemaVersion: 5, policyVersion: 'patient-scenario-policy-v3'
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
            prompt_version: 'patient-scenario-prompt-v6', model_version: 'gpt-6-luna',
            schema_version: 5, policy_version: 'patient-scenario-policy-v3'
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
    const patientStateStore: PatientStateStore = {
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
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
        if (sql.includes('FROM app_sessions')) return {
          rows: [{
            session_id: sessionId, patient_profile_id: patientProfileId, scenario_seed: 'r'.repeat(43), status: 'initializing',
            created_at: createdAt, setup_idempotency_key_hash: null, sessions_enabled: true,
            prompt_version: 'patient-scenario-prompt-v6', model_version: 'gpt-6-luna',
            schema_version: 5, policy_version: 'patient-scenario-policy-v3'
          }], rowCount: 1
        }
        if (sql.includes('FROM patient_scenarios')) return { rows: [], rowCount: 0 }
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
      return generated
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
        occurredAt: expect.any(String), usage: rejectedAttemptUsage
      }),
      expect.objectContaining({
        eventId: `usage_${createHash('sha256').update('openai\0resp_private').digest('hex')}`,
        sessionId, eventType: 'provider_usage', operation: 'scenario_generation',
        occurredAt: expect.any(String),
        usage: {
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
    expect(savedState).toHaveLength(1)
    expect(savedState[0]).toMatchObject({
      sessionId, patientProfileId, conversationId: 'conv_private',
      setupProjection: { diagnosis: 'Endometriosis' },
      profile: { diagnosis: 'Endometriosis' }, schemaVersion: 5
    })
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
            prompt_version: 'patient-scenario-prompt-v6', model_version: 'gpt-6-luna',
            schema_version: 5, policy_version: 'patient-scenario-policy-v3'
          }], rowCount: 1
        }
        if (sql.includes('FROM patient_scenarios')) return { rows: [], rowCount: 0 }
        return { rows: [], rowCount: 1 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const stateStore: PatientStateStore = {
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
            prompt_version: 'patient-scenario-prompt-v6', model_version: 'gpt-6-luna',
            schema_version: 5, policy_version: 'patient-scenario-policy-v3'
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
    const idempotencyHash = createHash('sha256').update('setup-key').digest('hex')
    const savedState: ReadyPatientState[] = []
    const stateStore: PatientStateStore = {
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
            prompt_version: 'patient-scenario-prompt-v6', model_version: 'gpt-6-luna',
            schema_version: 5, policy_version: 'patient-scenario-policy-v3'
          }], rowCount: 1
        }
        if (sql.includes('FROM patient_scenarios')) return {
          rows: [{
            scenario_id: patientProfileId, created_at: createdAt, profile_digest: profileDigest,
            profile_json: generated.profile, provider_conversation_id: generated.conversationId
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
      profile: { diagnosis: 'Endometriosis' }
    })
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
      profileDigest: 'a'.repeat(64), schemaVersion: 5,
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
      query: vi.fn(async () => ({ rows: [{ status: 'active' }], rowCount: 1 })),
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
      profileDigest: 'a'.repeat(64), schemaVersion: 5,
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
      query: vi.fn(async () => ({ rows: [{
        status: 'ready', prompt_version: 'patient-scenario-prompt-v6', model_version: 'gpt-6-luna',
        schema_version: 5, policy_version: 'patient-scenario-policy-v3'
      }], rowCount: 1 })),
      connect: vi.fn().mockResolvedValue(quotaClient)
    } as unknown as Pool
    const store = createPostgresSessionStore(pool, stateStore)
    let finishGeneration!: (value: {
      responseId: string
      output: unknown
      providerUsage: { responseId: string; inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number; durationMs: number } | null
    }) => void
    const generationWait = new Promise<{
      responseId: string
      output: unknown
      providerUsage: { responseId: string; inputTokens: number; cachedInputTokens: number; outputTokens: number; totalTokens: number; durationMs: number } | null
    }>((resolve) => {
      finishGeneration = resolve
    })
    const generateTurn = vi.fn(() => generationWait)
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
      providerUsage: {
        responseId: 'resp-private', inputTokens: 10, cachedInputTokens: 0,
        outputTokens: 8, totalTokens: 18, durationMs: 450
      },
      output: {
        patientResponse: 'Mostly on my left side.', proposedFacts: [], historyCoverage: ['anyPain'], disclosedHistoryFields: []
      }
    })
    expect(await submitting).toMatchObject({
      status: 'accepted', turnId: 'turn-0001', sequence: 1, patientResponse: 'Mostly on my left side.'
    })
    expect(stateStore.acceptTurn).toHaveBeenCalledWith(expect.any(Object), [{
      responseId: 'resp-private', inputTokens: 10, cachedInputTokens: 0,
      outputTokens: 8, totalTokens: 18, durationMs: 450
    }], undefined)

    expect(await store.submitPatientTurn(
      principal, sessionId, 'turn-0001', 'Do you have pain?', generateTurn, 'realtime_transcription'
    )).toMatchObject({
      status: 'duplicate', turnId: 'turn-0001', sequence: 1, patientResponse: 'Mostly on my left side.'
    })
    expect(await store.submitPatientTurn(
      principal, sessionId, 'turn-0001', 'A different message', generateTurn
    )).toBe('conflict')
    expect(await store.submitPatientTurn(
      principal, sessionId, 'turn-0001', 'Do you have pain?', generateTurn, 'typed'
    )).toBe('conflict')
    expect(generateTurn).toHaveBeenCalledOnce()
    expect(pool.connect).toHaveBeenCalledOnce()
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('e.sessions_enabled = true'),
      [sessionId, principal.tenantId, principal.subjectId]
    )
    expect(stateStore.acceptTurn).toHaveBeenCalledOnce()
    expect(stateStore.acceptTurn).toHaveBeenCalledWith(expect.objectContaining({
      learnerModality: 'realtime_transcription'
    }), [{
      responseId: 'resp-private', inputTokens: 10, cachedInputTokens: 0,
      outputTokens: 8, totalTokens: 18, durationMs: 450
    }], undefined)
    expect(stateStore.releaseTurnLock).toHaveBeenCalledTimes(4)
  })

  it('retries invalid model facts and commits only a safe clarification after bounded failure', async () => {
    let releaseAuditWrite!: () => void
    const auditWritePending = new Promise<void>((resolve) => { releaseAuditWrite = resolve })
    const appendAuditEvent = vi.fn(() => auditWritePending)
    const stateStore = {
      initialize: vi.fn(), saveReady: vi.fn(),
      read: vi.fn(async () => ({
        sessionId, patientProfileId, openedAt: createdAt.toISOString(),
        profile: generated.profile,
        setupProjection: { ...generated.profile },
        conversationId: generated.conversationId, profileDigest: 'a'.repeat(64), schemaVersion: 5,
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
      query: vi.fn(async () => ({ rows: [{
        status: 'ready', prompt_version: 'patient-scenario-prompt-v6', model_version: 'gpt-6-luna',
        schema_version: 5, policy_version: 'patient-scenario-policy-v3'
      }], rowCount: 1 })),
      connect: vi.fn().mockResolvedValue(quotaClient)
    } as unknown as Pool
    const recordHandoffTiming = vi.fn()
    const store = createPostgresSessionStore(pool, stateStore, { recordHandoffTiming })
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
    releaseAuditWrite()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(recordHandoffTiming).toHaveBeenCalledWith('audit_event_enqueue', expect.any(Number))
  })
})

describe('serialized assessment mutations', () => {
  it('does not change phase while another patient turn owns the session lock', async () => {
    const current = {
      sessionId, patientProfileId, openedAt: createdAt.toISOString(),
      profile: generated.profile, setupProjection: { ...generated.profile },
      conversationId: generated.conversationId, profileDigest: 'a'.repeat(64), schemaVersion: 5,
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
      query: vi.fn(async () => ({ rows: [{ status: 'active' }], rowCount: 1 }))
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
      conversationId: generated.conversationId, profileDigest: 'a'.repeat(64), schemaVersion: 5,
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
      query: vi.fn(async () => ({ rows: [{ status: 'active' }], rowCount: 1 }))
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
      conversationId: generated.conversationId, profileDigest: 'a'.repeat(64), schemaVersion: 5,
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
      query: vi.fn(async () => ({ rows: [{ status: 'completed' }], rowCount: 1 })),
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
