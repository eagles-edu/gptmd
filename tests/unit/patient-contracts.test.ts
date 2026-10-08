import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import { z } from 'zod'
import {
  CreateSessionResponseSchema,
  PatientProfileSchema,
  SetupResponseSchema,
  TurnResponseSchema
} from '../../app/schemas/patient-api'
import {
  PATIENT_CHART_FIELDS,
  PATIENT_PHYSICAL_EXAM_FINDING_FIELDS,
  PATIENT_PROFILE_FIELDS,
  PatientPhysicalExamFindingsSchema,
  PatientScenarioProfileSchema,
  isHistoryDatePlausible,
  isPatientScenarioConsistent
} from '../../services/api/src/patient-profile'
import {
  ArchiveStatusSchema,
  ClinicalActionSchema,
  ImmutablePatientScenarioSchema,
  PatientReportedFactExpansionSchema,
  SessionTurnVersionPinsSchema,
  SessionVersionPinsSchema,
  SessionStateSchema,
  SessionTurnSchema,
  TerminalEventSchema
} from '../../services/api/src/session-contracts'
import { makePainEpisode } from '../fixtures/pain-episodes.ts'
import {
  LearnerPatientProfileSchema,
  PatientSetupProjectionSchema,
  toLearnerPatientProfile
} from '../../services/api/src/patient-setup'
import {
  TEST_LEARNER_CHART_VITAL_SIGNS,
  TEST_PATIENT_PHYSICAL_EXAM_FINDINGS,
  TEST_PATIENT_VITAL_SIGNS
} from '../fixtures/patient-vital-signs.ts'

const PatientProfileCatalogSchema = z.object({
  patientProfileFields: z.array(z.string().min(1)),
  painEpisodePolicy: z.object({
    maximumInstances: z.literal(2),
    identityFields: z.array(z.enum(['pain-1', 'pain-2'])).length(2),
    details: z.array(z.string().min(1)).length(7),
    scope: z.string().min(1)
  }).strict(),
  obstetricTerminology: z.object({
    gravidity: z.string().min(1),
    terms: z.object({
      nulligravida: z.string().min(1),
      primigravida: z.string().min(1),
      multigravida: z.string().min(1)
    }).strict(),
    parity: z.string().min(1),
    example: z.string().min(1),
    countSeparation: z.string().min(1),
    thresholdNote: z.string().min(1)
  }).strict(),
  chartFindings: z.object({ fields: z.array(z.string().min(1)) }).passthrough(),
  physicalExamFindings: z.object({ fields: z.array(z.string().min(1)) }).passthrough(),
  setupProfileFields: z.array(z.string().min(1)).length(5),
  setupProfileTemplate: z.object({
    fullName: z.string().min(1),
    dateOfBirth: z.string().min(1),
    bodyType: z.string().min(1),
    reasonForVisit: z.string().min(1),
    diagnosis: z.string().min(1).nullable()
  }).strict(),
  templateNote: z.string().min(1)
}).strict()

const validVitalSigns = TEST_LEARNER_CHART_VITAL_SIGNS

describe('shared patient API schemas', () => {
  it('pins scenario responses and patient turns to their exact schema versions', () => {
    const scenarioPins = {
      promptVersion: 'patient-scenario-prompt-v10',
      modelVersion: 'gpt-6-luna',
      schemaVersion: 7,
      policyVersion: 'patient-scenario-policy-v3'
    }
    const turnPins = {
      promptVersion: 'patient-turn-prompt-v8',
      modelVersion: 'gpt-6-luna',
      schemaVersion: 4,
      policyVersion: 'patient-turn-policy-v8',
      rubricVersion: null
    }

    expect(SessionVersionPinsSchema.safeParse(scenarioPins).success).toBe(true)
    for (const schemaVersion of [1, 2, 3, 4, 5]) {
      expect(SessionVersionPinsSchema.safeParse({ ...scenarioPins, schemaVersion }).success).toBe(false)
    }
    expect(SessionTurnVersionPinsSchema.safeParse(turnPins).success).toBe(true)
    for (const schemaVersion of [1, 2, 3]) {
      expect(SessionTurnVersionPinsSchema.safeParse({ ...turnPins, schemaVersion }).success).toBe(false)
    }
  })

  it('keeps the JSON profile catalog aligned and its five-field projection as a template', async () => {
    const path = resolve(process.cwd(), 'services/api/catalog/patient-profile.json')
    const document = PatientProfileCatalogSchema.parse(
      JSON.parse(await readFile(path, 'utf8')) as unknown
    )

    expect(document.patientProfileFields).toEqual(PATIENT_PROFILE_FIELDS)
    expect(document.painEpisodePolicy.maximumInstances).toBe(2)
    expect(document.painEpisodePolicy.details).toEqual([
      'whatProvokesPalliatesPain', 'painQuality', 'painLocationRadiationWhere', 'painSeverity0-10',
      'timePainOnset', 'constantIntermittentPain', 'durationPain'
    ])
    expect(document.obstetricTerminology.terms).toEqual({
      nulligravida: '0 pregnancies',
      primigravida: '1 pregnancy; first pregnancy',
      multigravida: '2 or more pregnancies, regardless of outcomes'
    })
    expect(document.obstetricTerminology.example).toContain('G3P2')
    expect(document.obstetricTerminology.example).toContain('G4')
    expect(document.chartFindings.fields).toEqual(PATIENT_CHART_FIELDS)
    expect(document.chartFindings.fields).toEqual([
      'currentPulse', 'bpSitting', 'respiratoryRate',
      'axillaryTemp', 'oralTemp', 'analTemp', 'dermalTemp', 'auralTemp'
    ])
    expect(document.chartFindings.examOnlyVitalFindings).toEqual([
      'pulseIrregular', 'pulseQuality', 'bpOrthostaticSupine'
    ])
    expect(document.physicalExamFindings.fields).toEqual(PATIENT_PHYSICAL_EXAM_FINDING_FIELDS)
    expect(document.chartFindings.fields).not.toContain('lungAuscultation')
    expect(document.chartFindings.fields).not.toContain('skinLipsSclera')
    expect(document.chartFindings.fields).not.toContain('skinBlanche')
    expect(Object.keys(document.setupProfileTemplate)).toEqual(document.setupProfileFields)
    expect(document.setupProfileTemplate).toEqual({
      fullName: '<full name>',
      dateOfBirth: '<YYYY-MM-DD>',
      bodyType: '<average|heavy>',
      reasonForVisit: '<reason for visit/chief complaint>',
      diagnosis: null
    })
    expect(Object.keys(LearnerPatientProfileSchema.shape)).toEqual(Object.keys(PatientProfileSchema.shape))
    expect(Object.keys(PatientSetupProjectionSchema.shape)).toEqual([
      ...document.setupProfileFields, 'vitalSigns', 'physicalExamFindings'
    ])
    expect(document.templateNote).toContain('Template only')
  })

  it('accepts a valid profile and rejects invalid dates, body types, and extra fields', () => {
    const profile = {
      fullName: 'Ari Nguyen',
      dateOfBirth: '1990-01-01',
      bodyType: 'average',
      reasonForVisit: 'Pelvic pain',
      vitalSigns: validVitalSigns
    }

    expect(PatientProfileSchema.parse(profile)).toEqual(profile)
    expect(PatientProfileSchema.safeParse({ ...profile, dateOfBirth: '1990-02-30' }).success).toBe(false)
    expect(PatientProfileSchema.safeParse({ ...profile, bodyType: 'slim' }).success).toBe(false)
    expect(PatientProfileSchema.safeParse({ ...profile, diagnosis: 'Hidden answer' }).success).toBe(false)
    expect(PatientProfileSchema.safeParse({
      ...profile,
      physicalExamFindings: TEST_PATIENT_PHYSICAL_EXAM_FINDINGS
    }).success).toBe(false)
  })

  it('enforces capillary-refill seconds, blood pressure, and lung finding consistency', () => {
    const profile = {
      fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average',
      reasonForVisit: 'Pelvic pain', vitalSigns: validVitalSigns
    }

    expect(PatientPhysicalExamFindingsSchema.safeParse({ ...TEST_PATIENT_PHYSICAL_EXAM_FINDINGS, skinBlanche: -0.1 }).success).toBe(false)
    expect(PatientPhysicalExamFindingsSchema.safeParse({ ...TEST_PATIENT_PHYSICAL_EXAM_FINDINGS, skinBlanche: 3.1 }).success).toBe(false)
    expect(PatientProfileSchema.safeParse({ ...profile, vitalSigns: { ...validVitalSigns, oralTemp: null } }).success).toBe(true)
    expect(PatientProfileSchema.safeParse({
      ...profile,
      vitalSigns: { ...validVitalSigns, axillaryTemp: 37, oralTemp: 36.8 }
    }).success).toBe(true)
    expect(PatientProfileSchema.safeParse({ ...profile, vitalSigns: { ...validVitalSigns, axillaryTemp: 37, bpSitting: { systolic: 70, diastolic: 90 } } }).success).toBe(false)
    expect(PatientPhysicalExamFindingsSchema.safeParse({
      ...TEST_PATIENT_PHYSICAL_EXAM_FINDINGS,
      lungAuscultation: { ...TEST_PATIENT_PHYSICAL_EXAM_FINDINGS.lungAuscultation, breathSounds: ['normal', 'wheeze'] }
    }).success).toBe(false)
  })

  it('validates session, setup, and turn response shapes', () => {
    expect(CreateSessionResponseSchema.safeParse({ sessionId: '' }).success).toBe(false)
    expect(SetupResponseSchema.safeParse({ profile: null }).success).toBe(false)
    expect(TurnResponseSchema.safeParse({ turnId: 'turn-1', text: '' }).success).toBe(false)
  })

  it('validates the private scenario snapshot and patient-reported expansions', () => {
    const profile = {
      fullName: 'Ari Nguyen',
      dateOfBirth: '1990-01-01',
      bodyType: 'average',
      reasonForVisit: 'Pelvic pain',
      diagnosis: null,
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
    } as const
    const scenario = {
      scenarioId: 'scenario-1',
      schemaVersion: 7,
      createdAt: '2026-10-01T00:00:00Z',
      profileDigest: 'a'.repeat(64),
      profile
    }
    expect(ImmutablePatientScenarioSchema.safeParse(scenario).success).toBe(true)
    const twoEpisodeProfile = {
      ...profile,
      painHistoryStatus: 'present',
      painEpisodes: [
        makePainEpisode('pain-1', 'usual menstrual cramps'),
        makePainEpisode('pain-2', 'new abdominal pain')
      ]
    }
    expect(PatientScenarioProfileSchema.safeParse(twoEpisodeProfile).success).toBe(true)
    expect(PatientScenarioProfileSchema.safeParse({
      ...twoEpisodeProfile,
      painEpisodes: [...twoEpisodeProfile.painEpisodes, makePainEpisode('pain-1', 'third pain')]
    }).success).toBe(false)
    expect(PatientScenarioProfileSchema.safeParse({
      ...profile,
      history: [{ field: 'painQuality', status: 'known', value: 'cramping' }]
    }).success).toBe(false)
    for (const schemaVersion of [1, 2, 3, 4, 5]) {
      expect(ImmutablePatientScenarioSchema.safeParse({ ...scenario, schemaVersion }).success).toBe(false)
    }
    expect(ImmutablePatientScenarioSchema.safeParse({ ...scenario, profileDigest: 'bad' }).success).toBe(false)
    expect(PatientScenarioProfileSchema.safeParse({
      ...profile,
      history: [{ field: 'allergies', status: 'negative', value: 'No known allergies' }]
    }).success).toBe(true)
    expect(PatientScenarioProfileSchema.safeParse({
      ...profile,
      history: [{ field: 'patientConcern', status: 'known', value: 'I am worried this pain could affect my chance of having children.' }]
    }).success).toBe(true)
    expect(PatientScenarioProfileSchema.safeParse({
      ...profile,
      persona: { ...profile.persona, mood: 'm'.repeat(81) }
    }).success).toBe(false)
    expect(PatientScenarioProfileSchema.safeParse({
      ...profile,
      history: [
        { field: 'numberAbortions', status: 'known', value: 1 },
        { field: 'numberEctopicPregnancies', status: 'known', value: 1 },
        { field: 'perimenopauseSymptoms', status: 'known', value: 'Irregular cycles' },
        { field: 'menopauseStatus', status: 'negative', value: 'not_menopausal' }
      ]
    }).success).toBe(true)
    expect(PatientScenarioProfileSchema.safeParse({
      ...profile,
      history: [{ field: 'menopauseStatus', status: 'known', value: 'Patient reports menopause began two years ago.' }]
    }).success).toBe(true)
    expect(isPatientScenarioConsistent({
      ...profile,
      dateOfBirth: '2010-01-01',
      currentMenopausalStatus: 'menopausal',
      history: [{ field: 'menopauseStatus', status: 'negative', value: 'not_menopausal' }]
    }, new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(isPatientScenarioConsistent({
      ...profile,
      currentPregnancyStatus: 'pregnant',
      currentMenopausalStatus: 'menopausal'
    }, new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(isPatientScenarioConsistent({
      ...profile,
      history: [{ field: 'lastMenstrualPeriod', status: 'known', value: '2026-10-02' }]
    }, new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(isPatientScenarioConsistent({
      ...profile,
      history: [{ field: 'lastMenstrualPeriod', status: 'known', value: '1989-12-31' }]
    }, new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(isPatientScenarioConsistent({
      ...profile,
      history: [{ field: 'lastMenstrualPeriod', status: 'known', value: '2026-09-20' }]
    }, new Date('2026-10-01T00:00:00Z'))).toBe(true)
    const onsetProfile = (value: string) => ({
      ...profile,
      painHistoryStatus: 'present' as const,
      painEpisodes: [makePainEpisode('pain-1', 'this pain', {
        timePainOnset: { status: 'known', value }
      })]
    })
    expect(isPatientScenarioConsistent(onsetProfile('2026-10-02'), new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(isPatientScenarioConsistent(onsetProfile('1989-12-31'), new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(isPatientScenarioConsistent(onsetProfile('about three weeks ago'), new Date('2026-10-01T00:00:00Z'))).toBe(true)
    expect(isHistoryDatePlausible('1990-01-01', 'October 2, 2026', new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(isHistoryDatePlausible('1990-01-01', '20 September 1989', new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(isHistoryDatePlausible('1990-01-01', 'September 31, 2026', new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(isHistoryDatePlausible('1990-01-01', 'about three weeks ago', new Date('2026-10-01T00:00:00Z'))).toBe(true)
    expect(isHistoryDatePlausible('1990-01-01', 'yesterday', new Date('2026-10-01T00:00:00Z'))).toBe(true)
    expect(isHistoryDatePlausible('2026-10-01', 'yesterday', new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(isHistoryDatePlausible('1990-01-01', 'the day before yesterday', new Date('2026-10-01T00:00:00Z'))).toBe(true)
    expect(isHistoryDatePlausible('1990-01-01', 'today', new Date('2026-10-01T00:00:00Z'))).toBe(true)
    expect(isHistoryDatePlausible('1990-01-01', 'tomorrow', new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(isHistoryDatePlausible('1990-01-01', 'the day after tomorrow', new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(isHistoryDatePlausible('1990-01-01', 'last Monday', new Date('2026-10-01T00:00:00Z'))).toBe(true)
    expect(isHistoryDatePlausible('1990-01-01', 'in three weeks', new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(isHistoryDatePlausible('1990-01-01', 'two weeks from now', new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(isHistoryDatePlausible('2026-02-28', 'one month ago', new Date('2026-03-31T00:00:00Z'))).toBe(true)
    expect(isHistoryDatePlausible('2026-03-01', 'one month ago', new Date('2026-03-31T00:00:00Z'))).toBe(false)
    expect(isHistoryDatePlausible('2026-09-20', 'about three weeks ago', new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(isHistoryDatePlausible('1990-01-01', 'several weeks ago', new Date('2026-10-01T00:00:00Z'))).toBe(true)
    expect(isHistoryDatePlausible('1990-01-01', '0 weeks ago', new Date('2026-10-01T00:00:00Z'))).toBe(false)
    const currentPregnancyHistory = [
      { field: 'numberPregnancies', status: 'known', value: 3 },
      { field: 'numberPriorPregnanciesReaching20Weeks', status: 'known', value: 1 },
      { field: 'numberMiscarriage', status: 'known', value: 1 },
      { field: 'numberStillbirths', status: 'known', value: 0 },
      { field: 'numberAbortions', status: 'known', value: 0 },
      { field: 'numberEctopicPregnancies', status: 'known', value: 0 },
      { field: 'numberPregnanciesWithLiveBirth', status: 'known', value: 1 },
      { field: 'numberLiveBirths', status: 'known', value: 2 },
      { field: 'numberChildren', status: 'known', value: 1 }
    ] as const
    expect(isPatientScenarioConsistent({
      ...profile, currentPregnancyStatus: 'pregnant', history: [...currentPregnancyHistory]
    }, new Date('2026-10-01T00:00:00Z'))).toBe(true)
    expect(isPatientScenarioConsistent({
      ...profile,
      currentPregnancyStatus: 'pregnant',
      history: currentPregnancyHistory.map((entry) => entry.field === 'numberPriorPregnanciesReaching20Weeks'
        ? { ...entry, value: 3 }
        : entry)
    }, new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(isPatientScenarioConsistent({
      ...profile,
      currentPregnancyStatus: 'pregnant',
      history: currentPregnancyHistory.map((entry) => entry.field === 'numberMiscarriage'
        ? { ...entry, value: 2 }
        : entry)
    }, new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(isPatientScenarioConsistent({
      ...profile,
      currentPregnancyStatus: 'unknown',
      history: [
        { field: 'numberPregnanciesWithLiveBirth', status: 'known', value: 2 },
        { field: 'numberLiveBirths', status: 'known', value: 1 }
      ]
    }, new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(toLearnerPatientProfile(PatientSetupProjectionSchema.parse({
      fullName: 'Ari Nguyen',
      dateOfBirth: '1990-01-01',
      bodyType: 'average',
      reasonForVisit: 'Pelvic pain',
      diagnosis: 'Endometriosis',
      vitalSigns: TEST_PATIENT_VITAL_SIGNS,
      physicalExamFindings: TEST_PATIENT_PHYSICAL_EXAM_FINDINGS
    }))).toEqual({
      fullName: 'Ari Nguyen',
      dateOfBirth: '1990-01-01',
      bodyType: 'average',
      reasonForVisit: 'Pelvic pain',
      vitalSigns: validVitalSigns
    })
    const learnerProfile = toLearnerPatientProfile(PatientSetupProjectionSchema.parse({
      fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average',
      reasonForVisit: 'Pelvic pain', diagnosis: null, vitalSigns: TEST_PATIENT_VITAL_SIGNS,
      physicalExamFindings: TEST_PATIENT_PHYSICAL_EXAM_FINDINGS
    }))
    expect(learnerProfile.vitalSigns).not.toHaveProperty('lungAuscultation')
    expect(learnerProfile.vitalSigns).not.toHaveProperty('skinLipsSclera')
    expect(learnerProfile.vitalSigns).not.toHaveProperty('skinBlanche')
    expect(learnerProfile.vitalSigns).not.toHaveProperty('pulseIrregular')
    expect(learnerProfile.vitalSigns).not.toHaveProperty('pulseQuality')
    expect(learnerProfile.vitalSigns).not.toHaveProperty('bpOrthostaticSupine')

    const expansion = {
      factId: 'fact-1',
      field: 'medicalHistory',
      section: 'Medical history',
      value: 'No significant medical history',
      source: 'patient_reported',
      turnId: 'turn-1',
      turnSequence: 1,
      recordedAt: '2026-10-01T00:01:00Z'
    }
    expect(PatientReportedFactExpansionSchema.safeParse(expansion).success).toBe(true)
    const { section: _section, ...expansionWithoutSection } = expansion
    expect(PatientReportedFactExpansionSchema.safeParse(expansionWithoutSection).success).toBe(false)
    expect(PatientReportedFactExpansionSchema.safeParse({ ...expansion, source: 'verified' }).success).toBe(false)
    expect(PatientReportedFactExpansionSchema.safeParse({ ...expansion, field: 'unsupported' }).success).toBe(false)
  })

  it('validates session, accepted turn, clinical action, terminal, and archive records', () => {
    const sessionId = 'a'.repeat(43)
    expect(SessionStateSchema.safeParse({
      sessionId,
      scenarioId: null,
      status: 'initializing',
      phase: null,
      interactionMode: 'transcript',
      openedAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
      currentTurnSequence: 0,
      terminalEventId: null
    }).success).toBe(true)
    expect(SessionStateSchema.safeParse({
      sessionId, scenarioId: null, status: 'initializing', phase: null,
      openedAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z',
      currentTurnSequence: 0, terminalEventId: null
    }).success).toBe(false)
    expect(SessionStateSchema.safeParse({
      sessionId, scenarioId: null, status: 'active', phase: 'history',
      openedAt: 'not-a-date', updatedAt: '2026-10-01T00:00:00Z',
      currentTurnSequence: -1, terminalEventId: null
    }).success).toBe(false)

    const action = {
      actionId: 'action-1', sessionId, turnId: 'turn-1',
      occurredAt: '2026-10-01T00:01:00Z', kind: 'order', status: 'requested',
      testName: 'Urine pregnancy test', result: null
    }
    expect(ClinicalActionSchema.safeParse(action).success).toBe(true)
    expect(ClinicalActionSchema.safeParse({ ...action, result: 'positive' }).success).toBe(true)
    expect(ClinicalActionSchema.safeParse({ ...action, extra: true }).success).toBe(false)

    const turn = {
      turnId: 'turn-1', sessionId, sequence: 1,
      acceptedAt: '2026-10-01T00:01:00Z', phase: 'history', learnerModality: 'typed',
      learnerMessage: 'What brings you in?',
      versions: {
        promptVersion: 'patient-turn-prompt-v8', modelVersion: 'gpt-6-luna',
        schemaVersion: 4, policyVersion: 'patient-turn-policy-v8', rubricVersion: null
      },
      patientResponse: 'I have pelvic pain.', patientReportedFacts: [], historyCoverage: [],
      patientReportedPainFacts: [],
      painHistoryCoverage: [],
      painDisclosures: [],
      disclosedHistoryFields: [], disclosedFactIds: [], historyCoverageState: [], clinicalActions: [action]
    }
    expect(SessionTurnSchema.safeParse(turn).success).toBe(true)
    expect(SessionTurnSchema.parse(turn).versions).toEqual(turn.versions)
    expect(SessionTurnSchema.parse({ ...turn, learnerModality: 'realtime_transcription' }).learnerModality)
      .toBe('realtime_transcription')
    const { learnerModality: _modality, ...turnWithoutModality } = turn
    expect(SessionTurnSchema.safeParse(turnWithoutModality).success).toBe(false)
    expect(SessionTurnSchema.safeParse({ ...turn, learnerModality: 'unverified_audio' }).success).toBe(false)
    expect(SessionTurnSchema.safeParse({ ...turn, sequence: 0 }).success).toBe(false)

    const terminal = {
      eventId: 'event-1', sessionId, outcome: 'completed',
      occurredAt: '2026-10-01T01:00:00Z', reason: null, finalTurnSequence: 4
    }
    expect(TerminalEventSchema.safeParse(terminal).success).toBe(true)
    expect(TerminalEventSchema.safeParse({ ...terminal, finalTurnSequence: -1 }).success).toBe(false)

    const archive = {
      archiveId: 'archive-1', sessionId, status: 'available',
      updatedAt: '2026-10-01T01:01:00Z', artifactId: 'artifact-1',
      downloadExpiresAt: '2026-10-04T01:00:00Z', errorCode: null
    }
    expect(ArchiveStatusSchema.safeParse(archive).success).toBe(true)
    expect(ArchiveStatusSchema.safeParse({ ...archive, artifactId: null }).success).toBe(false)
  })

  it('keeps the documented patient profile as a clearly marked template', async () => {
    const path = resolve(process.cwd(), 'docs/gpt-patient-obgyn.json')
    const template = JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>

    expect(template).toMatchObject({
      templateNote: expect.stringContaining('Template only'),
      fullName: '<full name>',
      dateOfBirth: '<YYYY-MM-DD>',
      bodyType: '<average|heavy>',
      reasonForVisit: '<reason for visit/chief complaint>',
      diagnosis: null
    })
    expect(Object.keys(template)).toEqual([
      'templateNote', 'fullName', 'dateOfBirth', 'bodyType', 'reasonForVisit', 'diagnosis'
    ])
    expect(PatientSetupProjectionSchema.safeParse(template).success).toBe(false)
  })

  it('keeps every JSON document under docs syntactically valid', async () => {
    const docsDirectory = resolve(process.cwd(), 'docs')
    const collectJsonFiles = async (directory: string): Promise<string[]> => {
      const entries = await readdir(directory, { withFileTypes: true })
      const nested = await Promise.all(entries.map(async (entry) => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return collectJsonFiles(path)
        return entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.jsonc'))
          ? [path]
          : []
      }))
      return nested.flat()
    }

    const jsonFiles = await collectJsonFiles(docsDirectory)
    expect(jsonFiles.length).toBeGreaterThan(0)
    for (const path of jsonFiles) {
      const contents = await readFile(path, 'utf8')
      if (path.endsWith('.jsonc')) {
        const errors: ParseError[] = []
        parseJsonc(contents, errors, { allowTrailingComma: true })
        expect(errors, path).toEqual([])
      } else {
        expect(() => JSON.parse(contents), path).not.toThrow()
      }
    }
  })
})
