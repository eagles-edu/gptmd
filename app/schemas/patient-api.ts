import { z } from 'zod'

const SessionVersionPinsSchema = z.object({
  promptVersion: z.string().min(1),
  modelVersion: z.string().min(1),
  schemaVersion: z.literal(7),
  policyVersion: z.string().min(1)
}).strict()

export const CreateSessionResponseSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  status: z.literal('initializing'),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  versions: SessionVersionPinsSchema
}).strict()

export const OwnedSessionResponseSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  status: z.enum(['initializing', 'failed', 'ready', 'active', 'completed', 'cancelled']),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  versions: SessionVersionPinsSchema
}).strict()

const ChartBloodPressureSchema = z.object({
  systolic: z.number().int().min(1).max(300),
  diastolic: z.number().int().min(1).max(200)
}).strict().refine((reading) => reading.systolic > reading.diastolic)

const ChartTemperatureSchema = z.number().finite().min(25).max(45).nullable()

export const PatientVitalSignsSchema = z.object({
  currentPulse: z.number().int().min(1).max(300),
  bpSitting: ChartBloodPressureSchema,
  respiratoryRate: z.number().int().min(1).max(100),
  axillaryTemp: ChartTemperatureSchema,
  oralTemp: ChartTemperatureSchema,
  analTemp: ChartTemperatureSchema,
  dermalTemp: ChartTemperatureSchema,
  auralTemp: ChartTemperatureSchema
}).strict()

export const PatientProfileSchema = z.object({
  fullName: z.string().min(1),
  dateOfBirth: z.iso.date(),
  bodyType: z.enum(['average', 'heavy']),
  reasonForVisit: z.string().min(1),
  vitalSigns: PatientVitalSignsSchema
}).strict()

export const SetupResponseSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  status: z.literal('ready'),
  createdAt: z.iso.datetime({ offset: true }),
  patient: PatientProfileSchema,
  versions: SessionVersionPinsSchema,
  readiness: z.object({
    profile: z.literal(true),
    redis: z.literal(true),
    conversation: z.literal(true)
  }).strict()
}).strict()

export type PatientSetupResult = z.infer<typeof SetupResponseSchema>

export const TurnResponseSchema = z.object({
  turnId: z.string().min(1),
  text: z.string().min(1)
}).strict()

export const AudioTranscriptionCallSchema = z.object({
  answerSdp: z.string().min(1),
  maxDurationSeconds: z.number().int().positive().max(900)
}).strict()

export const AssessmentFieldsSchema = z.object({
  summary: z.string().max(4_000),
  differential: z.string().max(4_000),
  rationale: z.string().max(8_000),
  plan: z.string().max(4_000)
}).strict()

export const AssessmentDraftResponseSchema = z.object({
  revision: z.number().int().positive(),
  fields: AssessmentFieldsSchema,
  updatedAt: z.iso.datetime({ offset: true })
}).strict()

export const LocalTranscriptUtteranceSchema = z.object({
  utteranceId: z.string().min(1),
  ordinal: z.number().int().positive(),
  sequence: z.number().int().nonnegative(),
  kind: z.enum(['repair', 'stop', 'phase_transition', 'patient_repeat']),
  speaker: z.enum(['learner', 'patient']),
  phase: z.enum(['history', 'assessment', 'debrief']),
  modality: z.enum(['typed', 'realtime_transcription', 'text']),
  content: z.string().min(1).max(8_000),
  occurredAt: z.iso.datetime({ offset: true })
}).strict()

export const CurrentEncounterResponseSchema = z.object({
  encounter: z.object({
    sessionId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    status: z.enum(['initializing', 'ready', 'active']),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    versions: SessionVersionPinsSchema,
    patient: PatientProfileSchema.nullable(),
    phase: z.enum(['history', 'assessment', 'debrief']).nullable(),
    currentTurnSequence: z.number().int().nonnegative(),
    transcript: z.array(z.object({
      turnId: z.string().min(1),
      sequence: z.number().int().positive(),
      acceptedAt: z.iso.datetime({ offset: true }),
      phase: z.enum(['history', 'assessment', 'debrief']),
      learnerModality: z.enum(['typed', 'realtime_transcription']),
      learnerMessage: z.string().min(1).max(8_000),
      patientResponse: z.string().min(1).max(8_000)
    }).strict()),
    localUtterances: z.array(LocalTranscriptUtteranceSchema),
    assessmentDraft: z.object({
      revision: z.number().int().positive(),
      fields: AssessmentFieldsSchema,
      updatedAt: z.iso.datetime({ offset: true })
    }).strict().nullable(),
    assessment: z.object({
      assessmentId: z.string().min(1),
      fields: AssessmentFieldsSchema,
      submittedAt: z.iso.datetime({ offset: true })
    }).strict().nullable()
  }).strict().nullable()
}).strict()

export const BeginAssessmentResponseSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  phase: z.literal('assessment')
}).strict()

export const AssessmentSubmittedResponseSchema = z.object({
  assessmentId: z.string().min(1),
  status: z.literal('unscored'),
  submittedAt: z.iso.datetime({ offset: true })
}).strict()

export type CreateSessionResult = z.infer<typeof CreateSessionResponseSchema>
export type OwnedSessionResult = z.infer<typeof OwnedSessionResponseSchema>
export type PatientProfile = z.infer<typeof PatientProfileSchema>
export type TurnResult = z.infer<typeof TurnResponseSchema>
export type AudioTranscriptionCall = z.infer<typeof AudioTranscriptionCallSchema>
export type AssessmentFields = z.infer<typeof AssessmentFieldsSchema>
export type AssessmentDraft = z.infer<typeof AssessmentDraftResponseSchema>
export type LocalTranscriptUtterance = z.infer<typeof LocalTranscriptUtteranceSchema>
export type AssessmentSubmittedResult = z.infer<typeof AssessmentSubmittedResponseSchema>
export type CurrentEncounterResult = z.infer<typeof CurrentEncounterResponseSchema>
