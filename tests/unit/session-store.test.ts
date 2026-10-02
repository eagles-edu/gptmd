import type { Pool, PoolClient } from 'pg'
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { AuthenticatedPrincipal } from '../../services/api/src/auth.ts'
import type { PatientStateStore, ReadyPatientState } from '../../services/api/src/patient-state-store.ts'
import { createPostgresSessionStore } from '../../services/api/src/session-store.ts'
import type { GeneratedPatientScenario } from '../../services/api/src/patient-profile.ts'

const principal: AuthenticatedPrincipal = { subjectId: 'learner-a', tenantId: 'tenant-a' }
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
  usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
  abandonedConversationIds: []
}

describe('patient setup persistence coordination', () => {
  it('initializes Redis before generation and binds the accepted profile and Conversation to both IDs', async () => {
    const order: string[] = []
    const savedState: ReadyPatientState[] = []
    const patientStateStore: PatientStateStore = {
      initialize: vi.fn(async (sid, ppid) => {
        expect(sid).toBe(sessionId)
        expect(ppid).toBe(patientProfileId)
        order.push('redis-initialize')
      }),
      saveReady: vi.fn(async (state) => {
        savedState.push(state)
        order.push('redis-ready')
      })
    }
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
        if (sql.includes('FROM app_sessions')) return {
          rows: [{
            session_id: sessionId, patient_profile_id: patientProfileId, status: 'initializing',
            created_at: createdAt, setup_idempotency_key_hash: null,
            prompt_version: 'patient-scenario-prompt-v1', model_version: 'gpt-6-luna',
            schema_version: 1, policy_version: 'patient-scenario-policy-v1'
          }], rowCount: 1
        }
        if (sql.includes('FROM patient_scenarios')) return { rows: [], rowCount: 0 }
        return { rows: [], rowCount: 1 }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const store = createPostgresSessionStore(pool, patientStateStore)
    const generate = vi.fn(async () => {
      order.push('generate')
      return generated
    })

    const result = await store.setupScenario(principal, sessionId, 'setup-key', generate)

    expect(order).toEqual(['redis-initialize', 'generate', 'redis-ready'])
    expect(generate).toHaveBeenCalledOnce()
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
      profile: { diagnosis: 'Endometriosis' }, schemaVersion: 1
    })
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('does not invoke profile generation when Redis state cannot be initialized', async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
        if (sql.includes('FROM app_sessions')) return {
          rows: [{
            session_id: sessionId, patient_profile_id: patientProfileId, status: 'initializing',
            created_at: createdAt, setup_idempotency_key_hash: null,
            prompt_version: 'patient-scenario-prompt-v1', model_version: 'gpt-6-luna',
            schema_version: 1, policy_version: 'patient-scenario-policy-v1'
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
      saveReady: vi.fn()
    }
    const generate = vi.fn().mockResolvedValue(generated)
    const store = createPostgresSessionStore(pool, stateStore)

    await expect(store.setupScenario(principal, sessionId, 'setup-key', generate)).rejects.toThrow('Redis unavailable')
    expect(generate).not.toHaveBeenCalled()
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('repairs Redis from the same saved scenario and Conversation on an idempotent retry', async () => {
    const profileDigest = createHash('sha256').update(JSON.stringify(generated.profile)).digest('hex')
    const idempotencyHash = createHash('sha256').update('setup-key').digest('hex')
    const savedState: ReadyPatientState[] = []
    const stateStore: PatientStateStore = {
      initialize: vi.fn(),
      saveReady: vi.fn(async (state) => { savedState.push(state) })
    }
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [], rowCount: 0 }
        if (sql.includes('FROM app_sessions')) return {
          rows: [{
            session_id: sessionId, patient_profile_id: patientProfileId, status: 'ready',
            created_at: createdAt, setup_idempotency_key_hash: idempotencyHash,
            prompt_version: 'patient-scenario-prompt-v1', model_version: 'gpt-6-luna',
            schema_version: 1, policy_version: 'patient-scenario-policy-v1'
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
