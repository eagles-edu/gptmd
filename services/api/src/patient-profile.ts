import type OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'

// Keep this field catalog aligned with the canonical catalog in ../catalog/patient-profile.json.
// `reasonForVisit` is represented as a required profile property; the remaining
// fields are selected per case in `history`.
export const PATIENT_HISTORY_FIELDS = [
  'lastMenstrualPeriod',
  'typicalMenstrualPeriodDescription',
  'dysmenorrheaHistory',
  'anyPain',
  'whatProvokesPalliatesPain',
  'painQuality',
  'painLocationRadiationWhere',
  'painSeverity0-10',
  'timePainOnset',
  'constantIntermittentPain',
  'durationPain',
  'patientConcern',
  'medicalHistory',
  'lastPelvicExam',
  'lastPapSmear',
  'lastBreastExam',
  'lastMammogram',
  'comorbidity',
  'currentMedications',
  'allergies',
  'pastMedications',
  'nutraceuticalUse',
  'cannabisUse',
  'supplementVitaminUse',
  'tradChineseMedicine',
  'homeopathicTreatmentsMeds',
  'acupunctureHistory',
  'surgicalHistory',
  'obstetricalHistory',
  'numberPregnancies',
  'numberMiscarriage',
  'numberStillbirths',
  'numberAbortions',
  'numberEctopicPregnancies',
  'numberLiveBirths',
  'numberChildren',
  'tubalLigation',
  'hysterectomyHistory',
  'perimenopauseStatus',
  'perimenopauseSymptoms',
  'menopauseStatus',
  'menopauseSymptoms',
  'postmenopauseStatus',
  'postmenopauseSymptoms',
  'hormoneReplacementTherapy',
  'sexualActivityCurrent',
  'contraceptionMethods',
  'stdHistory',
  'familyMedicalHistory',
  'illicitDrugUse',
  'methadoneTreatment',
  'alcoholUse',
  'nutritionHabits',
  'sleepQualityQuantity',
  'mentalHealthCurrent',
  'mentalHealthPast',
  'relationshipStatus',
  'homeEnvironment',
  'mentalAbuseHistory',
  'physicalAbuseHistory',
  'sexualAbuseHistory',
  'lifeStyle',
  'employmentHistory',
  'educationalHistory',
  'exerciseCurrent',
  'dnaStudies',
  'miscellaneousDetailsNos'
] as const
export const PATIENT_PROFILE_FIELDS = ['reasonForVisit', ...PATIENT_HISTORY_FIELDS] as const

export const OBSTETRIC_COUNT_FIELDS = [
  'numberPregnancies', 'numberMiscarriage', 'numberStillbirths', 'numberAbortions',
  'numberEctopicPregnancies', 'numberLiveBirths', 'numberChildren'
] as const
export type ObstetricCountField = typeof OBSTETRIC_COUNT_FIELDS[number]

const COMPLETED_PREGNANCY_OUTCOME_FIELDS = [
  'numberMiscarriage', 'numberStillbirths', 'numberAbortions',
  'numberEctopicPregnancies', 'numberLiveBirths'
] as const satisfies readonly ObstetricCountField[]

const HistoryValueSchema = z.union([
  z.string().trim().min(1).max(4_000),
  z.number().finite(),
  z.array(z.string().trim().min(1).max(500)).max(50)
]).nullable()

const ProfileHistoryEntrySchema = z.object({
  field: z.enum(PATIENT_HISTORY_FIELDS),
  status: z.enum(['known', 'negative', 'unknown', 'not_applicable']),
  value: HistoryValueSchema
}).strict()

export const PatientScenarioProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  dateOfBirth: z.iso.date(),
  bodyType: z.enum(['average', 'heavy']),
  reasonForVisit: z.string().trim().min(1).max(1_000),
  diagnosis: z.string().trim().min(1).max(1_000).nullable(),
  history: z.array(ProfileHistoryEntrySchema).max(PATIENT_HISTORY_FIELDS.length),
  currentPregnancyStatus: z.enum(['pregnant', 'not_pregnant', 'unknown']),
  currentMenopausalStatus: z.enum(['menopausal', 'not_menopausal', 'unknown']),
  patientBeliefs: z.array(z.string().trim().min(1).max(1_000)).max(30),
  supportedExamFindings: z.array(z.string().trim().min(1).max(1_000)).max(30),
  supportedTestResults: z.array(z.object({
    testName: z.string().trim().min(1).max(200),
    result: z.string().trim().min(1).max(1_000)
  }).strict()).max(30),
  persona: z.object({
    mood: z.string().trim().min(1).max(80),
    maturity: z.string().trim().min(1).max(80),
    verbosity: z.string().trim().min(1).max(80),
    educationLevel: z.string().trim().min(1).max(120),
    willingnessToDisclose: z.string().trim().min(1).max(120)
  }).strict()
}).strict()

export type PatientScenarioProfile = z.infer<typeof PatientScenarioProfileSchema>

// Bump the prompt or policy version when their corresponding behavior changes.
export const PATIENT_SCENARIO_PROMPT_VERSION = 'patient-scenario-prompt-v3'
export const PATIENT_SCENARIO_POLICY_VERSION = 'patient-scenario-policy-v1'
export const PATIENT_SCENARIO_SCHEMA_VERSION = 3 as const

export interface PatientScenarioVersionPins {
  promptVersion: string
  modelVersion: string
  schemaVersion: number
  policyVersion: string
}

const setupInstructions = [
  'Create one fictional OB-GYN training patient as a complete private scenario profile.',
  'Use the supplied structured schema. Include only profile history fields relevant to this case; do not fill every available field.',
  'For each included history entry, use known for a patient-reported or established detail, negative for an explicit negative, unknown when relevant but not known, and not_applicable only when the field does not apply. Unknown and not_applicable values must be null. Do not turn missing information into a negative.',
  'When pain is relevant, include dedicated history entries for known details and mark relevant details that should be elicited during the interview unknown. Use the dedicated fields for quality, location and radiation, severity, onset, pattern, duration, and provoking or relieving factors. Keep symptom onset in timePainOnset rather than learner-visible reasonForVisit.',
  'When case-relevant associated symptoms or negatives are not already represented by a dedicated field, include miscellaneousDetailsNos as unknown so the patient can answer on demand. Do not seed blanket negatives or expose these details in reasonForVisit.',
  'Use currentMenopausalStatus for the scenario’s present-state truth. Keep the separate menopauseStatus history entry for the applicable patient-reported/history detail; do not use it as a substitute for currentMenopausalStatus.',
  'Make the current reason, history, diagnosis if any, patient beliefs, examination findings, and test results internally consistent. Invent no unsupported test result.',
  'Include a concise, patient-voiced primary concern as the patientConcern history field when one is relevant to the case. Keep it distinct from the clinician-only diagnosis and disclose it only when asked about worries or concerns.',
  'Use dateOfBirth in YYYY-MM-DD format. A 16-year-old must not have currentMenopausalStatus menopausal. A 75-year-old must not currently be pregnant; a coherent history of past pregnancies is allowed.',
  'Keep diagnosis private in this profile. The later learner-facing profile is a separate projection.',
  'Vary the persona traits once for this scenario and keep them stable for the session.',
  'Use the supplied scenario variation seed to make consistent choices among compatible scenario details. This seed is a stable variation hint, not a guarantee of identical generated text.'
].join(' ')

export interface GeneratedPatientScenario {
  conversationId: string
  responseId: string
  profile: PatientScenarioProfile
  usage: {
    inputTokens: number | null
    outputTokens: number | null
    totalTokens: number | null
  }
  abandonedConversationIds: string[]
}

export class PatientScenarioValidationError extends Error {
  readonly conversationIds: string[]

  constructor(conversationIds: string[]) {
    super('The generated patient scenario did not pass validation.')
    this.name = 'PatientScenarioValidationError'
    this.conversationIds = conversationIds
  }
}

export class PatientScenarioProviderError extends Error {
  readonly conversationIds: string[]

  constructor(conversationIds: string[]) {
    super('The patient scenario could not be generated by the provider.')
    this.name = 'PatientScenarioProviderError'
    this.conversationIds = conversationIds
  }
}

/** Remove setup items, including the hidden answer key, before this Conversation enters the turn lane. */
export async function clearPatientSetupConversation(client: OpenAI, conversationId: string): Promise<void> {
  const itemIds: string[] = []
  for await (const item of client.conversations.items.list(conversationId, { limit: 100, order: 'asc' })) {
    if (!item.id) throw new Error('Conversation setup item has no deletable ID')
    itemIds.push(item.id)
  }
  for (const itemId of itemIds.reverse()) {
    await client.conversations.items.delete(itemId, { conversation_id: conversationId })
  }

  for await (const remaining of client.conversations.items.list(conversationId, { limit: 1, order: 'asc' })) {
    throw new Error(`Conversation setup item ${remaining.id ?? 'with no ID'} remains in the patient turn context`)
  }
}

function ageOnDate(dateOfBirth: string, asOf: Date): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth)
  if (!match) return null

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const dob = new Date(Date.UTC(year, month - 1, day))
  if (
    dob.getUTCFullYear() !== year ||
    dob.getUTCMonth() !== month - 1 ||
    dob.getUTCDate() !== day
  ) return null

  let age = asOf.getUTCFullYear() - year
  const birthdayHasPassed =
    asOf.getUTCMonth() + 1 > month ||
    (asOf.getUTCMonth() + 1 === month && asOf.getUTCDate() >= day)
  if (!birthdayHasPassed) age -= 1
  return age
}

const MONTH_NUMBERS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12
}

/** Return a validated ISO date, null for an invalid recognized date, or undefined for unsupported prose. */
function parseHistoryCalendarDate(value: string): string | null | undefined {
  let year: number
  let month: number
  let day: number
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const parts = value.split('-').map(Number)
    year = parts[0]!
    month = parts[1]!
    day = parts[2]!
  } else {
    const monthFirst = value.match(/^([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/i)
    const dayFirst = value.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+),?\s+(\d{4})$/i)
    const match = monthFirst ?? dayFirst
    if (!match) return undefined
    const monthName = (monthFirst ? match[1] : match[2])!.toLowerCase()
    const monthValue = MONTH_NUMBERS[monthName]
    if (monthValue === undefined) return undefined
    month = monthValue
    day = Number(monthFirst ? match[2] : match[1])
    year = Number(match[3])
  }

  const date = new Date(Date.UTC(year, month - 1, day))
  if (
    !Number.isFinite(date.getTime()) || date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
  ) return null
  return date.toISOString().slice(0, 10)
}

/** Validate chronology for ISO and unambiguous English month-name history dates. */
export function isHistoryDatePlausible(dateOfBirth: string, value: unknown, asOf: Date): boolean {
  if (typeof value !== 'string') return true
  const normalizedDate = parseHistoryCalendarDate(value.trim())
  if (normalizedDate === undefined) return true
  if (normalizedDate === null) return false
  if (!Number.isFinite(asOf.getTime())) return false
  const asOfDate = asOf.toISOString().slice(0, 10)
  return normalizedDate >= dateOfBirth && normalizedDate <= asOfDate
}

function hasValidHistory(profile: PatientScenarioProfile): boolean {
  const seen = new Set<string>()
  const countFields = new Set<string>(OBSTETRIC_COUNT_FIELDS)
  for (const entry of profile.history) {
    if (seen.has(entry.field)) return false
    seen.add(entry.field)

    const hasValue = entry.value !== null && entry.value !== ''
    if ((entry.status === 'known' || entry.status === 'negative') !== hasValue) {
      return false
    }
    if (countFields.has(entry.field)) {
      if (entry.value !== null && (
        (entry.status !== 'known' && entry.status !== 'negative') ||
        typeof entry.value !== 'number' ||
        !Number.isSafeInteger(entry.value) ||
        entry.value < 0 ||
        entry.value > 99
      )) return false
    } else if (
      entry.value !== null &&
      typeof entry.value !== 'string' &&
      !Array.isArray(entry.value)
    ) {
      return false
    }
    if (Array.isArray(entry.value) && entry.value.length === 0) return false
  }
  return true
}

/** Check reported pregnancy outcomes against gravida, accounting for an active pregnancy. */
export function isObstetricHistoryConsistent(
  counts: Partial<Record<ObstetricCountField, number>>,
  currentPregnancyStatus: PatientScenarioProfile['currentPregnancyStatus']
): boolean {
  if (Object.values(counts).some((value) => !Number.isSafeInteger(value) || value < 0)) return false

  const pregnancies = counts.numberPregnancies
  if (pregnancies === undefined) return true
  if (currentPregnancyStatus === 'pregnant' && pregnancies < 1) return false

  const knownOutcomes = COMPLETED_PREGNANCY_OUTCOME_FIELDS
    .map((field) => counts[field])
    .filter((value): value is number => value !== undefined)
  const outcomeTotal = knownOutcomes.reduce((total, value) => total + value, 0)
  const expectedOutcomes = currentPregnancyStatus === 'pregnant' ? pregnancies - 1 : pregnancies
  if (outcomeTotal > expectedOutcomes) return false

  const everyOutcomeKnown = COMPLETED_PREGNANCY_OUTCOME_FIELDS.every((field) => counts[field] !== undefined)
  if (everyOutcomeKnown && currentPregnancyStatus !== 'unknown') {
    return outcomeTotal === expectedOutcomes
  }
  return true
}

export function isPatientScenarioConsistent(profile: PatientScenarioProfile, asOf: Date): boolean {
  if (!Number.isFinite(asOf.getTime())) return false
  const age = ageOnDate(profile.dateOfBirth, asOf)
  if (age === null || age < 0 || age > 120 || !hasValidHistory(profile)) return false
  const lastMenstrualPeriod = profile.history.find((entry) => entry.field === 'lastMenstrualPeriod')
  if (lastMenstrualPeriod && !isHistoryDatePlausible(profile.dateOfBirth, lastMenstrualPeriod.value, asOf)) return false
  if (age === 16 && profile.currentMenopausalStatus === 'menopausal') return false
  if (age === 75 && profile.currentPregnancyStatus === 'pregnant') return false
  if (
    profile.currentPregnancyStatus === 'pregnant' &&
    profile.currentMenopausalStatus === 'menopausal'
  ) return false
  const counts: Partial<Record<ObstetricCountField, number>> = {}
  for (const entry of profile.history) {
    if (OBSTETRIC_COUNT_FIELDS.includes(entry.field as ObstetricCountField) && typeof entry.value === 'number') {
      counts[entry.field as ObstetricCountField] = entry.value
    }
  }
  return isObstetricHistoryConsistent(counts, profile.currentPregnancyStatus)
}

function validationFailure(response: OpenAI.Responses.Response): boolean {
  return response.status !== 'completed' || response.output_text.trim().length === 0
}

export async function generatePatientScenario(
  client: OpenAI,
  model: string,
  options: {
    asOf?: Date
    maxAttempts?: number
    promptVersion?: string
    policyVersion?: string
    scenarioSeed: string
  }
): Promise<GeneratedPatientScenario> {
  const promptVersion = options.promptVersion ?? PATIENT_SCENARIO_PROMPT_VERSION
  const policyVersion = options.policyVersion ?? PATIENT_SCENARIO_POLICY_VERSION
  if (
    promptVersion !== PATIENT_SCENARIO_PROMPT_VERSION ||
    policyVersion !== PATIENT_SCENARIO_POLICY_VERSION
  ) throw new Error('The pinned patient scenario prompt or policy version is unavailable.')

  const asOf = options.asOf ?? new Date()
  if (!/^[A-Za-z0-9_-]{43}$/.test(options.scenarioSeed)) {
    throw new Error('A valid persisted scenario variation seed is required.')
  }
  const requestedAttempts = options.maxAttempts ?? 2
  const maxAttempts = Number.isFinite(requestedAttempts)
    ? Math.min(Math.max(Math.trunc(requestedAttempts), 1), 2)
    : 2
  const abandonedConversationIds: string[] = []

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let conversation: Awaited<ReturnType<typeof client.conversations.create>>
    try {
      conversation = await client.conversations.create()
    } catch {
      throw new PatientScenarioProviderError([...abandonedConversationIds])
    }
    let response: OpenAI.Responses.Response
    try {
      response = await client.responses.create({
        model,
        conversation: conversation.id,
        instructions: setupInstructions,
        input: `Generate one coherent fictional patient scenario profile for an OB-GYN history-taking simulation. Stable scenario variation seed: ${options.scenarioSeed}`,
        text: {
          format: zodTextFormat(PatientScenarioProfileSchema, 'patient_scenario_profile')
        }
      })
    } catch {
      throw new PatientScenarioProviderError([...abandonedConversationIds, conversation.id])
    }

    let profile: PatientScenarioProfile | null = null
    if (!validationFailure(response)) {
      try {
        const parsed: unknown = JSON.parse(response.output_text)
        const candidate = PatientScenarioProfileSchema.parse(parsed)
        if (isPatientScenarioConsistent(candidate, asOf)) profile = candidate
      } catch {
        profile = null
      }
    }

    if (profile) {
      try {
        await clearPatientSetupConversation(client, conversation.id)
      } catch {
        abandonedConversationIds.push(conversation.id)
        continue
      }
      return {
        conversationId: conversation.id,
        responseId: response.id,
        profile,
        usage: {
          inputTokens: response.usage?.input_tokens ?? null,
          outputTokens: response.usage?.output_tokens ?? null,
          totalTokens: response.usage?.total_tokens ?? null
        },
        abandonedConversationIds
      }
    }

    abandonedConversationIds.push(conversation.id)
  }

  throw new PatientScenarioValidationError(abandonedConversationIds)
}
