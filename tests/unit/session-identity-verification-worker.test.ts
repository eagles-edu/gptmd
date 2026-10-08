import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import type { LivePatientState, PatientStateStore } from '../../services/api/src/patient-state-store.ts'
import { createSessionIdentityVerificationWorker } from '../../services/api/src/session-identity-verification-worker.ts'
import { fingerprintScenario } from '../../services/api/src/session-identity.ts'
import { TEST_PATIENT_PHYSICAL_EXAM_FINDINGS, TEST_PATIENT_VITAL_SIGNS } from '../fixtures/patient-vital-signs.ts'
import { makePainEpisode } from '../fixtures/pain-episodes.ts'

const profile = {
  fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average' as const,
  reasonForVisit: 'Pelvic pain', diagnosis: 'Endometriosis', painHistoryStatus: 'present' as const,
  painEpisodes: [makePainEpisode('pain-1', 'pelvic pain')], history: [],
  vitalSigns: TEST_PATIENT_VITAL_SIGNS,
  physicalExamFindings: TEST_PATIENT_PHYSICAL_EXAM_FINDINGS,
  currentPregnancyStatus: 'unknown' as const, currentMenopausalStatus: 'unknown' as const,
  patientBeliefs: [], supportedExamFindings: [], supportedTestResults: [],
  persona: {
    mood: 'concerned' as const, maturity: 'adult' as const, verbosity: 'moderate' as const,
    educationLevel: 'college' as const, willingnessToDisclose: 'gradual' as const
  }
}

const identityRows = [
  { session_id: 'v'.repeat(43), tenant_id: 'tenant-a', subject_id: 'learner-a', patient_profile_id: 'p'.repeat(43), provider_conversation_id: 'conv_verified', scenario_fingerprint: fingerprintScenario(profile), schema_version: 7 },
  { session_id: 'm'.repeat(43), tenant_id: 'tenant-a', subject_id: 'learner-a', patient_profile_id: 'p'.repeat(43), provider_conversation_id: 'conv_missing', scenario_fingerprint: fingerprintScenario(profile), schema_version: 7 },
  { session_id: 'u'.repeat(43), tenant_id: 'tenant-a', subject_id: 'learner-a', patient_profile_id: 'p'.repeat(43), provider_conversation_id: 'conv_unavailable', scenario_fingerprint: fingerprintScenario(profile), schema_version: 7 },
  { session_id: 'x'.repeat(43), tenant_id: 'tenant-a', subject_id: 'learner-a', patient_profile_id: 'p'.repeat(43), provider_conversation_id: 'conv_expected', scenario_fingerprint: fingerprintScenario(profile), schema_version: 7 }
]

function stateFor(sessionId: string, conversationId: string): LivePatientState {
  const digest = fingerprintScenario(profile)
  return {
    sessionId,
    patientProfileId: 'p'.repeat(43),
    profile,
    conversationId,
    profileDigest: digest,
    schemaVersion: 7,
    state: {} as LivePatientState['state'],
    acceptedTurns: [],
    assessment: null,
    terminalEvent: null,
    setupProjection: {} as LivePatientState['setupProjection'],
    openedAt: '2026-10-01T00:00:00.000Z'
  }
}

describe('session identity verification worker', () => {
  it('checks due sessions and records verified, missing, unavailable, and mismatched Redis bindings', async () => {
    const updates: Array<{ sessionId: string; status: string }> = []
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes('SELECT i.session_id')) return { rows: identityRows, rowCount: identityRows.length }
      if (sql.includes('UPDATE session_identity_binding')) {
        updates.push({ sessionId: String(values?.[0]), status: String(values?.[1]) })
        return { rows: [], rowCount: 1 }
      }
      throw new Error(`Unexpected query: ${sql}`)
    })
    const read = vi.fn(async (sessionId: string) => {
      if (sessionId === 'm'.repeat(43)) return null
      if (sessionId === 'u'.repeat(43)) throw new Error('Redis unavailable')
      return stateFor(sessionId, sessionId === 'x'.repeat(43) ? 'conv_wrong' : 'conv_verified')
    })
    const worker = createSessionIdentityVerificationWorker(
      { query } as unknown as Pool,
      { read } as unknown as PatientStateStore,
      { batchSize: 25, verificationIntervalSeconds: 900 }
    )

    await expect(worker.verifyOnce()).resolves.toMatchObject({
      checked: 4, verified: 1, redisMissing: 1, redisUnavailable: 1, mismatches: 1
    })
    expect(query).toHaveBeenCalledWith(expect.stringContaining('s.status IN (\'ready\', \'active\')'), [900, 25])
    expect(updates).toEqual([
      { sessionId: 'v'.repeat(43), status: 'verified' },
      { sessionId: 'm'.repeat(43), status: 'redis_missing' },
      { sessionId: 'u'.repeat(43), status: 'redis_unavailable' },
      { sessionId: 'x'.repeat(43), status: 'mismatch' }
    ])
  })
})
