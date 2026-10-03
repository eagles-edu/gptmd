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
  PATIENT_PROFILE_FIELDS,
  PatientScenarioProfileSchema,
  isPatientScenarioConsistent
} from '../../services/api/src/patient-profile'
import {
  ArchiveStatusSchema,
  ClinicalActionSchema,
  ImmutablePatientScenarioSchema,
  PatientReportedFactExpansionSchema,
  SessionStateSchema,
  SessionTurnSchema,
  TerminalEventSchema
} from '../../services/api/src/session-contracts'
import {
  LearnerPatientProfileSchema,
  PatientSetupProjectionSchema,
  toLearnerPatientProfile
} from '../../services/api/src/patient-setup'

const PatientProfileCatalogSchema = z.object({
  patientProfileFields: z.array(z.string().min(1)),
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

describe('shared patient API schemas', () => {
  it('keeps the JSON profile catalog aligned and its five-field projection as a template', async () => {
    const path = resolve(process.cwd(), 'services/api/catalog/patient-profile.json')
    const document = PatientProfileCatalogSchema.parse(
      JSON.parse(await readFile(path, 'utf8')) as unknown
    )

    expect(document.patientProfileFields).toEqual(PATIENT_PROFILE_FIELDS)
    expect(Object.keys(document.setupProfileTemplate)).toEqual(document.setupProfileFields)
    expect(document.setupProfileTemplate).toEqual({
      fullName: '<full name>',
      dateOfBirth: '<YYYY-MM-DD>',
      bodyType: '<average|heavy>',
      reasonForVisit: '<reason for visit/chief complaint>',
      diagnosis: null
    })
    expect(Object.keys(LearnerPatientProfileSchema.shape)).toEqual(Object.keys(PatientProfileSchema.shape))
    expect(Object.keys(PatientSetupProjectionSchema.shape)).toEqual(document.setupProfileFields)
    expect(document.templateNote).toContain('Template only')
  })

  it('accepts a valid profile and rejects invalid dates, body types, and extra fields', () => {
    const profile = {
      fullName: 'Ari Nguyen',
      dateOfBirth: '1990-01-01',
      bodyType: 'average',
      reasonForVisit: 'Pelvic pain'
    }

    expect(PatientProfileSchema.parse(profile)).toEqual(profile)
    expect(PatientProfileSchema.safeParse({ ...profile, dateOfBirth: '1990-02-30' }).success).toBe(false)
    expect(PatientProfileSchema.safeParse({ ...profile, bodyType: 'slim' }).success).toBe(false)
    expect(PatientProfileSchema.safeParse({ ...profile, diagnosis: 'Hidden answer' }).success).toBe(false)
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
      history: [],
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
      schemaVersion: 1,
      createdAt: '2026-10-01T00:00:00Z',
      profileDigest: 'a'.repeat(64),
      profile
    }
    expect(ImmutablePatientScenarioSchema.safeParse(scenario).success).toBe(true)
    expect(ImmutablePatientScenarioSchema.safeParse({ ...scenario, profileDigest: 'bad' }).success).toBe(false)
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
    const currentPregnancyHistory = [
      { field: 'numberPregnancies', status: 'known', value: 3 },
      { field: 'numberMiscarriage', status: 'known', value: 1 },
      { field: 'numberStillbirths', status: 'known', value: 0 },
      { field: 'numberAbortions', status: 'known', value: 0 },
      { field: 'numberEctopicPregnancies', status: 'known', value: 0 },
      { field: 'numberLiveBirths', status: 'known', value: 1 },
      { field: 'numberChildren', status: 'known', value: 1 }
    ] as const
    expect(isPatientScenarioConsistent({
      ...profile, currentPregnancyStatus: 'pregnant', history: [...currentPregnancyHistory]
    }, new Date('2026-10-01T00:00:00Z'))).toBe(true)
    expect(isPatientScenarioConsistent({
      ...profile,
      currentPregnancyStatus: 'pregnant',
      history: currentPregnancyHistory.map((entry) => entry.field === 'numberMiscarriage'
        ? { ...entry, value: 2 }
        : entry)
    }, new Date('2026-10-01T00:00:00Z'))).toBe(false)
    expect(toLearnerPatientProfile(PatientSetupProjectionSchema.parse({
      fullName: 'Ari Nguyen',
      dateOfBirth: '1990-01-01',
      bodyType: 'average',
      reasonForVisit: 'Pelvic pain',
      diagnosis: 'Endometriosis'
    }))).toEqual({
      fullName: 'Ari Nguyen',
      dateOfBirth: '1990-01-01',
      bodyType: 'average',
      reasonForVisit: 'Pelvic pain'
    })

    const expansion = {
      factId: 'fact-1',
      field: 'medicalHistory',
      value: 'No significant medical history',
      source: 'patient_reported',
      turnId: 'turn-1',
      turnSequence: 1,
      recordedAt: '2026-10-01T00:01:00Z'
    }
    expect(PatientReportedFactExpansionSchema.safeParse(expansion).success).toBe(true)
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
      openedAt: '2026-10-01T00:00:00Z',
      updatedAt: '2026-10-01T00:00:00Z',
      currentTurnSequence: 0,
      terminalEventId: null
    }).success).toBe(true)
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
      acceptedAt: '2026-10-01T00:01:00Z', learnerMessage: 'What brings you in?',
      patientResponse: 'I have pelvic pain.', patientReportedFacts: [], historyCoverage: [],
      disclosedHistoryFields: [], disclosedFactIds: [], clinicalActions: [action]
    }
    expect(SessionTurnSchema.safeParse(turn).success).toBe(true)
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
