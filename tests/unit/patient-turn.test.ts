import type OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'
import {
  generatePatientTurn,
  matchHistoryCueFields,
  matchPainCueFields,
  PatientTurnModelOutputSchema,
  validatePatientTurnOutput,
  type PatientTurnGenerationContext
} from '../../services/api/src/patient-turn.ts'
import { PAIN_EPISODE_FIELDS, PatientScenarioProfileSchema, type PatientScenarioProfile } from '../../services/api/src/patient-profile.ts'
import { createMockResponsesStream } from './helpers/openai-response-stream.ts'
import { TEST_PATIENT_PHYSICAL_EXAM_FINDINGS, TEST_PATIENT_VITAL_SIGNS } from '../fixtures/patient-vital-signs.ts'
import { makePainEpisode } from '../fixtures/pain-episodes.ts'

const profile: PatientScenarioProfile = {
  fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average',
  reasonForVisit: 'Pelvic pain', diagnosis: 'Endometriosis',
  painHistoryStatus: 'present',
  painEpisodes: [makePainEpisode('pain-1', 'this pelvic pain')],
  history: [
    { field: 'currentMedications', status: 'known', value: ['Ibuprofen'] }
  ],
  vitalSigns: TEST_PATIENT_VITAL_SIGNS,
  physicalExamFindings: TEST_PATIENT_PHYSICAL_EXAM_FINDINGS,
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
    promptVersion: 'patient-turn-prompt-v10', modelVersion: 'gpt-6-luna',
    schemaVersion: 4, policyVersion: 'patient-turn-policy-v10', rubricVersion: null
  },
  acceptedTurns: [], phase: 'history', learnerMessage: 'Do you have pain?'
}
const acceptedAt = '2026-10-03T03:04:05.000Z'

describe('patient turn generation and validation', () => {
  it('omits diagnosis from the turn projection and uses the session Conversation', async () => {
    const { streamFactory, inputTokenCount } = createMockResponsesStream({
      id: 'resp-turn', status: 'completed',
      usage: {
        input_tokens: 42, input_tokens_details: { cached_tokens: 12 },
        output_tokens: 9, total_tokens: 51
      },
      output_parsed: {
        patientResponse: 'In my lower abdomen.', proposedFacts: [], historyCoverage: [], disclosedHistoryFields: []
      }
    })
    const client = { responses: { inputTokens: { count: inputTokenCount }, stream: streamFactory } } as unknown as OpenAI
    const timings: Array<{ stage: string; elapsedMs: number }> = []
    const reservation = { settle: vi.fn().mockResolvedValue(undefined), hold: vi.fn().mockResolvedValue(undefined) }
    const reserveProviderTokens = vi.fn().mockResolvedValue(reservation)

    const result = await generatePatientTurn(client, 'gpt-6-luna', context,
      (stage, elapsedMs) => timings.push({ stage, elapsedMs }),
      reserveProviderTokens)

    expect(result).toEqual({
      responseId: 'resp-turn',
      provider: 'openai',
      providerUsage: {
        provider: 'openai', responseId: 'resp-turn', model: 'gpt-6-luna', serviceTier: 'default',
        inputTokens: 42, cachedInputTokens: 12, cacheWriteTokens: 0,
        outputTokens: 9, totalTokens: 51, durationMs: expect.any(Number),
        pricingVersion: 'openai-api-pricing-2026-10-06', estimatedCostUsd: '0.000007620000'
      },
      output: {
        patientResponse: 'In my lower abdomen.', proposedFacts: [], historyCoverage: [], disclosedHistoryFields: []
      }
    })
    const request = streamFactory.mock.calls[0]?.[0] as {
      conversation?: string; input?: Array<{ content?: unknown }>; text?: unknown; max_output_tokens?: number
    }
    expect(inputTokenCount).toHaveBeenCalledWith(expect.objectContaining({
      model: 'gpt-6-luna', conversation: 'conv_private', input: request.input, text: request.text
    }))
    expect(request.max_output_tokens).toBe(1_024)
    expect(streamFactory.mock.calls[0]?.[1]).toEqual({ maxRetries: 0 })
    expect(reserveProviderTokens).toHaveBeenCalledWith(100, 1_024)
    expect(reservation.settle).toHaveBeenCalledWith('resp-turn', 51)
    expect(reservation.hold).not.toHaveBeenCalled()
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
    expect(request?.input?.[0]?.content).toContain('An earlier catchall answer does not close the field')
    expect(request?.input?.[0]?.content).toContain('Conversation repair is mutual and follows a volley')
    expect(request?.input?.[0]?.content).toContain('one repair step at a time in this order')
    expect(request?.input?.[0]?.content).toContain('up to three or four times')
    expect(request?.input?.[0]?.content).toContain('advance only when the current step has not resolved understanding')
    expect(request?.input?.[0]?.content).toContain('Preserve the original English wording; do not translate it')
    const userInput = JSON.parse(String(request?.input?.[1]?.content)) as Record<string, unknown>
    expect(userInput.patientScenario).not.toHaveProperty('diagnosis')
    expect(userInput.patientScenario).not.toHaveProperty('bodyType')
    expect(userInput.patientScenario).not.toHaveProperty('vitalSigns')
    expect(userInput.patientScenario).not.toHaveProperty('physicalExamFindings')
    expect(userInput.patientScenario).not.toHaveProperty('supportedExamFindings')
    expect(userInput.patientScenario).toMatchObject({
      painHistoryStatus: 'present',
      relevantHistory: [],
      relevantPainEpisodes: [{ painEpisodeId: 'pain-1', patientDescription: 'this pelvic pain' }]
    })
    expect(userInput.patientScenario).not.toHaveProperty('supportedTestResults')
    expect(userInput).toMatchObject({
      matchedPainFieldResponseGuidance: {
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

  it('rejects model-created exam actions, findings, and test results', () => {
    const validOutput = {
      patientResponse: 'I understand.',
      proposedFacts: [],
      historyCoverage: [],
      disclosedHistoryFields: []
    }

    expect(PatientTurnModelOutputSchema.safeParse({
      ...validOutput,
      clinicalActions: [{
        kind: 'exam', status: 'completed', examName: 'lung auscultation', finding: 'clear',
        actionId: 'action-1', sessionId: 's'.repeat(43), turnId: 'turn-0001',
        occurredAt: '2026-10-10T12:00:00.000Z', chaperone: 'not_required'
      }]
    }).success).toBe(false)
    expect(PatientTurnModelOutputSchema.safeParse({
      ...validOutput,
      supportedExamFindings: ['lungs clear']
    }).success).toBe(false)
    expect(PatientTurnModelOutputSchema.safeParse({
      ...validOutput,
      supportedTestResults: [{ testName: 'ultrasound', result: 'normal' }]
    }).success).toBe(false)
  })

  it('does not send profile history when the learner message matches no history cue', async () => {
    const { streamFactory, inputTokenCount } = createMockResponsesStream({
      id: 'resp-turn', status: 'completed',
      output_parsed: {
        patientResponse: 'Good morning.', proposedFacts: [], historyCoverage: [], disclosedHistoryFields: []
      }
    })
    const client = { responses: { inputTokens: { count: inputTokenCount }, stream: streamFactory } } as unknown as OpenAI

    await generatePatientTurn(client, 'gpt-6-luna', { ...context, learnerMessage: 'Good morning.' })

    const request = streamFactory.mock.calls[0]?.[0] as { input?: Array<{ content?: unknown }> }
    const userInput = JSON.parse(String(request?.input?.[1]?.content)) as {
      patientScenario: { relevantHistory: unknown[] }
    }
    expect(userInput.patientScenario.relevantHistory).toEqual([])
  })

  it('routes onset and associated-negative questions to their own hidden fields', () => {
    expect(matchPainCueFields('When did the pain begin?')).toEqual(['timePainOnset'])
    expect(matchPainCueFields('Do you have pain?')).toEqual(['anyPain'])
    expect(matchHistoryCueFields('When did the pain begin?')).toEqual([])
    expect(matchHistoryCueFields('How many pregnancies?')).toEqual(['numberPregnancies'])
    expect(matchHistoryCueFields('How many previous pregnancies reached 20 weeks?'))
      .toEqual(['numberPriorPregnanciesReaching20Weeks'])
    expect(matchHistoryCueFields('What is your parity?'))
      .toEqual(['numberPriorPregnanciesReaching20Weeks'])
    expect(matchHistoryCueFields('How many children do you have?')).toEqual(['numberChildren'])
    expect(matchHistoryCueFields('Do you have any other associated symptoms, such as fever or nausea?'))
      .toEqual(['miscellaneousDetailsNos'])
    expect(matchHistoryCueFields('Have you had abdominal bloating, pelvic pressure, or felt full quickly?'))
      .toEqual(['miscellaneousDetailsNos'])
    expect(matchHistoryCueFields('Have you noticed that you urinate more often or have constipation?'))
      .toEqual(['miscellaneousDetailsNos'])
    expect(matchHistoryCueFields('Does the pain come and go?')).toEqual([])
    expect(matchPainCueFields('Does the pain come and go?')).toEqual(['constantIntermittentPain'])
  })

  it.each([
    ['How would you describe the pain?', 'painQuality', 'Do not replace their description with a disease label'],
    ['Where is the pain, and does it travel anywhere?', 'painLocationRadiationWhere', 'Do not infer an organ or source from location alone'],
    ['Do you have period cramps?', 'dysmenorrheaHistory', 'Do not label primary or secondary dysmenorrhea from the symptom alone']
  ])('sends only PP guidance for the matched, scenario-supported %s field', async (learnerMessage, field, fidelityRule) => {
    const { streamFactory, inputTokenCount } = createMockResponsesStream({
      id: 'resp-turn', status: 'completed',
      output_parsed: {
        patientResponse: 'It feels like cramps.', proposedFacts: [], historyCoverage: [], disclosedHistoryFields: []
      }
    })
    const client = { responses: { inputTokens: { count: inputTokenCount }, stream: streamFactory } } as unknown as OpenAI

    const isPainEpisodeField = PAIN_EPISODE_FIELDS.includes(field as (typeof PAIN_EPISODE_FIELDS)[number])
    const fieldContext: PatientTurnGenerationContext = {
      ...context,
      learnerMessage,
      profile: {
        ...profile,
        painHistoryStatus: isPainEpisodeField ? 'present' : 'absent',
        painEpisodes: isPainEpisodeField
          ? [makePainEpisode('pain-1', 'this pain', { [field]: { status: 'unknown', value: null } })]
          : [],
        history: isPainEpisodeField ? [] : [{ field, status: 'unknown', value: null }]
      }
    }
    await generatePatientTurn(client, 'gpt-6-luna', fieldContext)

    const request = streamFactory.mock.calls[0]?.[0] as { input?: Array<{ content?: unknown }> }
    const userInput = JSON.parse(String(request?.input?.[1]?.content)) as {
      matchedFieldResponseGuidance: Record<string, { commonPatientWording: string; clinicianAssistedGuidance: string }>
      matchedPainFieldResponseGuidance: Record<string, { commonPatientWording: string; clinicianAssistedGuidance: string }>
    }
    const guidance = isPainEpisodeField
      ? userInput.matchedPainFieldResponseGuidance
      : userInput.matchedFieldResponseGuidance
    expect(Object.keys(guidance)).toEqual([field])
    expect(guidance[field]?.commonPatientWording).toContain('“')
    expect(guidance[field]?.clinicianAssistedGuidance).toContain(fidelityRule)
  })

  it('omits matched PP guidance when the case has no corresponding history field', async () => {
    const { streamFactory, inputTokenCount } = createMockResponsesStream({
      id: 'resp-turn', status: 'completed',
      output_parsed: {
        patientResponse: 'I’m not sure.', proposedFacts: [], historyCoverage: [], disclosedHistoryFields: []
      }
    })
    const client = { responses: { inputTokens: { count: inputTokenCount }, stream: streamFactory } } as unknown as OpenAI

    await generatePatientTurn(client, 'gpt-6-luna', {
      ...context,
      learnerMessage: 'How would you describe the pain?',
      profile: { ...profile, painHistoryStatus: 'absent', painEpisodes: [] }
    })

    const request = streamFactory.mock.calls[0]?.[0] as { input?: Array<{ content?: unknown }> }
    const userInput = JSON.parse(String(request?.input?.[1]?.content)) as {
      matchedPainFieldResponseGuidance: Record<string, unknown>
    }
    expect(userInput.matchedPainFieldResponseGuidance).toEqual({})
  })

  it('permits an approximate onset estimate only as an asked, generated patient report', async () => {
    const onsetContext: PatientTurnGenerationContext = {
      ...context,
      learnerMessage: 'When did the pain begin?',
      profile: {
        ...profile,
        painEpisodes: [makePainEpisode('pain-1', 'this pain', {
          timePainOnset: { status: 'unknown', value: null }
        })]
      }
    }
    const { streamFactory, inputTokenCount } = createMockResponsesStream({
      id: 'resp-onset', status: 'completed',
      output_parsed: {
        patientResponse: 'It started about a week ago.',
        proposedFacts: [],
        proposedPainFacts: [{ painEpisodeId: 'pain-1', field: 'timePainOnset', value: 'About a week ago' }],
        painHistoryCoverage: [{ painEpisodeId: 'pain-1', field: 'timePainOnset' }],
        painDisclosures: [{ painEpisodeId: 'pain-1', field: 'timePainOnset' }],
        historyCoverage: [], disclosedHistoryFields: []
      }
    })
    const client = { responses: { inputTokens: { count: inputTokenCount }, stream: streamFactory } } as unknown as OpenAI

    await generatePatientTurn(client, 'gpt-6-luna', onsetContext)

    const request = streamFactory.mock.calls[0]?.[0] as { input?: Array<{ content?: unknown }> }
    expect(request?.input?.[0]?.content)
      .toContain('brief, approximate, plausible patient-reported timeframe')
    expect(request?.input?.[0]?.content)
      .toContain('never back-calculate an exact date from the encounter date or infer onset from cycle pattern')
    const userInput = JSON.parse(String(request?.input?.[1]?.content)) as {
      matchedHistoryTopics: string[]
      matchedFieldResponseGuidance: Record<string, { clinicianAssistedGuidance: string }>
      matchedPainTopics: string[]
      matchedPainFieldResponseGuidance: Record<string, { clinicianAssistedGuidance: string }>
    }
    expect(userInput.matchedHistoryTopics).toEqual([])
    expect(userInput.matchedPainTopics).toEqual(['timePainOnset'])
    expect(userInput.matchedPainFieldResponseGuidance.timePainOnset?.clinicianAssistedGuidance)
      .toContain('may give a brief approximate estimate only when asked')

    const accepted = validatePatientTurnOutput({
      patientResponse: 'It started about a week ago.',
      proposedFacts: [],
      proposedPainFacts: [{ painEpisodeId: 'pain-1', field: 'timePainOnset', value: 'About a week ago' }],
      painHistoryCoverage: [{ painEpisodeId: 'pain-1', field: 'timePainOnset' }],
      painDisclosures: [{ painEpisodeId: 'pain-1', field: 'timePainOnset' }],
      historyCoverage: [], disclosedHistoryFields: []
    }, onsetContext, 'turn-onset', 1, acceptedAt)
    expect(accepted.patientReportedPainFacts).toMatchObject([{
      painEpisodeId: 'pain-1', field: 'timePainOnset',
      value: 'About a week ago',
      source: 'patient_reported',
      turnId: 'turn-onset'
    }])
  })

  it('appends newly asked catchall details across turns without changing earlier disclosures', async () => {
    const catchallContext: PatientTurnGenerationContext = {
      ...context,
      learnerMessage: 'Have you felt bloated or full quickly?',
      profile: {
        ...profile,
        history: [{ field: 'miscellaneousDetailsNos', status: 'unknown', value: null }]
      }
    }
    const accepted = validatePatientTurnOutput({
      patientResponse: 'I have felt bloated after meals, but I do not get full unusually quickly.',
      proposedFacts: [{ field: 'miscellaneousDetailsNos', value: ['Bloating after meals', 'No early fullness'] }],
      historyCoverage: ['miscellaneousDetailsNos'],
      disclosedHistoryFields: ['miscellaneousDetailsNos']
    }, catchallContext, 'turn-other-symptoms', 1, acceptedAt)

    expect(accepted.patientReportedFacts).toHaveLength(1)
    expect(accepted.patientReportedFacts[0]).toMatchObject({
      field: 'miscellaneousDetailsNos',
      section: 'Safety, trauma, and other information',
      value: ['Bloating after meals', 'No early fullness']
    })

    const firstFact = accepted.patientReportedFacts[0]!
    const priorTurn = {
      turnId: 'turn-other-symptoms', sessionId: 's'.repeat(43), sequence: 1, acceptedAt,
      phase: 'history' as const, learnerModality: 'typed' as const, versions: context.versions,
      learnerMessage: catchallContext.learnerMessage,
      patientResponse: 'I have felt bloated after meals, but I do not get full unusually quickly.',
      patientReportedFacts: [firstFact], patientReportedPainFacts: [],
      historyCoverage: ['miscellaneousDetailsNos' as const],
      disclosedHistoryFields: ['miscellaneousDetailsNos' as const],
      disclosedFactIds: accepted.disclosedFactIds,
      painHistoryCoverage: [], painDisclosures: [],
      historyCoverageState: accepted.historyCoverageState, clinicalActions: []
    }

    const expansionContext: PatientTurnGenerationContext = {
      ...catchallContext,
      learnerMessage: 'Have you felt nauseated too?',
      acceptedTurns: [priorTurn]
    }
    const expandedDetails = ['Bloating after meals', 'No early fullness', 'Nausea after meals']
    const { streamFactory, inputTokenCount } = createMockResponsesStream({
      id: 'resp-catchall-expansion', status: 'completed',
      output_parsed: {
        patientResponse: 'I have felt nauseated after meals too.',
        proposedFacts: [{ field: 'miscellaneousDetailsNos', value: expandedDetails }],
        historyCoverage: ['miscellaneousDetailsNos'],
        disclosedHistoryFields: ['miscellaneousDetailsNos']
      }
    })
    const client = { responses: { inputTokens: { count: inputTokenCount }, stream: streamFactory } } as unknown as OpenAI
    await generatePatientTurn(client, 'gpt-6-luna', expansionContext)
    const request = streamFactory.mock.calls[0]?.[0] as { input?: Array<{ content?: unknown }> }
    const input = JSON.parse(String(request?.input?.[1]?.content)) as {
      patientScenario: { relevantHistory: Array<{ field: string; value: unknown }> }
    }
    expect(input.patientScenario.relevantHistory).toEqual([{
      field: 'miscellaneousDetailsNos', value: ['Bloating after meals', 'No early fullness'],
      status: 'known', source: 'patient_reported'
    }])

    const expanded = validatePatientTurnOutput({
      patientResponse: 'I have felt nauseated after meals too.',
      proposedFacts: [{ field: 'miscellaneousDetailsNos', value: expandedDetails }],
      historyCoverage: ['miscellaneousDetailsNos'],
      disclosedHistoryFields: ['miscellaneousDetailsNos']
    }, expansionContext, 'turn-other-nausea', 2, '2026-10-03T03:05:05.000Z')
    const expandedFact = expanded.patientReportedFacts[0]!
    expect(expandedFact).toMatchObject({ field: 'miscellaneousDetailsNos', value: expandedDetails })
    expect(expanded.disclosedFactIds).toEqual([expandedFact.factId])

    expect(() => validatePatientTurnOutput({
      patientResponse: 'I only remember nausea now.',
      proposedFacts: [{ field: 'miscellaneousDetailsNos', value: ['Nausea after meals'] }],
      historyCoverage: ['miscellaneousDetailsNos'],
      disclosedHistoryFields: ['miscellaneousDetailsNos']
    }, expansionContext, 'turn-other-rewrite', 2, '2026-10-03T03:05:06.000Z'))
      .toThrow('Patient turn conflicts with an already accepted patient fact')

    const expandedTurn = {
      ...priorTurn,
      turnId: 'turn-other-nausea',
      sequence: 2,
      acceptedAt: '2026-10-03T03:05:05.000Z',
      learnerMessage: expansionContext.learnerMessage,
      patientResponse: 'I have felt nauseated after meals too.',
      patientReportedFacts: [expandedFact],
      disclosedFactIds: expanded.disclosedFactIds,
      historyCoverageState: expanded.historyCoverageState
    }
    const repeated = validatePatientTurnOutput({
      patientResponse: 'Yes, I still feel bloated after meals.',
      proposedFacts: [],
      historyCoverage: ['miscellaneousDetailsNos'],
      disclosedHistoryFields: ['miscellaneousDetailsNos']
    }, {
      ...catchallContext,
      learnerMessage: 'Have you still felt bloated after meals?',
      acceptedTurns: [priorTurn, expandedTurn]
    }, 'turn-repeat-other-symptoms', 3, '2026-10-03T03:06:05.000Z')

    expect(repeated.patientReportedFacts).toEqual([])
    expect(repeated.disclosedFactIds).toEqual(expanded.disclosedFactIds)
  })

  it('accepts a new fact only for a scenario history field explicitly marked unknown', () => {
    const painContext = {
      ...context,
      learnerMessage: 'Where does it hurt?',
      profile: {
        ...profile,
        painEpisodes: [makePainEpisode('pain-1', 'this pelvic pain', {
          painLocationRadiationWhere: { status: 'unknown', value: null }
        })]
      }
    }
    const accepted = validatePatientTurnOutput({
      patientResponse: 'It is mostly on my left side.',
      proposedFacts: [],
      proposedPainFacts: [{ painEpisodeId: 'pain-1', field: 'painLocationRadiationWhere', value: 'Mostly on the left side' }],
      historyCoverage: [], disclosedHistoryFields: [],
      painHistoryCoverage: [{ painEpisodeId: 'pain-1', field: 'painLocationRadiationWhere' }],
      painDisclosures: [{ painEpisodeId: 'pain-1', field: 'painLocationRadiationWhere' }]
    }, painContext, 'turn-1', 1, acceptedAt)

    expect(accepted.patientReportedPainFacts).toHaveLength(1)
    expect(accepted.patientReportedPainFacts[0]).toMatchObject({
      painEpisodeId: 'pain-1', field: 'painLocationRadiationWhere', section: 'Symptoms and menstrual history',
      value: 'Mostly on the left side', source: 'patient_reported',
      turnId: 'turn-1', turnSequence: 1, recordedAt: acceptedAt
    })
    expect(accepted.painDisclosures).toMatchObject([{ painEpisodeId: 'pain-1', field: 'painLocationRadiationWhere' }])
  })

  it('keeps two pain episodes independent and rejects a third episode', () => {
    const twoEpisodeProfile = {
      ...profile,
      painEpisodes: [
        makePainEpisode('pain-1', 'my usual period cramps', {
          painLocationRadiationWhere: { status: 'known', value: 'low across my pelvis' }
        }),
        makePainEpisode('pain-2', 'this new abdominal pain', {
          painLocationRadiationWhere: { status: 'known', value: 'on the lower right side' }
        })
      ]
    }
    const twoEpisodeContext = { ...context, learnerMessage: 'Where is the pain?', profile: twoEpisodeProfile }
    const accepted = validatePatientTurnOutput({
      patientResponse: 'My usual cramps are low across my pelvis, while this new pain is on the lower right side.',
      proposedFacts: [], historyCoverage: [], disclosedHistoryFields: [],
      painHistoryCoverage: [
        { painEpisodeId: 'pain-1', field: 'painLocationRadiationWhere' },
        { painEpisodeId: 'pain-2', field: 'painLocationRadiationWhere' }
      ],
      painDisclosures: [
        { painEpisodeId: 'pain-1', field: 'painLocationRadiationWhere' },
        { painEpisodeId: 'pain-2', field: 'painLocationRadiationWhere' }
      ]
    }, twoEpisodeContext, 'turn-two-pains', 1, acceptedAt)

    expect(accepted.painHistoryCoverage).toHaveLength(2)
    expect(accepted.painDisclosures.map((fact) => fact.factId)).toEqual([
      'seed:scenario-1:pain-1:painLocationRadiationWhere',
      'seed:scenario-1:pain-2:painLocationRadiationWhere'
    ])
    expect(PatientScenarioProfileSchema.safeParse({
      ...twoEpisodeProfile,
      painEpisodes: [...twoEpisodeProfile.painEpisodes, makePainEpisode('pain-1', 'third pain')]
    }).success).toBe(false)
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
    const { streamFactory, inputTokenCount } = createMockResponsesStream({
      id: 'resp-concern', status: 'completed',
      output_parsed: {
        patientResponse: 'I worry the pain might affect my ability to have children.',
        proposedFacts: [{ field: 'patientConcern', value: 'Worries pain could affect future fertility.' }],
        historyCoverage: ['patientConcern'], disclosedHistoryFields: ['patientConcern']
      }
    })
    const client = { responses: { inputTokens: { count: inputTokenCount }, stream: streamFactory } } as unknown as OpenAI

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

    const { streamFactory: greetingStream, inputTokenCount: greetingInputTokenCount } = createMockResponsesStream({
      id: 'resp-greeting', status: 'completed',
      output_parsed: {
        patientResponse: 'Hello.', proposedFacts: [], historyCoverage: [], disclosedHistoryFields: []
      }
    })
    await generatePatientTurn({ responses: { inputTokens: { count: greetingInputTokenCount }, stream: greetingStream } } as unknown as OpenAI,
      'gpt-6-luna', { ...concernContext, learnerMessage: 'Hello.' })
    const greetingRequest = greetingStream.mock.calls[0]?.[0] as { input?: Array<{ content?: unknown }> }
    const greetingInput = JSON.parse(String(greetingRequest.input?.[1]?.content)) as {
      patientScenario: { relevantHistory: unknown[] }
    }
    expect(greetingInput.patientScenario.relevantHistory).toEqual([])
  })

  it('rejects a proposed fact when it is absent from the scenario or the scenario already knows it', () => {
    const missingHistoryContext = { ...context, learnerMessage: 'Tell me about your medical history.' }
    expect(() => validatePatientTurnOutput({
      patientResponse: 'I have a fever.', proposedFacts: [{ field: 'medicalHistory', value: 'Fever' }],
      historyCoverage: ['medicalHistory'], disclosedHistoryFields: []
    }, missingHistoryContext, 'turn-1', 1, acceptedAt)).toThrow('outside an unknown scenario history field')

    const medicationContext = { ...context, learnerMessage: 'What medications do you take?' }
    expect(() => validatePatientTurnOutput({
      patientResponse: 'I take ibuprofen.', proposedFacts: [{ field: 'currentMedications', value: ['Ibuprofen'] }],
      historyCoverage: ['currentMedications'], disclosedHistoryFields: ['currentMedications']
    }, medicationContext, 'turn-1', 1, acceptedAt)).toThrow('outside an unknown scenario history field')
  })

  it('keeps previously accepted facts stable and omits an identical repeat', () => {
    const priorFact = {
      factId: 'fact-1', painEpisodeId: 'pain-1' as const,
      field: 'painLocationRadiationWhere' as const, value: 'Mostly on the left side',
      section: 'Symptoms and menstrual history',
      source: 'patient_reported' as const, turnId: 'turn-1', turnSequence: 1, recordedAt: acceptedAt
    }
    const withPrior: PatientTurnGenerationContext = {
      ...context,
      learnerMessage: 'Where does it hurt?',
      acceptedTurns: [{
        turnId: 'turn-1', sessionId: 's'.repeat(43), sequence: 1, acceptedAt, phase: 'history',
      learnerMessage: 'Where does it hurt?', patientResponse: 'Yes, mostly on my left side.',
      patientReportedFacts: [], historyCoverage: [], disclosedHistoryFields: [],
      patientReportedPainFacts: [priorFact],
      painHistoryCoverage: [{ painEpisodeId: 'pain-1', field: 'painLocationRadiationWhere' }],
      painDisclosures: [{ painEpisodeId: 'pain-1', field: 'painLocationRadiationWhere', factId: 'fact-1' }],
      disclosedFactIds: [], historyCoverageState: [],
        clinicalActions: []
      }]
    }

    expect(validatePatientTurnOutput({
      patientResponse: 'As I said, the left side.',
      proposedFacts: [],
      proposedPainFacts: [{ painEpisodeId: 'pain-1', field: 'painLocationRadiationWhere', value: 'Mostly on the left side' }],
      historyCoverage: [], disclosedHistoryFields: [],
      painHistoryCoverage: [{ painEpisodeId: 'pain-1', field: 'painLocationRadiationWhere' }],
      painDisclosures: [{ painEpisodeId: 'pain-1', field: 'painLocationRadiationWhere' }]
    }, withPrior, 'turn-2', 2, '2026-10-03T03:05:00.000Z').patientReportedPainFacts).toEqual([])
    expect(() => validatePatientTurnOutput({
      patientResponse: 'Actually, it is on the right.',
      proposedFacts: [],
      proposedPainFacts: [{ painEpisodeId: 'pain-1', field: 'painLocationRadiationWhere', value: 'Mostly on the right side' }],
      historyCoverage: [], disclosedHistoryFields: [],
      painHistoryCoverage: [{ painEpisodeId: 'pain-1', field: 'painLocationRadiationWhere' }],
      painDisclosures: [{ painEpisodeId: 'pain-1', field: 'painLocationRadiationWhere' }]
    }, withPrior, 'turn-2', 2, '2026-10-03T03:05:00.000Z')).toThrow('conflicts with an accepted pain episode fact')
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

  it('checks live-born infant totals even when gravidity is unknown', () => {
    const obstetricContext: PatientTurnGenerationContext = {
      ...context,
      learnerMessage: 'How many pregnancies with a live birth? How many live births?',
      profile: {
        ...profile,
        history: [
          { field: 'numberPregnanciesWithLiveBirth', status: 'unknown', value: null },
          { field: 'numberLiveBirths', status: 'unknown', value: null }
        ]
      }
    }

    expect(() => validatePatientTurnOutput({
      patientResponse: 'Two pregnancies resulted in a live birth, with one baby born alive.',
      proposedFacts: [
        { field: 'numberPregnanciesWithLiveBirth', value: 2 },
        { field: 'numberLiveBirths', value: 1 }
      ],
      historyCoverage: ['numberPregnanciesWithLiveBirth', 'numberLiveBirths'],
      disclosedHistoryFields: ['numberPregnanciesWithLiveBirth', 'numberLiveBirths']
    }, obstetricContext, 'turn-ob-livebirth-without-gravidity', 1, acceptedAt))
      .toThrow('do not match the completed pregnancy count')
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
    expect(() => validatePatientTurnOutput(
      makeOutput('in three weeks'), lmpContext, 'turn-lmp-relative-future', 1, acceptedAt
    )).toThrow('Last menstrual period date must fall between')
    expect(validatePatientTurnOutput(
      makeOutput('2026-10-01'), lmpContext, 'turn-lmp-valid', 1, acceptedAt
    ).patientReportedFacts).toHaveLength(1)
    expect(validatePatientTurnOutput(
      makeOutput('the 13th of last month'), lmpContext, 'turn-lmp-last-month', 1, acceptedAt
    ).patientReportedFacts).toHaveLength(1)
    expect(() => validatePatientTurnOutput(
      makeOutput('June 4'), {
        ...lmpContext,
        profile: { ...lmpContext.profile, dateOfBirth: '2026-06-05' }
      }, 'turn-lmp-yearless-before-birth', 1, acceptedAt
    )).toThrow('Last menstrual period date must fall between')
    expect(validatePatientTurnOutput(
      makeOutput('about three weeks ago'), lmpContext, 'turn-lmp-relative-valid', 1, acceptedAt
    ).patientReportedFacts).toHaveLength(1)
  })

  it('rejects explicit symptom-onset dates outside the birth-to-encounter chronology', () => {
    const onsetContext: PatientTurnGenerationContext = {
      ...context,
      learnerMessage: 'When did the pain begin?',
      profile: {
        ...profile,
        painEpisodes: [makePainEpisode('pain-1', 'this pain', {
          timePainOnset: { status: 'unknown', value: null }
        })]
      }
    }
    const makeOutput = (value: string) => ({
      patientResponse: `It began ${value}.`,
      proposedFacts: [],
      proposedPainFacts: [{ painEpisodeId: 'pain-1' as const, field: 'timePainOnset' as const, value }],
      historyCoverage: [], disclosedHistoryFields: [],
      painHistoryCoverage: [{ painEpisodeId: 'pain-1' as const, field: 'timePainOnset' as const }],
      painDisclosures: [{ painEpisodeId: 'pain-1' as const, field: 'timePainOnset' as const }]
    })

    expect(() => validatePatientTurnOutput(
      makeOutput('2026-10-04'), onsetContext, 'turn-onset-future', 1, acceptedAt
    )).toThrow('Pain onset date must fall between')
    expect(() => validatePatientTurnOutput(
      makeOutput('1989-12-31'), onsetContext, 'turn-onset-before-birth', 1, acceptedAt
    )).toThrow('Pain onset date must fall between')
    expect(() => validatePatientTurnOutput(
      makeOutput('in three weeks'), onsetContext, 'turn-onset-relative-future', 1, acceptedAt
    )).toThrow('Pain onset date must fall between')
    expect(() => validatePatientTurnOutput(
      makeOutput('tomorrow'), onsetContext, 'turn-onset-tomorrow', 1, acceptedAt
    )).toThrow('Pain onset date must fall between')
    expect(validatePatientTurnOutput(
      makeOutput('yesterday'), onsetContext, 'turn-onset-yesterday', 1, acceptedAt
    ).patientReportedPainFacts).toHaveLength(1)
    expect(validatePatientTurnOutput(
      makeOutput('about three weeks ago'), onsetContext, 'turn-onset-relative-valid', 1, acceptedAt
    ).patientReportedPainFacts).toHaveLength(1)
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
