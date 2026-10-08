import { z } from 'zod'
import {
  PATIENT_SCENARIO_SCHEMA_VERSION,
  PATIENT_HISTORY_FIELDS,
  PAIN_EPISODE_FIELDS,
  MAX_PAIN_EPISODES,
  MAX_PAIN_HISTORY_REFS,
  PatientScenarioProfileSchema
} from './patient-profile.ts'
import { LearnerPatientProfileSchema } from './patient-setup.ts'

const OpaqueIdSchema = z.string().trim().min(1).max(200)
export const ApplicationSessionIdSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
const UtcTimestampSchema = z.iso.datetime({ offset: true })
export const PATIENT_TURN_SCHEMA_VERSION = 4 as const
export const SessionVersionPinsSchema = z.object({
  promptVersion: z.string().trim().min(1).max(100),
  modelVersion: z.string().trim().min(1).max(200),
  schemaVersion: z.literal(PATIENT_SCENARIO_SCHEMA_VERSION),
  policyVersion: z.string().trim().min(1).max(100)
}).strict()
export type SessionVersionPins = z.infer<typeof SessionVersionPinsSchema>
export const SessionTurnVersionPinsSchema = z.object({
  promptVersion: z.string().trim().min(1).max(100),
  modelVersion: z.string().trim().min(1).max(200),
  schemaVersion: z.literal(PATIENT_TURN_SCHEMA_VERSION),
  policyVersion: z.string().trim().min(1).max(100),
  rubricVersion: z.string().trim().min(1).max(100).nullable()
}).strict()
export type SessionTurnVersionPins = z.infer<typeof SessionTurnVersionPinsSchema>
const HistoryFieldSchema = z.enum(PATIENT_HISTORY_FIELDS)
const PainEpisodeIdSchema = z.enum(['pain-1', 'pain-2'])
const PainFieldSchema = z.enum(PAIN_EPISODE_FIELDS)
const PainTopicSchema = z.union([z.literal('anyPain'), PainFieldSchema])
const PatientReportedValueSchema = z.union([
  z.string().trim().min(1).max(4_000),
  z.number().finite(),
  z.array(z.string().trim().min(1).max(500)).min(1).max(50)
])

/** Immutable, app-owned snapshot of the validated patient canon for one visit. */
export const ImmutablePatientScenarioSchema = z.object({
  scenarioId: OpaqueIdSchema,
  schemaVersion: z.literal(PATIENT_SCENARIO_SCHEMA_VERSION),
  createdAt: UtcTimestampSchema,
  profileDigest: z.string().regex(/^[a-f0-9]{64}$/),
  profile: PatientScenarioProfileSchema
}).strict()

export type ImmutablePatientScenario = z.infer<typeof ImmutablePatientScenarioSchema>

/** A bounded elaboration disclosed by the fictional patient during an accepted turn. */
export const PatientReportedFactExpansionSchema = z.object({
  factId: OpaqueIdSchema,
  field: HistoryFieldSchema,
  section: z.string().trim().min(1).max(120),
  value: PatientReportedValueSchema,
  source: z.literal('patient_reported'),
  turnId: OpaqueIdSchema,
  turnSequence: z.number().int().positive(),
  recordedAt: UtcTimestampSchema
}).strict()

export type PatientReportedFactExpansion = z.infer<typeof PatientReportedFactExpansionSchema>

export const PatientReportedPainFactSchema = z.object({
  factId: OpaqueIdSchema,
  painEpisodeId: PainEpisodeIdSchema,
  field: PainFieldSchema,
  section: z.string().trim().min(1).max(120),
  value: PatientReportedValueSchema,
  source: z.literal('patient_reported'),
  turnId: OpaqueIdSchema,
  turnSequence: z.number().int().positive(),
  recordedAt: UtcTimestampSchema
}).strict()
export type PatientReportedPainFact = z.infer<typeof PatientReportedPainFactSchema>

export const PainHistoryCoverageSchema = z.object({
  painEpisodeId: PainEpisodeIdSchema.nullable(),
  field: PainTopicSchema
}).strict()
export type PainHistoryCoverage = z.infer<typeof PainHistoryCoverageSchema>

export const PainDisclosureSchema = PainHistoryCoverageSchema.extend({
  factId: OpaqueIdSchema
}).strict()
export type PainDisclosure = z.infer<typeof PainDisclosureSchema>

export const EncounterPhaseSchema = z.enum(['history', 'assessment', 'debrief'])
export type EncounterPhase = z.infer<typeof EncounterPhaseSchema>
export const LearnerInputModalitySchema = z.enum(['typed', 'realtime_transcription'])
export type LearnerInputModality = z.infer<typeof LearnerInputModalitySchema>
export const InteractionModeSchema = z.literal('transcript')
export type InteractionMode = z.infer<typeof InteractionModeSchema>
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
  interactionMode: InteractionModeSchema,
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
  status: z.literal('ready'),
  createdAt: UtcTimestampSchema,
  patient: LearnerPatientProfileSchema,
  versions: SessionVersionPinsSchema,
  readiness: z.object({
    profile: z.literal(true),
    redis: z.literal(true),
    conversation: z.literal(true)
  }).strict()
}).strict()

/** Durable accepted learner/patient exchange, with related facts and actions. */
export const SessionTurnSchema = z.object({
  turnId: OpaqueIdSchema,
  sessionId: ApplicationSessionIdSchema,
  sequence: z.number().int().positive(),
  acceptedAt: UtcTimestampSchema,
  phase: EncounterPhaseSchema,
  learnerModality: LearnerInputModalitySchema,
  versions: SessionTurnVersionPinsSchema,
  learnerMessage: z.string().trim().min(1).max(8_000),
  patientResponse: z.string().trim().min(1).max(8_000),
  patientReportedFacts: z.array(PatientReportedFactExpansionSchema).max(100),
  patientReportedPainFacts: z.array(PatientReportedPainFactSchema).max(MAX_PAIN_EPISODES * PAIN_EPISODE_FIELDS.length),
  historyCoverage: z.array(HistoryFieldSchema).max(PATIENT_HISTORY_FIELDS.length),
  disclosedHistoryFields: z.array(HistoryFieldSchema).max(PATIENT_HISTORY_FIELDS.length),
  disclosedFactIds: z.array(OpaqueIdSchema).max(100),
  painHistoryCoverage: z.array(PainHistoryCoverageSchema).max(MAX_PAIN_HISTORY_REFS),
  painDisclosures: z.array(PainDisclosureSchema).max(MAX_PAIN_HISTORY_REFS),
  historyCoverageState: z.array(z.object({
    field: HistoryFieldSchema,
    asked: z.boolean(),
    relevant: z.boolean(),
    missing: z.boolean(),
    sensitive: z.boolean(),
    notRelevant: z.boolean()
  }).strict()).max(PATIENT_HISTORY_FIELDS.length),
  clinicalActions: z.array(z.lazy(() => ClinicalActionSchema)).max(100)
}).strict().superRefine((turn, context) => {
  if (turn.disclosedHistoryFields.length !== turn.disclosedFactIds.length) {
    context.addIssue({ code: 'custom', message: 'Each disclosed history field must identify its disclosed fact' })
  }
  const painRefKey = (ref: PainHistoryCoverage) => `${ref.painEpisodeId ?? 'none'}:${ref.field}`
  if (new Set(turn.painHistoryCoverage.map(painRefKey)).size !== turn.painHistoryCoverage.length ||
      new Set(turn.painDisclosures.map(painRefKey)).size !== turn.painDisclosures.length) {
    context.addIssue({ code: 'custom', message: 'Pain coverage and disclosure references must be unique per episode and field' })
  }
  if (turn.painDisclosures.some((disclosure) => !turn.painHistoryCoverage.some((coverage) => painRefKey(coverage) === painRefKey(disclosure)))) {
    context.addIssue({ code: 'custom', message: 'Pain disclosures must be included in pain history coverage' })
  }
})

export type SessionTurn = z.infer<typeof SessionTurnSchema>
export type HistoryCoverageState = SessionTurn['historyCoverageState'][number]

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

export const AssessmentFieldsSchema = z.object({
  summary: z.string().trim().min(1).max(4_000),
  differential: z.string().trim().min(1).max(4_000),
  rationale: z.string().trim().min(1).max(8_000),
  plan: z.string().trim().min(1).max(4_000)
}).strict()
export type AssessmentFields = z.infer<typeof AssessmentFieldsSchema>

/** In-progress learner work; unlike a submission, each field may still be empty. */
export const AssessmentDraftFieldsSchema = z.object({
  summary: z.string().max(4_000),
  differential: z.string().max(4_000),
  rationale: z.string().max(8_000),
  plan: z.string().max(4_000)
}).strict()
export type AssessmentDraftFields = z.infer<typeof AssessmentDraftFieldsSchema>

export const AssessmentSubmissionSchema = AssessmentFieldsSchema.extend({
  assessmentId: OpaqueIdSchema,
  sessionId: ApplicationSessionIdSchema,
  turnSequence: z.number().int().positive(),
  submittedAt: UtcTimestampSchema
}).strict()
export type AssessmentSubmission = z.infer<typeof AssessmentSubmissionSchema>

const EncounterTranscriptTurnSchema = z.object({
  turnId: OpaqueIdSchema,
  sequence: z.number().int().positive(),
  acceptedAt: UtcTimestampSchema,
  phase: EncounterPhaseSchema,
  learnerModality: LearnerInputModalitySchema,
  learnerMessage: z.string().trim().min(1).max(8_000),
  patientResponse: z.string().trim().min(1).max(8_000)
}).strict()

export const LocalUtteranceKindSchema = z.enum(['repair', 'stop', 'phase_transition', 'patient_repeat'])
export type LocalUtteranceKind = z.infer<typeof LocalUtteranceKindSchema>

export const LocalUtteranceRequestSchema = z.object({
  utteranceId: OpaqueIdSchema,
  kind: LocalUtteranceKindSchema,
  speaker: z.enum(['learner', 'patient']),
  content: z.string().trim().min(1).max(8_000)
}).strict().superRefine((utterance, context) => {
  if ((utterance.kind === 'patient_repeat') !== (utterance.speaker === 'patient')) {
    context.addIssue({ code: 'custom', message: 'Only a local patient repeat may be recorded as patient speech' })
  }
})
export type LocalUtteranceRequest = z.infer<typeof LocalUtteranceRequestSchema>

export const LocalTranscriptUtteranceSchema = LocalUtteranceRequestSchema.extend({
  sequence: z.number().int().nonnegative(),
  ordinal: z.number().int().positive(),
  phase: EncounterPhaseSchema,
  modality: z.enum(['typed', 'realtime_transcription', 'text']),
  occurredAt: UtcTimestampSchema
}).strict()
export type LocalTranscriptUtterance = z.infer<typeof LocalTranscriptUtteranceSchema>

const EncounterRestoreSnapshotSchema = z.object({
  sessionId: ApplicationSessionIdSchema,
  status: z.enum(['initializing', 'ready', 'active']),
  createdAt: UtcTimestampSchema,
  updatedAt: UtcTimestampSchema,
  versions: SessionVersionPinsSchema,
  patient: LearnerPatientProfileSchema.nullable(),
  phase: EncounterPhaseSchema.nullable(),
  currentTurnSequence: z.number().int().nonnegative(),
  transcript: z.array(EncounterTranscriptTurnSchema),
  localUtterances: z.array(LocalTranscriptUtteranceSchema),
  assessmentDraft: z.object({
    revision: z.number().int().positive(),
    fields: AssessmentDraftFieldsSchema,
    updatedAt: UtcTimestampSchema
  }).strict().nullable(),
  assessment: z.object({
    assessmentId: OpaqueIdSchema,
    fields: AssessmentFieldsSchema,
    submittedAt: UtcTimestampSchema
  }).strict().nullable()
}).strict()

export const AssessmentDraftResponseSchema = z.object({
  revision: z.number().int().positive(),
  fields: AssessmentDraftFieldsSchema,
  updatedAt: UtcTimestampSchema
}).strict()

/** Owner-scoped current encounter projection; excludes scenario, answer key, and provider IDs. */
export const CurrentEncounterResponseSchema = z.object({
  encounter: EncounterRestoreSnapshotSchema.nullable()
}).strict()

/** Provider-side metering metadata carried only with the private recovery event. */
export const ProviderUsageSampleSchema = z.object({
  responseId: z.string().trim().min(1).max(200),
  model: z.string().trim().min(1).max(200),
  serviceTier: z.enum(['auto', 'default', 'flex', 'scale', 'priority', 'fast', 'ultrafast']).nullable(),
  inputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  cacheWriteTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative().nullable(),
  pricingVersion: z.string().trim().min(1).max(100).nullable(),
  estimatedCostUsd: z.string().regex(/^\d+\.\d{12}$/).nullable()
}).strict().superRefine((usage, context) => {
  if (usage.cachedInputTokens > usage.inputTokens) {
    context.addIssue({ code: 'custom', message: 'Cached input tokens cannot exceed input tokens' })
  }
  if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
    context.addIssue({ code: 'custom', message: 'Total tokens must equal input plus output tokens' })
  }
  if (usage.cachedInputTokens + usage.cacheWriteTokens > usage.inputTokens) {
    context.addIssue({ code: 'custom', message: 'Cached and cache-write input tokens cannot exceed input tokens' })
  }
  if ((usage.pricingVersion === null) !== (usage.estimatedCostUsd === null)) {
    context.addIssue({ code: 'custom', message: 'Cost and pricing version must be recorded together' })
  }
})
export type ProviderUsageSample = z.infer<typeof ProviderUsageSampleSchema>

export const SessionProviderUsageEventSchema = z.object({
  eventId: OpaqueIdSchema,
  sessionId: ApplicationSessionIdSchema,
  eventType: z.literal('provider_usage'),
  operation: z.literal('scenario_generation'),
  occurredAt: UtcTimestampSchema,
  usage: ProviderUsageSampleSchema
}).strict()
export type SessionProviderUsageEvent = z.infer<typeof SessionProviderUsageEventSchema>

export const SessionHistoryEventSchema = z.discriminatedUnion('eventType', [
  z.object({
    eventId: OpaqueIdSchema,
    sessionId: ApplicationSessionIdSchema,
    sequence: z.number().int().positive(),
    eventOrdinal: z.literal(0),
    eventType: z.literal('accepted_turn'),
    occurredAt: UtcTimestampSchema,
    providerUsage: z.array(ProviderUsageSampleSchema).max(2),
    payload: SessionTurnSchema
  }).strict().superRefine((event, context) => {
    if (event.eventId !== event.payload.turnId || event.sessionId !== event.payload.sessionId ||
        event.sequence !== event.payload.sequence || event.occurredAt !== event.payload.acceptedAt) {
      context.addIssue({ code: 'custom', message: 'Accepted-turn envelope does not match its payload' })
    }
    if (new Set(event.providerUsage.map((usage) => usage.responseId)).size !== event.providerUsage.length) {
      context.addIssue({ code: 'custom', message: 'Provider response IDs must be unique within an accepted turn' })
    }
  }),
  z.object({
    eventId: OpaqueIdSchema,
    sessionId: ApplicationSessionIdSchema,
    sequence: z.number().int().positive(),
    eventOrdinal: z.number().int().positive(),
    eventType: z.literal('disclosure'),
    occurredAt: UtcTimestampSchema,
    payload: z.union([
      z.object({
        turnId: OpaqueIdSchema,
        turnSequence: z.number().int().positive(),
        field: HistoryFieldSchema,
        painEpisodeId: z.null(),
        factId: OpaqueIdSchema,
        source: z.enum(['scenario_seed', 'patient_reported'])
      }).strict(),
      z.object({
        turnId: OpaqueIdSchema,
        turnSequence: z.number().int().positive(),
        field: PainTopicSchema,
        painEpisodeId: PainEpisodeIdSchema.nullable(),
        factId: OpaqueIdSchema,
        source: z.enum(['scenario_seed', 'patient_reported'])
      }).strict()
    ])
  }).strict().superRefine((event, context) => {
    if (event.sessionId.length !== 43 || event.sequence !== event.payload.turnSequence) {
      context.addIssue({ code: 'custom', message: 'Disclosure-event envelope does not match its payload' })
    }
  }),
  z.object({
    eventId: OpaqueIdSchema,
    sessionId: ApplicationSessionIdSchema,
    sequence: z.number().int().positive(),
    eventOrdinal: z.number().int().positive(),
    eventType: z.literal('phase_changed'),
    occurredAt: UtcTimestampSchema,
    payload: z.object({
      transitionId: OpaqueIdSchema,
      sessionId: ApplicationSessionIdSchema,
      turnSequence: z.number().int().positive(),
      from: z.literal('history'),
      to: z.literal('assessment'),
      occurredAt: UtcTimestampSchema
    }).strict()
  }).strict().superRefine((event, context) => {
    if (event.eventId !== event.payload.transitionId || event.sessionId !== event.payload.sessionId ||
        event.sequence !== event.payload.turnSequence || event.occurredAt !== event.payload.occurredAt) {
      context.addIssue({ code: 'custom', message: 'Phase-change event envelope does not match its payload' })
    }
  }),
  z.object({
    eventId: OpaqueIdSchema,
    sessionId: ApplicationSessionIdSchema,
    sequence: z.number().int().positive(),
    eventOrdinal: z.number().int().positive(),
    eventType: z.literal('assessment_submitted'),
    occurredAt: UtcTimestampSchema,
    payload: AssessmentSubmissionSchema
  }).strict().superRefine((event, context) => {
    if (event.eventId !== event.payload.assessmentId || event.sessionId !== event.payload.sessionId ||
        event.sequence !== event.payload.turnSequence || event.occurredAt !== event.payload.submittedAt) {
      context.addIssue({ code: 'custom', message: 'Assessment event envelope does not match its payload' })
    }
  }),
  z.object({
    eventId: OpaqueIdSchema,
    sessionId: ApplicationSessionIdSchema,
    sequence: z.number().int().positive(),
    eventOrdinal: z.literal(0),
    eventType: z.literal('terminal'),
    occurredAt: UtcTimestampSchema,
    payload: TerminalEventSchema
  }).strict().superRefine((event, context) => {
    if (event.eventId !== event.payload.eventId || event.sessionId !== event.payload.sessionId ||
        event.sequence !== event.payload.finalTurnSequence + 1 || event.occurredAt !== event.payload.occurredAt) {
      context.addIssue({ code: 'custom', message: 'Terminal-event envelope does not match its payload' })
    }
  })
])

export type SessionHistoryEvent = z.infer<typeof SessionHistoryEventSchema>

/** Minimal, non-clinical audit record for bounded patient-turn failure paths. */
export const SessionAuditEventSchema = z.object({
  eventId: z.uuid(),
  sessionId: ApplicationSessionIdSchema,
  eventType: z.enum([
    'patient_turn_model_failure',
    'patient_turn_validation_failure',
    'patient_turn_recovered_after_validation_retry',
    'patient_turn_lock_release_failure'
  ]),
  occurredAt: UtcTimestampSchema,
  payload: z.object({
    turnIdHash: z.string().regex(/^[a-f0-9]{64}$/),
    attemptCount: z.number().int().positive().max(2)
  }).strict()
}).strict()

export type SessionAuditEvent = z.infer<typeof SessionAuditEventSchema>

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
