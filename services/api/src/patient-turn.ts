import { randomUUID } from 'node:crypto'
import type OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { canonicalJsonStringify } from './canonical-json.ts'
import {
  isObstetricHistoryConsistent,
  OBSTETRIC_COUNT_FIELDS,
  PATIENT_HISTORY_FIELDS,
  type ObstetricCountField,
  type PatientScenarioProfile
} from './patient-profile.ts'
import {
  PatientReportedFactExpansionSchema,
  type HistoryCoverageState,
  type EncounterPhase,
  type PatientReportedFactExpansion,
  type SessionTurn,
  type SessionTurnVersionPins
} from './session-contracts.ts'

export const PATIENT_TURN_PROMPT_VERSION = 'patient-turn-prompt-v2'
export const PATIENT_TURN_POLICY_VERSION = 'patient-turn-policy-v2'
export const PATIENT_TURN_SCHEMA_VERSION = 1

const ProposedFactSchema = z.object({
  field: PatientReportedFactExpansionSchema.shape.field,
  value: PatientReportedFactExpansionSchema.shape.value
}).strict()

export const PatientTurnModelOutputSchema = z.object({
  patientResponse: z.string().trim().min(1).max(8_000),
  proposedFacts: z.array(ProposedFactSchema).max(30),
  historyCoverage: z.array(PatientReportedFactExpansionSchema.shape.field).max(60),
  disclosedHistoryFields: z.array(PatientReportedFactExpansionSchema.shape.field).max(60)
}).strict()

export type PatientTurnModelOutput = z.infer<typeof PatientTurnModelOutputSchema>

export type PatientTurnGenerationContext = {
  scenarioId: string
  profile: PatientScenarioProfile
  conversationId: string
  versions: SessionTurnVersionPins
  acceptedTurns: SessionTurn[]
  phase: EncounterPhase
  learnerMessage: string
  retryAfterValidationFailure?: boolean
}

export type AcceptedPatientTurnContent = {
  patientResponse: string
  patientReportedFacts: PatientReportedFactExpansion[]
  historyCoverage: PatientTurnModelOutput['historyCoverage']
  disclosedHistoryFields: PatientTurnModelOutput['disclosedHistoryFields']
  disclosedFactIds: string[]
  historyCoverageState: HistoryCoverageState[]
}

const HISTORY_CUES: Record<PatientScenarioProfile['history'][number]['field'], string[]> = {
  lastMenstrualPeriod: ['last menstrual period', 'lmp', 'last period', 'period date'],
  typicalMenstrualPeriodDescription: ['menstrual cycle', 'period cycle', 'regular periods', 'period usually', 'menstrual period'],
  dysmenorrheaHistory: ['painful periods', 'period cramps', 'menstrual cramps', 'dysmenorrhea'],
  anyPain: ['pain', 'hurt', 'ache', 'sore', 'cramp', 'symptom', 'symptoms'],
  pqrstResult: ['pain quality', 'pain severity', 'pain timing', 'pain radiation', 'pqrst'],
  medicalHistory: ['medical history', 'medical condition', 'health condition', 'illness'],
  lastPelvicExam: ['pelvic exam', 'pelvic examination'],
  lastPapSmear: ['pap smear', 'pap test', 'cervical screening'],
  lastBreastExam: ['breast exam', 'breast examination'],
  lastMammogram: ['mammogram', 'breast screening'],
  comorbidity: ['other conditions', 'chronic condition', 'comorbidity'],
  currentMedications: ['current medication', 'medications', 'medicine', 'medicines', 'prescriptions', 'taking anything'],
  pastMedications: ['past medication', 'previous medication', 'medication history'],
  nutraceuticalUse: ['nutraceutical', 'natural products'],
  cannabisUse: ['cannabis', 'marijuana', 'weed'],
  supplementVitaminUse: ['supplements', 'vitamins'],
  tradChineseMedicine: ['traditional chinese medicine', 'herbal medicine'],
  homeopathicTreatmentsMeds: ['homeopathic', 'homeopathy'],
  acupunctureHistory: ['acupuncture'],
  surgicalHistory: ['surgery', 'surgical history', 'operation'],
  obstetricalHistory: ['pregnancy history', 'obstetric history', 'pregnancy outcome', 'birth history'],
  numberPregnancies: ['pregnancies', 'pregnant before', 'gravida'],
  numberMiscarriage: ['miscarriages', 'miscarriage'],
  numberStillbirths: ['stillbirths', 'stillbirth'],
  numberAbortions: ['abortions', 'abortion'],
  numberEctopicPregnancies: ['ectopic pregnancy', 'ectopic pregnancies'],
  numberLiveBirths: ['live births', 'children born alive'],
  numberChildren: ['children', 'child', 'parity'],
  tubalLigation: ['tubal ligation', 'tubes tied'],
  hysterectomyHistory: ['hysterectomy', 'uterus removed'],
  perimenopauseStatus: ['perimenopause', 'perimenopausal'],
  perimenopauseSymptoms: ['perimenopause symptoms'],
  menopauseStatus: ['menopause history', 'menopause status'],
  menopauseSymptoms: ['menopause symptoms', 'hot flashes'],
  postmenopauseStatus: ['postmenopause', 'postmenopausal'],
  postmenopauseSymptoms: ['postmenopause symptoms'],
  hormoneReplacementTherapy: ['hormone replacement', 'hrt'],
  sexualActivityCurrent: ['sexually active', 'sexual activity', 'sexual partners'],
  contraceptionMethods: ['contraception', 'birth control', 'condom', 'iud'],
  stdHistory: ['sti history', 'std history', 'sexually transmitted infection', 'sexually transmitted disease'],
  familyMedicalHistory: ['family history', 'family medical history'],
  illicitDrugUse: ['recreational drugs', 'drug use', 'illicit drugs'],
  methadoneTreatment: ['methadone', 'opioid treatment'],
  alcoholUse: ['alcohol use', 'drink alcohol', 'drinking'],
  nutritionHabits: ['nutrition', 'diet', 'eating habits'],
  sleepQualityQuantity: ['sleep', 'sleeping'],
  mentalHealthCurrent: ['current mental health', 'mental health now', 'anxiety', 'depression'],
  mentalHealthPast: ['past mental health', 'mental health history'],
  relationshipStatus: ['relationship status', 'partner'],
  homeEnvironment: ['home environment', 'living situation', 'home life'],
  mentalAbuseHistory: ['emotional abuse', 'mental abuse'],
  physicalAbuseHistory: ['physical abuse', 'physically abused'],
  sexualAbuseHistory: ['sexual abuse', 'sexually abused'],
  lifeStyle: ['lifestyle', 'life style'],
  employmentHistory: ['employment', 'occupation', 'work history'],
  educationalHistory: ['education history', 'schooling'],
  exerciseCurrent: ['exercise', 'physical activity'],
  dnaStudies: ['genetic testing', 'dna test', 'genetic study'],
  miscellaneousDetailsNos: ['other history', 'anything else about your health']
}

const SENSITIVE_HISTORY_FIELDS = new Set<PatientScenarioProfile['history'][number]['field']>([
  'sexualActivityCurrent', 'contraceptionMethods', 'stdHistory', 'illicitDrugUse', 'methadoneTreatment',
  'mentalHealthCurrent', 'mentalHealthPast', 'mentalAbuseHistory', 'physicalAbuseHistory',
  'sexualAbuseHistory', 'homeEnvironment', 'relationshipStatus'
])

const normalizedWords = (value: string): string => value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function matchHistoryCueFields(learnerMessage: string): PatientScenarioProfile['history'][number]['field'][] {
  const message = ` ${normalizedWords(learnerMessage)} `
  return PATIENT_HISTORY_FIELDS.filter((field) =>
    HISTORY_CUES[field].some((cue) => message.includes(` ${normalizedWords(cue)} `)))
}

const patientTurnInstructions = [
  'You are roleplaying the fictional patient in a medical training encounter.',
  'Use only the supplied patient-known scenario details and the accepted encounter transcript.',
  'Do not reveal or rely on any private diagnosis, answer key, rubric, or clinician-only interpretation, including information already present in this session Conversation.',
  'Do not invent symptoms, history, chronology, examination findings, orders, or test results.',
  'Answer naturally in the patient’s voice and disclose relevant information only in response to the learner.',
  'Conversation repair is mutual and follows a volley: answer the other speaker’s repair request so they can hit the conversation back. When you do not understand the learner, use one repair step at a time in this order: first ask them to repeat; they may repeat up to three or four times if needed. If you still do not understand, ask them to speak louder, slower, or more simply. Next ask them to explain an unfamiliar word or phrase another way. Then ask them to spell it. If the conversation still cannot be repaired, ask them to write it down in English. When the learner asks you for repair, respond to that specific request first: repeat the last patient reply, clarify it in simpler or different words, spell the requested word, or provide the patient’s answer as a written English note when asked to write it down. Preserve the original English wording; do not translate it. Do not skip ahead, stack several repair requests together, or pretend to understand; advance only when the current step has not resolved understanding.',
  'For sexual, reproductive, substance-use, mental-health, relationship, home-safety, or abuse history, be respectful, nonjudgmental, and patient-centered.',
  'Do not pressure the patient to answer a sensitive question, repeat it after a refusal, imply blame, or assume consent; accept a refusal briefly and continue without the declined detail.',
  'If a sensitive question causes discomfort, acknowledge it calmly and let the patient choose whether to share only the relevant scenario-supported detail.',
  'historyCoverage lists only scenario history fields directly addressed by the latest learner message.',
  'disclosedHistoryFields lists only scenario history fields whose supported details you actually disclosed in the patientResponse.',
  'The proposedFacts list may contain only new patient-reported details that directly answer the latest learner message and are supported by a scenario history field marked unknown; every proposed fact must also appear in disclosedHistoryFields.',
  'Do not repeat already accepted facts in proposedFacts. Do not report exam findings or test results as patient-reported facts.',
  'Use the current encounter phase to guide the reply. Return the required structured output.'
].join(' ')

/** Generate a turn in the session's pinned provider Conversation from GPTMD-owned state. */
export async function generatePatientTurn(
  client: OpenAI,
  model: string,
  context: PatientTurnGenerationContext
): Promise<{ responseId: string; output: unknown }> {
  const matchedFields = new Set(matchHistoryCueFields(context.learnerMessage))
  const acceptedFacts = context.acceptedTurns.flatMap((turn) => turn.patientReportedFacts)
    .filter((fact) => matchedFields.has(fact.field))
  const relevantHistory = context.profile.history
    .filter((entry) => matchedFields.has(entry.field))
    .map((entry) => {
      const accepted = acceptedFacts.find((fact) => fact.field === entry.field)
      return accepted
        ? { field: entry.field, status: 'known', value: accepted.value, source: 'patient_reported' }
        : { ...entry, source: entry.status === 'unknown' ? 'expandable_seed_cue' : 'scenario_seed' }
    })
  const response = await client.responses.parse({
    model,
    conversation: context.conversationId,
    input: [
      { role: 'developer', content: patientTurnInstructions },
      {
        role: 'user',
        content: JSON.stringify({
          phase: context.phase,
          matchedHistoryTopics: [...matchedFields],
          versions: context.versions,
          correctionRequested: context.retryAfterValidationFailure === true,
          establishedDisclosureState: context.acceptedTurns.flatMap((turn) => turn.disclosedHistoryFields
            .filter((field) => matchedFields.has(field))
            .map((field) => ({
              field,
              factId: turn.disclosedFactIds[turn.disclosedHistoryFields.indexOf(field)]
            }))),
          establishedCoverageState: context.acceptedTurns.flatMap((turn) => turn.historyCoverageState)
            .filter((coverage) => matchedFields.has(coverage.field)),
          patientScenario: {
            fullName: context.profile.fullName,
            dateOfBirth: context.profile.dateOfBirth,
            bodyType: context.profile.bodyType,
            reasonForVisit: context.profile.reasonForVisit,
            currentPregnancyStatus: context.profile.currentPregnancyStatus,
            currentMenopausalStatus: context.profile.currentMenopausalStatus,
            persona: context.profile.persona,
            relevantHistory
          },
          latestLearnerMessage: context.learnerMessage
        })
      }
    ],
    text: { format: zodTextFormat(PatientTurnModelOutputSchema, 'patient_turn') }
  })
  if (response.status !== 'completed' || !response.output_parsed) {
    throw new Error('Patient turn response was incomplete or refused')
  }
  return { responseId: response.id, output: response.output_parsed }
}

/** Reject unsupported or conflicting expansions before they enter canonical session state. */
export function validatePatientTurnOutput(
  value: unknown,
  context: PatientTurnGenerationContext,
  turnId: string,
  sequence: number,
  acceptedAt: string
): AcceptedPatientTurnContent {
  const output = PatientTurnModelOutputSchema.parse(value)
  const scenarioFields = new Map(context.profile.history.map((entry) => [entry.field, entry]))
  const matchedFields = new Set(matchHistoryCueFields(context.learnerMessage))
  if (new Set(output.historyCoverage).size !== output.historyCoverage.length ||
      new Set(output.disclosedHistoryFields).size !== output.disclosedHistoryFields.length) {
    throw new Error('Patient turn repeats a coverage or disclosure field')
  }
  for (const field of output.disclosedHistoryFields) {
    if (!scenarioFields.has(field)) throw new Error('Patient turn refers to a history field outside the scenario')
  }
  if ([...output.historyCoverage, ...output.disclosedHistoryFields].some((field) => !matchedFields.has(field))) {
    throw new Error('Patient turn covers or discloses a history field outside the matched learner cue')
  }
  if (output.historyCoverage.length !== matchedFields.size ||
      [...matchedFields].some((field) => !output.historyCoverage.includes(field))) {
    throw new Error('Patient turn omitted a matched history coverage topic')
  }
  const priorFacts = new Map<string, PatientReportedFactExpansion>()
  for (const turn of context.acceptedTurns) {
    for (const fact of turn.patientReportedFacts) {
      const prior = priorFacts.get(fact.field)
      if (prior && canonicalJsonStringify(prior.value) !== canonicalJsonStringify(fact.value)) {
        throw new Error('Accepted patient history contains conflicting facts')
      }
      priorFacts.set(fact.field, fact)
    }
  }

  const seen = new Set<string>()
  const patientReportedFacts: PatientReportedFactExpansion[] = []
  const disclosedFactIds: string[] = []
  for (const proposed of output.proposedFacts) {
    if (seen.has(proposed.field)) throw new Error('Patient turn repeats a proposed history field')
    seen.add(proposed.field)

    const prior = priorFacts.get(proposed.field)
    if (prior) {
      if (canonicalJsonStringify(prior.value) !== canonicalJsonStringify(proposed.value)) {
        throw new Error('Patient turn conflicts with an already accepted patient fact')
      }
      continue
    }

    const scenarioField = scenarioFields.get(proposed.field)
    if (!scenarioField || scenarioField.status !== 'unknown' || scenarioField.value !== null) {
      throw new Error('Patient turn proposes a fact outside an unknown scenario history field')
    }
    if (!output.disclosedHistoryFields.includes(proposed.field)) {
      throw new Error('A proposed fact must be marked as disclosed in the response')
    }
    patientReportedFacts.push(PatientReportedFactExpansionSchema.parse({
      factId: randomUUID(),
      field: proposed.field,
      value: proposed.value,
      source: 'patient_reported',
      turnId,
      turnSequence: sequence,
      recordedAt: acceptedAt
    }))
  }

  for (const field of output.disclosedHistoryFields) {
    const priorFact = priorFacts.get(field)
    const proposedFact = patientReportedFacts.find((fact) => fact.field === field)
    const scenarioField = scenarioFields.get(field)
    if (priorFact) disclosedFactIds.push(priorFact.factId)
    else if (proposedFact) disclosedFactIds.push(proposedFact.factId)
    else if (scenarioField && (scenarioField.status === 'known' || scenarioField.status === 'negative')) {
      disclosedFactIds.push(`seed:${context.scenarioId}:${field}`)
    } else {
      throw new Error('Patient turn discloses a history field without a supported scenario fact')
    }
  }

  const historyCoverageState: HistoryCoverageState[] = output.historyCoverage.map((field) => {
    const scenarioField = scenarioFields.get(field)
    const hasAcceptedFact = priorFacts.has(field) || patientReportedFacts.some((fact) => fact.field === field)
    const relevant = Boolean(scenarioField && scenarioField.status !== 'not_applicable')
    return {
      field,
      asked: true,
      relevant,
      missing: relevant && scenarioField?.status === 'unknown' && !hasAcceptedFact,
      sensitive: SENSITIVE_HISTORY_FIELDS.has(field),
      notRelevant: !relevant
    }
  })

  validateObstetricCounts(context.profile, context.acceptedTurns, patientReportedFacts)

  return {
    patientResponse: output.patientResponse,
    patientReportedFacts,
    historyCoverage: output.historyCoverage,
    disclosedHistoryFields: output.disclosedHistoryFields,
    disclosedFactIds,
    historyCoverageState
  }
}

function validateObstetricCounts(
  profile: PatientScenarioProfile,
  acceptedTurns: SessionTurn[],
  proposedFacts: PatientReportedFactExpansion[]
): void {
  const values = new Map<string, unknown>()
  for (const entry of profile.history) {
    if ((entry.status === 'known' || entry.status === 'negative') && entry.value !== null) {
      values.set(entry.field, entry.value)
    }
  }
  for (const turn of acceptedTurns) {
    for (const fact of turn.patientReportedFacts) values.set(fact.field, fact.value)
  }
  for (const fact of proposedFacts) values.set(fact.field, fact.value)

  const counts: Partial<Record<ObstetricCountField, number>> = {}
  for (const field of OBSTETRIC_COUNT_FIELDS) {
    const value = values.get(field)
    if (value !== undefined) {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new Error('Obstetric history counts must be non-negative whole numbers')
      }
      counts[field] = value
    }
  }
  if (!isObstetricHistoryConsistent(counts, profile.currentPregnancyStatus)) {
    throw new Error('Obstetric outcomes do not match the completed pregnancy count')
  }
}
