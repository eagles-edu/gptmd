import type OpenAI from 'openai'
import { describe, expect, it } from 'vitest'
import {
  generatePatientTurn,
  matchHistoryCueFields,
  validatePatientTurnOutput,
  type PatientTurnGenerationContext
} from '../../services/api/src/patient-turn.ts'
import type { PatientScenarioProfile } from '../../services/api/src/patient-profile.ts'
import { createMockResponsesStream } from './helpers/openai-response-stream.ts'

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
    promptVersion: 'patient-turn-prompt-v7', modelVersion: 'gpt-6-luna',
    schemaVersion: 3, policyVersion: 'patient-turn-policy-v7', rubricVersion: null
  },
  acceptedTurns: [], phase: 'history', learnerMessage: 'Do you have pain?'
}
const acceptedAt = '2026-10-03T03:04:05.000Z'

describe('patient turn generation and validation', () => {
  it('omits diagnosis from the turn projection and uses the session Conversation', async () => {
    const { streamFactory } = createMockResponsesStream({
      id: 'resp-turn', status: 'completed',
      usage: {
        input_tokens: 42, input_tokens_details: { cached_tokens: 12 },
        output_tokens: 9, total_tokens: 51
      },
      output_parsed: {
        patientResponse: 'In my lower abdomen.', proposedFacts: [], historyCoverage: [], disclosedHistoryFields: []
      }
    })
    const client = { responses: { stream: streamFactory } } as unknown as OpenAI
    const timings: Array<{ stage: string; elapsedMs: number }> = []

    const result = await generatePatientTurn(client, 'gpt-6-luna', context,
      (stage, elapsedMs) => timings.push({ stage, elapsedMs }))

    expect(result).toEqual({
      responseId: 'resp-turn',
      providerUsage: {
        responseId: 'resp-turn', model: 'gpt-6-luna', serviceTier: 'default',
        inputTokens: 42, cachedInputTokens: 12, cacheWriteTokens: 0,
        outputTokens: 9, totalTokens: 51, durationMs: expect.any(Number),
        pricingVersion: 'openai-api-pricing-2026-10-06', estimatedCostUsd: '0.000007620000'
      },
      output: {
        patientResponse: 'In my lower abdomen.', proposedFacts: [], historyCoverage: [], disclosedHistoryFields: []
      }
    })
    const request = streamFactory.mock.calls[0]?.[0] as {
      conversation?: string; input?: Array<{ content?: unknown }>
    }
    expect(timings.map((timing) => timing.stage)).toEqual(['first_token', 'completed'])
    expect(timings.every((timing) => Number.isFinite(timing.elapsedMs) && timing.elapsedMs >= 0)).toBe(true)
    expect(request).toHaveProperty('conversation', 'conv_private')
    expect(request).not.toHaveProperty('previous_response_id')
    expect(request?.input?.[0]?.content).toContain('patient-centered')
    expect(request?.input?.[0]?.content).toContain('Do not pressure the patient to answer a sensitive question')
    expect(request?.input?.[0]?.content).toContain('explain its relevance')
    expect(request?.input?.[0]?.content).toContain('answer now, partly, or later')
    expect(request?.input?.[0]?.content).toContain('Direct answers are the default')
    expect(request?.input?.[0]?.content).toContain('a refusal is an occasional, topic-specific response')
    expect(request?.input?.[0]?.content).toContain('invite the patient to revisit the question')
    expect(request?.input?.[0]?.content).toContain('When a directly matched scenario history field is marked unknown')
    expect(request?.input?.[0]?.content).toContain('unknown miscellaneousDetailsNos history field is an expandable patient-reported catchall')
    expect(request?.input?.[0]?.content).toContain('Conversation repair is mutual and follows a volley')
    expect(request?.input?.[0]?.content).toContain('one repair step at a time in this order')
    expect(request?.input?.[0]?.content).toContain('up to three or four times')
    expect(request?.input?.[0]?.content).toContain('advance only when the current step has not resolved understanding')
    expect(request?.input?.[0]?.content).toContain('Preserve the original English wording; do not translate it')
    const userInput = JSON.parse(String(request?.input?.[1]?.content)) as Record<string, unknown>
    expect(userInput.patientScenario).not.toHaveProperty('diagnosis')
    expect(userInput.patientScenario).not.toHaveProperty('bodyType')
    expect(userInput.patientScenario).toMatchObject({
      relevantHistory: [{ field: 'anyPain', status: 'unknown', value: null, source: 'expandable_seed_cue' }]
    })
    expect(userInput.patientScenario).not.toHaveProperty('supportedTestResults')
    expect(userInput).toMatchObject({
      matchedFieldResponseGuidance: {
        anyPain: {
          commonPatientWording: expect.stringContaining('Yes, I have pain.'),
          clinicianAssistedGuidance: expect.stringContaining('current versus episodic')
        }
      }
    })
    expect(userInput.matchedFieldResponseGuidance).not.toHaveProperty('painQuality')
    expect(userInput).not.toHaveProperty('acceptedEncounter')
    expect(userInput).toMatchObject({ phase: 'history', latestLearnerMessage: context.learnerMessage })
  })

  it('does not send profile history when the learner message matches no history cue', async () => {
    const { streamFactory } = createMockResponsesStream({
      id: 'resp-turn', status: 'completed',
      output_parsed: {
        patientResponse: 'Good morning.', proposedFacts: [], historyCoverage: [], disclosedHistoryFields: []
      }
    })
    const client = { responses: { stream: streamFactory } } as unknown as OpenAI

    await generatePatientTurn(client, 'gpt-6-luna', { ...context, learnerMessage: 'Good morning.' })

    const request = streamFactory.mock.calls[0]?.[0] as { input?: Array<{ content?: unknown }> }
    const userInput = JSON.parse(String(request?.input?.[1]?.content)) as {
      patientScenario: { relevantHistory: unknown[] }
    }
    expect(userInput.patientScenario.relevantHistory).toEqual([])
  })

  it('routes onset and associated-negative questions to their own hidden fields', () => {
    expect(matchHistoryCueFields('When did the pain begin?')).toEqual(['timePainOnset'])
    expect(matchHistoryCueFields('How many pregnancies?')).toEqual(['numberPregnancies'])
    expect(matchHistoryCueFields('How many previous pregnancies reached 20 weeks?'))
      .toEqual(['numberPriorPregnanciesReaching20Weeks'])
    expect(matchHistoryCueFields('What is your parity?'))
      .toEqual(['numberPriorPregnanciesReaching20Weeks'])
    expect(matchHistoryCueFields('How many children do you have?')).toEqual(['numberChildren'])
    expect(matchHistoryCueFields('Do you have any other associated symptoms, such as fever or nausea?'))
      .toEqual(['miscellaneousDetailsNos'])
  })

  it.each([
    ['How would you describe the pain?', 'painQuality', 'Do not replace their description with a disease label'],
    ['Where is the pain, and does it travel anywhere?', 'painLocationRadiationWhere', 'Do not infer an organ or source from location alone'],
    ['Do you have period cramps?', 'dysmenorrheaHistory', 'Do not label primary or secondary dysmenorrhea from the symptom alone']
  ])('sends only PP guidance for the matched, scenario-supported %s field', async (learnerMessage, field, fidelityRule) => {
    const { streamFactory } = createMockResponsesStream({
      id: 'resp-turn', status: 'completed',
      output_parsed: {
        patientResponse: 'It feels like cramps.', proposedFacts: [], historyCoverage: [], disclosedHistoryFields: []
      }
    })
    const client = { responses: { stream: streamFactory } } as unknown as OpenAI

    const fieldContext: PatientTurnGenerationContext = {
      ...context,
      learnerMessage,
      profile: {
        ...profile,
        history: [{ field, status: 'unknown', value: null }]
      }
    }
    await generatePatientTurn(client, 'gpt-6-luna', fieldContext)

    const request = streamFactory.mock.calls[0]?.[0] as { input?: Array<{ content?: unknown }> }
    const userInput = JSON.parse(String(request?.input?.[1]?.content)) as {
      matchedFieldResponseGuidance: Record<string, { commonPatientWording: string; clinicianAssistedGuidance: string }>
    }
    expect(Object.keys(userInput.matchedFieldResponseGuidance)).toEqual([field])
    expect(userInput.matchedFieldResponseGuidance[field]?.commonPatientWording).toContain('“')
    expect(userInput.matchedFieldResponseGuidance[field]?.clinicianAssistedGuidance).toContain(fidelityRule)
  })

  it('omits matched PP guidance when the case has no corresponding history field', async () => {
    const { streamFactory } = createMockResponsesStream({
      id: 'resp-turn', status: 'completed',
      output_parsed: {
        patientResponse: 'I’m not sure.', proposedFacts: [], historyCoverage: [], disclosedHistoryFields: []
      }
    })
    const client = { responses: { stream: streamFactory } } as unknown as OpenAI

    await generatePatientTurn(client, 'gpt-6-luna', { ...context, learnerMessage: 'How would you describe the pain?' })

    const request = streamFactory.mock.calls[0]?.[0] as { input?: Array<{ content?: unknown }> }
    const userInput = JSON.parse(String(request?.input?.[1]?.content)) as {
      matchedFieldResponseGuidance: Record<string, unknown>
    }
    expect(userInput.matchedFieldResponseGuidance).toEqual({})
  })

  it('permits an approximate onset estimate only as an asked, generated patient report', async () => {
    const onsetContext: PatientTurnGenerationContext = {
      ...context,
      learnerMessage: 'When did the pain begin?',
      profile: {
        ...profile,
        history: [{ field: 'timePainOnset', status: 'unknown', value: null }]
      }
    }
    const { streamFactory } = createMockResponsesStream({
      id: 'resp-onset', status: 'completed',
      output_parsed: {
        patientResponse: 'It started about a week ago.',
        proposedFacts: [{ field: 'timePainOnset', value: 'About a week ago' }],
        historyCoverage: ['timePainOnset'],
        disclosedHistoryFields: ['timePainOnset']
      }
    })
    const client = { responses: { stream: streamFactory } } as unknown as OpenAI

    await generatePatientTurn(client, 'gpt-6-luna', onsetContext)

    const request = streamFactory.mock.calls[0]?.[0] as { input?: Array<{ content?: unknown }> }
    expect(request?.input?.[0]?.content)
      .toContain('brief, approximate, plausible patient-reported timeframe')
    expect(request?.input?.[0]?.content)
      .toContain('never back-calculate an exact date from the encounter date or infer onset from cycle pattern')
    const userInput = JSON.parse(String(request?.input?.[1]?.content)) as {
      matchedHistoryTopics: string[]
      matchedFieldResponseGuidance: Record<string, { clinicianAssistedGuidance: string }>
    }
    expect(userInput.matchedHistoryTopics).toEqual(['timePainOnset'])
    expect(userInput.matchedFieldResponseGuidance.timePainOnset?.clinicianAssistedGuidance)
      .toContain('may give a brief approximate estimate only when asked')

    const accepted = validatePatientTurnOutput({
      patientResponse: 'It started about a week ago.',
      proposedFacts: [{ field: 'timePainOnset', value: 'About a week ago' }],
      historyCoverage: ['timePainOnset'],
      disclosedHistoryFields: ['timePainOnset']
    }, onsetContext, 'turn-onset', 1, acceptedAt)
    expect(accepted.patientReportedFacts).toMatchObject([{
      field: 'timePainOnset',
      value: 'About a week ago',
      source: 'patient_reported',
      turnId: 'turn-onset'
    }])
  })

  it('accepts an on-demand catchall response only when the learner asks about associated symptoms', () => {
    const catchallContext: PatientTurnGenerationContext = {
      ...context,
      learnerMessage: 'Do you have any other associated symptoms?',
      profile: {
        ...profile,
        history: [{ field: 'miscellaneousDetailsNos', status: 'unknown', value: null }]
      }
    }
    const accepted = validatePatientTurnOutput({
      patientResponse: 'I have not had a fever or nausea.',
      proposedFacts: [{ field: 'miscellaneousDetailsNos', value: ['No fever', 'No nausea'] }],
      historyCoverage: ['miscellaneousDetailsNos'],
      disclosedHistoryFields: ['miscellaneousDetailsNos']
    }, catchallContext, 'turn-other-symptoms', 1, acceptedAt)

    expect(accepted.patientReportedFacts).toHaveLength(1)
    expect(accepted.patientReportedFacts[0]).toMatchObject({
      field: 'miscellaneousDetailsNos',
      section: 'Safety, trauma, and other information',
      value: ['No fever', 'No nausea']
    })
  })

  it('accepts a new fact only for a scenario history field explicitly marked unknown', () => {
    const accepted = validatePatientTurnOutput({
      patientResponse: 'It is mostly on my left side.',
      proposedFacts: [{ field: 'anyPain', value: 'Mostly on the left side' }],
      historyCoverage: ['anyPain'], disclosedHistoryFields: ['anyPain']
    }, context, 'turn-1', 1, acceptedAt)

    expect(accepted.patientReportedFacts).toHaveLength(1)
    expect(accepted.patientReportedFacts[0]).toMatchObject({
      field: 'anyPain', section: 'Symptoms and menstrual history',
      value: 'Mostly on the left side', source: 'patient_reported',
      turnId: 'turn-1', turnSequence: 1, recordedAt: acceptedAt
    })
    expect(accepted.disclosedFactIds).toHaveLength(1)
    expect(accepted.historyCoverageState).toEqual([{
      field: 'anyPain', asked: true, relevant: true, missing: false, sensitive: false, notRelevant: false
    }])
  })

  it('matches allergy questions to the explicit allergy history field', () => {
    const allergyContext: PatientTurnGenerationContext = {
      ...context,
      learnerMessage: 'Are you allergic to penicillin?',
      profile: {
        ...profile,
        history: [{ field: 'allergies', status: 'unknown', value: null }]
      }
    }
    const accepted = validatePatientTurnOutput({
      patientResponse: 'Penicillin gives me a rash.',
      proposedFacts: [{ field: 'allergies', value: 'Penicillin causes a rash' }],
      historyCoverage: ['allergies'], disclosedHistoryFields: ['allergies']
    }, allergyContext, 'turn-allergy', 1, acceptedAt)

    expect(accepted.patientReportedFacts).toMatchObject([{ field: 'allergies', value: 'Penicillin causes a rash' }])
    expect(accepted.disclosedHistoryFields).toEqual(['allergies'])
  })

  it('cue-gates patient concern details to concern questions and accepts their disclosure as a fact', async () => {
    const concernContext: PatientTurnGenerationContext = {
      ...context,
      learnerMessage: 'What worries you most?',
      profile: {
        ...profile,
        history: [{ field: 'patientConcern', status: 'unknown', value: null }]
      }
    }
    const { streamFactory } = createMockResponsesStream({
      id: 'resp-concern', status: 'completed',
      output_parsed: {
        patientResponse: 'I worry the pain might affect my ability to have children.',
        proposedFacts: [{ field: 'patientConcern', value: 'Worries pain could affect future fertility.' }],
        historyCoverage: ['patientConcern'], disclosedHistoryFields: ['patientConcern']
      }
    })
    const client = { responses: { stream: streamFactory } } as unknown as OpenAI

    await generatePatientTurn(client, 'gpt-6-luna', concernContext)
    const request = streamFactory.mock.calls[0]?.[0] as { input?: Array<{ content?: unknown }> }
    const userInput = JSON.parse(String(request?.input?.[1]?.content)) as {
      patientScenario: { relevantHistory: unknown[] }
    }
    expect(userInput.patientScenario.relevantHistory).toEqual([{
      field: 'patientConcern', status: 'unknown', value: null, source: 'expandable_seed_cue'
    }])
    expect(validatePatientTurnOutput({
      patientResponse: 'I worry the pain might affect my ability to have children.',
      proposedFacts: [{ field: 'patientConcern', value: 'Worries pain could affect future fertility.' }],
      historyCoverage: ['patientConcern'], disclosedHistoryFields: ['patientConcern']
    }, concernContext, 'turn-concern', 1, acceptedAt).patientReportedFacts).toMatchObject([{
      field: 'patientConcern', source: 'patient_reported'
    }])

    const { streamFactory: greetingStream } = createMockResponsesStream({
      id: 'resp-greeting', status: 'completed',
      output_parsed: {
        patientResponse: 'Hello.', proposedFacts: [], historyCoverage: [], disclosedHistoryFields: []
      }
    })
    await generatePatientTurn({ responses: { stream: greetingStream } } as unknown as OpenAI,
      'gpt-6-luna', { ...concernContext, learnerMessage: 'Hello.' })
    const greetingRequest = greetingStream.mock.calls[0]?.[0] as { input?: Array<{ content?: unknown }> }
    const greetingInput = JSON.parse(String(greetingRequest.input?.[1]?.content)) as {
      patientScenario: { relevantHistory: unknown[] }
    }
    expect(greetingInput.patientScenario.relevantHistory).toEqual([])
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
      section: 'Symptoms and menstrual history',
      source: 'patient_reported' as const, turnId: 'turn-1', turnSequence: 1, recordedAt: acceptedAt
    }
    const withPrior: PatientTurnGenerationContext = {
      ...context,
      acceptedTurns: [{
        turnId: 'turn-1', sessionId: 's'.repeat(43), sequence: 1, acceptedAt, phase: 'history',
      learnerMessage: 'Do you have pain?', patientResponse: 'Yes, mostly on my left side.',
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
      ['numberPregnancies', 7], ['numberPriorPregnanciesReaching20Weeks', 5], ['numberStillbirths', 1], ['numberMiscarriage', 2],
      ['numberAbortions', 0], ['numberEctopicPregnancies', 0],
      ['numberPregnanciesWithLiveBirth', 4], ['numberLiveBirths', 5],
      ['numberChildren', 4]
    ] as const
    const obstetricContext: PatientTurnGenerationContext = {
      ...context,
      learnerMessage: 'How many pregnancies have you had, how many previous pregnancies reached 20 weeks, miscarriages, stillbirths, abortions, ectopic pregnancies, pregnancies with a live birth, babies born alive, and children?',
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
      patientResponse: 'I have been pregnant seven times. Five made it to 20 weeks, five babies were born alive, and I have four children now.',
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

    expect(() => validatePatientTurnOutput({
      patientResponse: 'I have been pregnant seven times, and all seven reached 20 weeks.',
      proposedFacts: proposedFacts.map((fact) => fact.field === 'numberPriorPregnanciesReaching20Weeks'
        ? { ...fact, value: 8 }
        : fact),
      historyCoverage, disclosedHistoryFields
    }, obstetricContext, 'turn-ob-invalid-parity', 1, acceptedAt)).toThrow('do not match the completed pregnancy count')
  })

  it('rejects ISO last-menstrual-period dates outside the birth-to-encounter chronology', () => {
    const lmpContext: PatientTurnGenerationContext = {
      ...context,
      learnerMessage: 'When was your LMP?',
      profile: {
        ...profile,
        history: [{ field: 'lastMenstrualPeriod', status: 'unknown', value: null }]
      }
    }
    const makeOutput = (value: string) => ({
      patientResponse: `My last period started ${value}.`,
      proposedFacts: [{ field: 'lastMenstrualPeriod' as const, value }],
      historyCoverage: ['lastMenstrualPeriod' as const],
      disclosedHistoryFields: ['lastMenstrualPeriod' as const]
    })

    expect(() => validatePatientTurnOutput(
      makeOutput('2026-10-04'), lmpContext, 'turn-lmp-future', 1, acceptedAt
    )).toThrow('Last menstrual period date must fall between')
    expect(() => validatePatientTurnOutput(
      makeOutput('1989-12-31'), lmpContext, 'turn-lmp-before-birth', 1, acceptedAt
    )).toThrow('Last menstrual period date must fall between')
    expect(validatePatientTurnOutput(
      makeOutput('2026-10-01'), lmpContext, 'turn-lmp-valid', 1, acceptedAt
    ).patientReportedFacts).toHaveLength(1)
  })

  it('excludes the active pregnancy from completed obstetric outcomes', () => {
    const fields = [
      ['numberPregnancies', 3], ['numberPriorPregnanciesReaching20Weeks', 1], ['numberStillbirths', 0], ['numberMiscarriage', 1],
      ['numberAbortions', 0], ['numberEctopicPregnancies', 0],
      ['numberPregnanciesWithLiveBirth', 1], ['numberLiveBirths', 2], ['numberChildren', 2]
    ] as const
    const obstetricContext: PatientTurnGenerationContext = {
      ...context,
      learnerMessage: 'How many pregnancies have you had, how many previous pregnancies reached 20 weeks, miscarriages, stillbirths, abortions, ectopic pregnancies, pregnancies with a live birth, babies born alive, and children?',
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
      patientResponse: 'I am pregnant now. One earlier pregnancy reached 20 weeks and had twins born alive; another ended in miscarriage.',
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
