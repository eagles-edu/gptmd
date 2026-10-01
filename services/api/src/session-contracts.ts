import { z } from 'zod'
import {
  PATIENT_HISTORY_FIELDS,
  PatientScenarioProfileSchema
} from './patient-profile.ts'

const OpaqueIdSchema = z.string().trim().min(1).max(200)
export const ApplicationSessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const UtcTimestampSchema = z.iso.datetime({ offset: true })
export const SessionVersionPinsSchema = z.object({
  promptVersion: z.string().trim().min(1).max(100),
  modelVersion: z.string().trim().min(1).max(200),
  schemaVersion: z.number().int().positive(),
  policyVersion: z.string().trim().min(1).max(100)
}).strict()
export type SessionVersionPins = z.infer<typeof SessionVersionPinsSchema>
const HistoryFieldSchema = z.enum(PATIENT_HISTORY_FIELDS)
const PatientReportedValueSchema = z.union([
  z.string().trim().min(1).max(4_000),
  z.number().finite(),
  z.array(z.string().trim().min(1).max(500)).min(1).max(50)
])

/** Immutable, app-owned snapshot of the validated patient canon for one visit. */
export const ImmutablePatientScenarioSchema = z.object({
  scenarioId: OpaqueIdSchema,
  schemaVersion: z.literal(1),
  createdAt: UtcTimestampSchema,
  profileDigest: z.string().regex(/^[a-f0-9]{64}$/),
  profile: PatientScenarioProfileSchema
}).strict()

export type ImmutablePatientScenario = z.infer<typeof ImmutablePatientScenarioSchema>

/** A bounded elaboration disclosed by the fictional patient during an accepted turn. */
export const PatientReportedFactExpansionSchema = z.object({
  factId: OpaqueIdSchema,
  field: HistoryFieldSchema,
  value: PatientReportedValueSchema,
  source: z.literal('patient_reported'),
  turnId: OpaqueIdSchema,
  turnSequence: z.number().int().positive(),
  recordedAt: UtcTimestampSchema
}).strict()

export type PatientReportedFactExpansion = z.infer<typeof PatientReportedFactExpansionSchema>

export const EncounterPhaseSchema = z.enum(['history', 'assessment', 'debrief'])
export const SessionStatusSchema = z.enum([
  'initializing',
  'ready',
  'active',
  'completed',
  'cancelled'
])

/** Live session projection; private patient content remains behind scenarioId. */
export const SessionStateSchema = z.object({
  sessionId: ApplicationSessionIdSchema,
  scenarioId: OpaqueIdSchema.nullable(),
  status: SessionStatusSchema,
  phase: EncounterPhaseSchema.nullable(),
  openedAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
  currentTurnSequence: z.number().int().nonnegative(),
  terminalEventId: OpaqueIdSchema.nullable()
}).strict()

export type SessionState = z.infer<typeof SessionStateSchema>

export const SessionCreatedResponseSchema = z.object({
  sessionId: ApplicationSessionIdSchema,
  status: z.literal('initializing'),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
  versions: SessionVersionPinsSchema
}).strict()

export const PatientScenarioSetupResponseSchema = z.object({
  sessionId: ApplicationSessionIdSchema,
  scenarioId: OpaqueIdSchema,
  status: z.literal('ready'),
  createdAt: UtcTimestampSchema,
  patient: z.object({
    fullName: z.string().trim().min(1).max(120),
    dateOfBirth: z.iso.date(),
    bodyType: z.enum(['average', 'heavy']),
    reasonForVisit: z.string().trim().min(1).max(1_000)
  }).strict(),
  versions: SessionVersionPinsSchema
}).strict()

/** Durable accepted learner/patient exchange, with related facts and actions. */
export const SessionTurnSchema = z.object({
  turnId: OpaqueIdSchema,
  sessionId: ApplicationSessionIdSchema,
  sequence: z.number().int().positive(),
  acceptedAt: UtcTimestampSchema,
  learnerMessage: z.string().trim().min(1).max(8_000),
  patientResponse: z.string().trim().min(1).max(8_000),
  patientReportedFacts: z.array(PatientReportedFactExpansionSchema).max(100),
  clinicalActions: z.array(z.lazy(() => ClinicalActionSchema)).max(100)
}).strict()

export type SessionTurn = z.infer<typeof SessionTurnSchema>

const ClinicalActionBase = z.object({
  actionId: OpaqueIdSchema,
  sessionId: ApplicationSessionIdSchema,
  turnId: OpaqueIdSchema,
  occurredAt: UtcTimestampSchema
})

export const ClinicalActionSchema = z.discriminatedUnion('kind', [
  ClinicalActionBase.extend({
    kind: z.literal('order'),
    status: z.enum(['requested', 'completed', 'cancelled']),
    testName: z.string().trim().min(1).max(200),
    result: z.string().trim().min(1).max(2_000).nullable()
  }).strict(),
  ClinicalActionBase.extend({
    kind: z.literal('exam'),
    status: z.enum(['requested', 'consented', 'declined', 'completed']),
    examName: z.string().trim().min(1).max(200),
    chaperone: z.enum(['not_required', 'offered', 'accepted', 'declined']).nullable(),
    finding: z.string().trim().min(1).max(2_000).nullable()
  }).strict(),
  ClinicalActionBase.extend({
    kind: z.literal('assessment'),
    status: z.literal('submitted'),
    assessment: z.string().trim().min(1).max(8_000)
  }).strict()
])

export type ClinicalAction = z.infer<typeof ClinicalActionSchema>

export const TerminalEventSchema = z.object({
  eventId: OpaqueIdSchema,
  sessionId: ApplicationSessionIdSchema,
  outcome: z.enum(['completed', 'cancelled']),
  occurredAt: UtcTimestampSchema,
  reason: z.string().trim().min(1).max(500).nullable(),
  finalTurnSequence: z.number().int().nonnegative()
}).strict()

export type TerminalEvent = z.infer<typeof TerminalEventSchema>

const ArchiveStatusBase = z.object({
  archiveId: OpaqueIdSchema,
  sessionId: ApplicationSessionIdSchema,
  updatedAt: UtcTimestampSchema
})

/** Archive lifecycle with status-specific fields encoded in the union. */
export const ArchiveStatusSchema = z.discriminatedUnion('status', [
  ArchiveStatusBase.extend({
    status: z.literal('pending'),
    artifactId: z.null(),
    downloadExpiresAt: z.null(),
    errorCode: z.null()
  }).strict(),
  ArchiveStatusBase.extend({
    status: z.literal('building'),
    artifactId: z.null(),
    downloadExpiresAt: z.null(),
    errorCode: z.null()
  }).strict(),
  ArchiveStatusBase.extend({
    status: z.literal('available'),
    artifactId: OpaqueIdSchema,
    downloadExpiresAt: UtcTimestampSchema,
    errorCode: z.null()
  }).strict(),
  ArchiveStatusBase.extend({
    status: z.literal('failed'),
    artifactId: z.null(),
    downloadExpiresAt: z.null(),
    errorCode: z.string().trim().min(1).max(100)
  }).strict(),
  ArchiveStatusBase.extend({
    status: z.literal('expired'),
    artifactId: z.null(),
    downloadExpiresAt: UtcTimestampSchema,
    errorCode: z.null()
  }).strict()
])

export type ArchiveStatus = z.infer<typeof ArchiveStatusSchema>
