import { describe, expect, it } from 'vitest'
import {
  fingerprintScenario,
  verifySessionIdentityBinding,
  type SessionIdentityBinding
} from '../../services/api/src/session-identity.ts'
import type { LivePatientState } from '../../services/api/src/patient-state-store.ts'
import { TEST_PATIENT_PHYSICAL_EXAM_FINDINGS, TEST_PATIENT_VITAL_SIGNS } from '../fixtures/patient-vital-signs.ts'
import { makePainEpisode } from '../fixtures/pain-episodes.ts'

const sessionId = 's'.repeat(43)
const patientProfileId = 'p'.repeat(43)
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
const scenarioFingerprint = fingerprintScenario(profile)
const binding: SessionIdentityBinding = {
  sessionId,
  tenantId: 'tenant-a',
  subjectId: 'learner-a',
  patientProfileId,
  providerConversationId: 'conv_private',
  scenarioFingerprint,
  schemaVersion: 7
}

function liveState(overrides: Partial<LivePatientState> = {}): LivePatientState {
  return {
    sessionId,
    patientProfileId,
    profile,
    conversationId: 'conv_private',
    profileDigest: scenarioFingerprint,
    schemaVersion: 7,
    state: {} as LivePatientState['state'],
    acceptedTurns: [],
    assessment: null,
    terminalEvent: null,
    setupProjection: {} as LivePatientState['setupProjection'],
    openedAt: '2026-10-01T00:00:00.000Z',
    ...overrides
  }
}

describe('session identity binding', () => {
  it('fingerprints canonical scenario data independent of property insertion order', () => {
    const reordered = Object.fromEntries(Object.entries(profile).reverse())

    expect(fingerprintScenario(reordered)).toBe(scenarioFingerprint)
    expect(fingerprintScenario({ ...profile, reasonForVisit: 'Abdominal pain' })).not.toBe(scenarioFingerprint)
  })

  it('verifies the live session, profile, Conversation, schema, and scenario digest as one identity', () => {
    expect(verifySessionIdentityBinding(binding, liveState())).toBe('verified')
    expect(verifySessionIdentityBinding(binding, null)).toBe('redis_missing')

    for (const altered of [
      liveState({ sessionId: 'x'.repeat(43) }),
      liveState({ patientProfileId: 'x'.repeat(43) }),
      liveState({ conversationId: 'conv_other' }),
      liveState({ profile: { ...profile, reasonForVisit: 'Abdominal pain' } }),
      liveState({ profileDigest: 'a'.repeat(64) }),
      liveState({ schemaVersion: 6 as 7 })
    ]) {
      expect(verifySessionIdentityBinding(binding, altered)).toBe('mismatch')
    }
  })
})
