import type OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'
import {
  generatePatientTurn,
  validatePatientTurnOutput,
  type PatientTurnGenerationContext
} from '../../services/api/src/patient-turn.ts'
import type { PatientScenarioProfile } from '../../services/api/src/patient-profile.ts'

const profile: PatientScenarioProfile = {
  fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average',
  reasonForVisit: 'Pelvic pain', diagnosis: 'Endometriosis',
  history: [
    { field: 'anyPain', status: 'unknown', value: null },
    { field: 'currentMedications', status: 'known', value: ['Ibuprofen'] }
  ],
  currentPregnancyStatus: 'unknown', currentMenopausalStatus: 'unknown',
  patientBeliefs: [], supportedExamFindings: [], supportedTestResults: [],
  persona: {
    mood: 'concerned', maturity: 'adult', verbosity: 'moderate',
    educationLevel: 'college', willingnessToDisclose: 'gradual'
  }
}

const context: PatientTurnGenerationContext = {
  scenarioId: 'scenario-1', profile, conversationId: 'conv_private',
  versions: {
    promptVersion: 'patient-turn-prompt-v2', modelVersion: 'gpt-6-luna',
    schemaVersion: 1, policyVersion: 'patient-turn-policy-v2', rubricVersion: null
  },
  acceptedTurns: [], phase: 'history', learnerMessage: 'Where does it hurt?'
}
const acceptedAt = '2026-10-03T03:04:05.000Z'

describe('patient turn generation and validation', () => {
  it('omits diagnosis from the turn projection and uses the session Conversation', async () => {
    const parse = vi.fn().mockResolvedValue({
      id: 'resp-turn', status: 'completed',
      output_parsed: {
        patientResponse: 'In my lower abdomen.', proposedFacts: [], historyCoverage: [], disclosedHistoryFields: []
      }
    })
    const client = { responses: { parse } } as unknown as OpenAI

    const result = await generatePatientTurn(client, 'gpt-6-luna', context)

    expect(result).toEqual({
      responseId: 'resp-turn',
      output: {
        patientResponse: 'In my lower abdomen.', proposedFacts: [], historyCoverage: [], disclosedHistoryFields: []
      }
    })
    const request = parse.mock.calls[0]?.[0]
    expect(request).toHaveProperty('conversation', 'conv_private')
    expect(request).not.toHaveProperty('previous_response_id')
    expect(request?.input?.[0]?.content).toContain('patient-centered')
    expect(request?.input?.[0]?.content).toContain('Do not pressure the patient to answer a sensitive question')
    expect(request?.input?.[0]?.content).toContain('accept a refusal briefly')
    expect(request?.input?.[0]?.content).toContain('Conversation repair is mutual and follows a volley')
    expect(request?.input?.[0]?.content).toContain('one repair step at a time in this order')
    expect(request?.input?.[0]?.content).toContain('up to three or four times')
    expect(request?.input?.[0]?.content).toContain('advance only when the current step has not resolved understanding')
    expect(request?.input?.[0]?.content).toContain('Preserve the original English wording; do not translate it')
    const userInput = JSON.parse(String(request?.input?.[1]?.content)) as Record<string, unknown>
    expect(userInput.patientScenario).not.toHaveProperty('diagnosis')
    expect(userInput.patientScenario).toMatchObject({
      relevantHistory: [{ field: 'anyPain', status: 'unknown', value: null, source: 'expandable_seed_cue' }]
    })
    expect(userInput.patientScenario).not.toHaveProperty('supportedTestResults')
    expect(userInput).not.toHaveProperty('acceptedEncounter')
    expect(userInput).toMatchObject({ phase: 'history', latestLearnerMessage: context.learnerMessage })
  })

  it('does not send profile history when the learner message matches no history cue', async () => {
    const parse = vi.fn().mockResolvedValue({
      id: 'resp-turn', status: 'completed',
      output_parsed: {
        patientResponse: 'Good morning.', proposedFacts: [], historyCoverage: [], disclosedHistoryFields: []
      }
    })
    const client = { responses: { parse } } as unknown as OpenAI

    await generatePatientTurn(client, 'gpt-6-luna', { ...context, learnerMessage: 'Good morning.' })

    const request = parse.mock.calls[0]?.[0]
    const userInput = JSON.parse(String(request?.input?.[1]?.content)) as {
      patientScenario: { relevantHistory: unknown[] }
    }
    expect(userInput.patientScenario.relevantHistory).toEqual([])
  })

  it('accepts a new fact only for a scenario history field explicitly marked unknown', () => {
    const accepted = validatePatientTurnOutput({
      patientResponse: 'It is mostly on my left side.',
      proposedFacts: [{ field: 'anyPain', value: 'Mostly on the left side' }],
      historyCoverage: ['anyPain'], disclosedHistoryFields: ['anyPain']
    }, context, 'turn-1', 1, acceptedAt)

    expect(accepted.patientReportedFacts).toHaveLength(1)
    expect(accepted.patientReportedFacts[0]).toMatchObject({
      field: 'anyPain', value: 'Mostly on the left side', source: 'patient_reported',
      turnId: 'turn-1', turnSequence: 1, recordedAt: acceptedAt
    })
    expect(accepted.disclosedFactIds).toHaveLength(1)
    expect(accepted.historyCoverageState).toEqual([{
      field: 'anyPain', asked: true, relevant: true, missing: false, sensitive: false, notRelevant: false
    }])
  })

  it('rejects a proposed fact when it is absent from the scenario or the scenario already knows it', () => {
    expect(() => validatePatientTurnOutput({
      patientResponse: 'I have a fever.', proposedFacts: [{ field: 'medicalHistory', value: 'Fever' }],
      historyCoverage: ['anyPain'], disclosedHistoryFields: []
    }, context, 'turn-1', 1, acceptedAt)).toThrow('outside an unknown scenario history field')

    const medicationContext = { ...context, learnerMessage: 'What medications do you take?' }
    expect(() => validatePatientTurnOutput({
      patientResponse: 'I take ibuprofen.', proposedFacts: [{ field: 'currentMedications', value: ['Ibuprofen'] }],
      historyCoverage: ['currentMedications'], disclosedHistoryFields: ['currentMedications']
    }, medicationContext, 'turn-1', 1, acceptedAt)).toThrow('outside an unknown scenario history field')
  })

  it('keeps previously accepted facts stable and omits an identical repeat', () => {
    const priorFact = {
      factId: 'fact-1', field: 'anyPain' as const, value: 'Mostly on the left side',
      source: 'patient_reported' as const, turnId: 'turn-1', turnSequence: 1, recordedAt: acceptedAt
    }
    const withPrior: PatientTurnGenerationContext = {
      ...context,
      acceptedTurns: [{
        turnId: 'turn-1', sessionId: 's'.repeat(43), sequence: 1, acceptedAt, phase: 'history',
      learnerMessage: 'Where does it hurt?', patientResponse: 'On my left side.',
      patientReportedFacts: [priorFact], historyCoverage: ['anyPain'], disclosedHistoryFields: ['anyPain'],
      disclosedFactIds: ['fact-1'],
      historyCoverageState: [{
        field: 'anyPain', asked: true, relevant: true, missing: false, sensitive: false, notRelevant: false
      }],
        clinicalActions: []
      }]
    }

    expect(validatePatientTurnOutput({
      patientResponse: 'As I said, the left side.',
      proposedFacts: [{ field: 'anyPain', value: 'Mostly on the left side' }],
      historyCoverage: ['anyPain'], disclosedHistoryFields: ['anyPain']
    }, withPrior, 'turn-2', 2, '2026-10-03T03:05:00.000Z').patientReportedFacts).toEqual([])
    expect(() => validatePatientTurnOutput({
      patientResponse: 'Actually, it is on the right.',
      proposedFacts: [{ field: 'anyPain', value: 'Mostly on the right side' }],
      historyCoverage: ['anyPain'], disclosedHistoryFields: ['anyPain']
    }, withPrior, 'turn-2', 2, '2026-10-03T03:05:00.000Z')).toThrow('conflicts with an already accepted patient fact')
  })

  it('checks obstetric outcome counts before accepting an expansion', () => {
    const fields = [
      ['numberPregnancies', 7], ['numberStillbirths', 1], ['numberMiscarriage', 2],
      ['numberAbortions', 0], ['numberEctopicPregnancies', 0], ['numberLiveBirths', 4],
      ['numberChildren', 4]
    ] as const
    const obstetricContext: PatientTurnGenerationContext = {
      ...context,
      learnerMessage: 'How many pregnancies, miscarriages, stillbirths, abortions, ectopic pregnancies, live births, and children?',
      profile: {
        ...profile,
        currentPregnancyStatus: 'not_pregnant',
        history: fields.map(([field]) => ({ field, status: 'unknown' as const, value: null }))
      }
    }
    const proposedFacts = fields.map(([field, value]) => ({ field, value }))
    const historyCoverage = fields.map(([field]) => field)
    const disclosedHistoryFields = fields.map(([field]) => field)
    const accepted = validatePatientTurnOutput({
      patientResponse: 'I have been pregnant seven times with those outcomes and four children.',
      proposedFacts, historyCoverage, disclosedHistoryFields
    }, obstetricContext, 'turn-ob-1', 1, acceptedAt)
    expect(accepted.patientReportedFacts).toHaveLength(fields.length)

    expect(() => validatePatientTurnOutput({
      patientResponse: 'I have been pregnant eight times with those outcomes.',
      proposedFacts: proposedFacts.map((fact) => fact.field === 'numberPregnancies'
        ? { ...fact, value: 8 }
        : fact),
      historyCoverage, disclosedHistoryFields
    }, obstetricContext, 'turn-ob-2', 1, acceptedAt)).toThrow('do not match the completed pregnancy count')
  })

  it('excludes the active pregnancy from completed obstetric outcomes', () => {
    const fields = [
      ['numberPregnancies', 3], ['numberStillbirths', 0], ['numberMiscarriage', 1],
      ['numberAbortions', 0], ['numberEctopicPregnancies', 0], ['numberLiveBirths', 1],
      ['numberChildren', 1]
    ] as const
    const obstetricContext: PatientTurnGenerationContext = {
      ...context,
      learnerMessage: 'How many pregnancies, miscarriages, stillbirths, abortions, ectopic pregnancies, live births, and children?',
      profile: {
        ...profile,
        currentPregnancyStatus: 'pregnant',
        history: fields.map(([field]) => ({ field, status: 'unknown' as const, value: null }))
      }
    }
    const proposedFacts = fields.map(([field, value]) => ({ field, value }))
    const historyCoverage = fields.map(([field]) => field)
    const disclosedHistoryFields = fields.map(([field]) => field)

    expect(() => validatePatientTurnOutput({
      patientResponse: 'I am pregnant now. I had one miscarriage and one live birth.',
      proposedFacts, historyCoverage, disclosedHistoryFields
    }, obstetricContext, 'turn-current-pregnancy', 1, acceptedAt)).not.toThrow()

    expect(() => validatePatientTurnOutput({
      patientResponse: 'I am pregnant now and all three pregnancies have ended.',
      proposedFacts: proposedFacts.map((fact) => fact.field === 'numberMiscarriage'
        ? { ...fact, value: 2 }
        : fact),
      historyCoverage, disclosedHistoryFields
    }, obstetricContext, 'turn-current-pregnancy-invalid', 1, acceptedAt))
      .toThrow('do not match the completed pregnancy count')
  })

  it('marks sensitive history and rejects disclosure outside the learner cue', () => {
    const sensitiveContext = {
      ...context,
      learnerMessage: 'Are you sexually active?',
      profile: {
        ...profile,
        history: [
          { field: 'sexualActivityCurrent' as const, status: 'unknown' as const, value: null },
          { field: 'currentMedications' as const, status: 'known' as const, value: ['Ibuprofen'] }
        ]
      }
    }
    const accepted = validatePatientTurnOutput({
      patientResponse: 'Yes, I am sexually active.',
      proposedFacts: [{ field: 'sexualActivityCurrent', value: 'Yes' }],
      historyCoverage: ['sexualActivityCurrent'], disclosedHistoryFields: ['sexualActivityCurrent']
    }, sensitiveContext, 'turn-sensitive', 1, acceptedAt)
    expect(accepted.historyCoverageState).toEqual([{
      field: 'sexualActivityCurrent', asked: true, relevant: true, missing: false,
      sensitive: true, notRelevant: false
    }])

    expect(() => validatePatientTurnOutput({
      patientResponse: 'I also take ibuprofen.', proposedFacts: [], historyCoverage: [],
      disclosedHistoryFields: ['currentMedications']
    }, sensitiveContext, 'turn-sensitive-2', 2, acceptedAt)).toThrow('outside the matched learner cue')
  })
})
