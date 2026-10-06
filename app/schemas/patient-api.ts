import { z } from 'zod'

const SessionVersionPinsSchema = z.object({
  promptVersion: z.string().min(1),
  modelVersion: z.string().min(1),
  schemaVersion: z.literal(5),
  policyVersion: z.string().min(1)
}).strict()

export const CreateSessionResponseSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  status: z.literal('initializing'),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  versions: SessionVersionPinsSchema
}).strict()

export const PatientProfileSchema = z.object({
  fullName: z.string().min(1),
  dateOfBirth: z.iso.date(),
  bodyType: z.enum(['average', 'heavy']),
  reasonForVisit: z.string().min(1)
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
export type PatientProfile = z.infer<typeof PatientProfileSchema>
export type TurnResult = z.infer<typeof TurnResponseSchema>
export type AudioTranscriptionCall = z.infer<typeof AudioTranscriptionCallSchema>
export type AssessmentFields = z.infer<typeof AssessmentFieldsSchema>
export type AssessmentSubmittedResult = z.infer<typeof AssessmentSubmittedResponseSchema>
