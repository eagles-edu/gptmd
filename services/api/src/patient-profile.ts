import type OpenAI from 'openai'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'

// Keep this field catalog aligned with the canonical catalog in docs/pp.md.
// `reasonCc` is represented as a required profile property; the remaining
// fields are selected per case in `history`.
export const PATIENT_HISTORY_FIELDS = [
  'lastMenstrualPeriod',
  'typicalMenstrualPeriodDescription',
  'dysmenorrheaHistory',
  'anyPain',
  'pqrstResult',
  'medicalHistory',
  'lastPelvicExam',
  'lastPapSmear',
  'lastBreastExam',
  'lastMammogram',
  'comorbidity',
  'currentMedications',
  'pastMedicatios',
  'nutriceuticalUse',
  'supplementVitaminUse',
  'tradChineseMedicine',
  'homeopathicTreatmentsMeds',
  'accupunctureHistory',
  'sugicalHistory',
  'obstetricalHistory',
  'numberChildren',
  'numberPregnancies',
  'numberStillbirths',
  'numberLiveBirths',
  'sexualActivityCurrent',
  'contraceptionMethods',
  'stdHistory',
  'familyMedicalHistory',
  'illictDrugUse',
  'methadoneTreatment',
  'cannabisUse',
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
export const PATIENT_PROFILE_FIELDS = ['reasonCc', ...PATIENT_HISTORY_FIELDS] as const

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
  dobUs: z.string().regex(/^(0[1-9]|1[0-2])\/(0[1-9]|[12]\d|3[01])\/\d{4}$/),
  bodyType: z.enum(['average', 'heavy']),
  reasonCc: z.string().trim().min(1).max(1_000),
  diagnosesIf: z.string().trim().min(1).max(1_000).nullable(),
  history: z.array(ProfileHistoryEntrySchema).max(PATIENT_HISTORY_FIELDS.length),
  currentPregnancyStatus: z.enum(['pregnant', 'not_pregnant', 'unknown']),
  menopauseStatus: z.enum(['menopausal', 'not_menopausal', 'unknown']),
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

const setupInstructions = [
  'Create one fictional OB-GYN training patient as a complete private scenario profile.',
  'Use the supplied structured schema. Include only profile history fields relevant to this case; do not fill every available field.',
  'For each included history entry, use known for a patient-reported or established detail, negative for an explicit negative, unknown when relevant but not known, and not_applicable only when the field does not apply. Unknown and not_applicable values must be null. Do not turn missing information into a negative.',
  'Make the current reason, history, diagnosis if any, patient beliefs, examination findings, and test results internally consistent. Invent no unsupported test result.',
  'Use dobUs in MM/DD/YYYY format. A 16-year-old must not be menopausal. A 75-year-old must not currently be pregnant; a coherent history of past pregnancies is allowed.',
  'Keep diagnosis private in this profile. The later learner-facing profile is a separate projection.',
  'Vary the persona traits once for this scenario and keep them stable for the session.'
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

function ageOnDate(dobUs: string, asOf: Date): number | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dobUs)
  if (!match) return null

  const month = Number(match[1])
  const day = Number(match[2])
  const year = Number(match[3])
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

function hasValidHistory(profile: PatientScenarioProfile): boolean {
  const seen = new Set<string>()
  const countFields = new Set([
    'numberChildren',
    'numberPregnancies',
    'numberStillbirths',
    'numberLiveBirths'
  ])
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

function isConsistent(profile: PatientScenarioProfile, asOf: Date): boolean {
  if (!Number.isFinite(asOf.getTime())) return false
  const age = ageOnDate(profile.dobUs, asOf)
  if (age === null || age < 0 || age > 120 || !hasValidHistory(profile)) return false
  if (age === 16 && profile.menopauseStatus === 'menopausal') return false
  if (age === 75 && profile.currentPregnancyStatus === 'pregnant') return false
  if (
    profile.currentPregnancyStatus === 'pregnant' &&
    profile.menopauseStatus === 'menopausal'
  ) return false
  return true
}

function validationFailure(response: OpenAI.Responses.Response): boolean {
  return response.status !== 'completed' || response.output_text.trim().length === 0
}

export async function generatePatientScenario(
  client: OpenAI,
  model: string,
  options: { asOf?: Date; maxAttempts?: number } = {}
): Promise<GeneratedPatientScenario> {
  const asOf = options.asOf ?? new Date()
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
        input: 'Generate one coherent fictional patient scenario profile for an OB-GYN history-taking simulation.',
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
        if (isConsistent(candidate, asOf)) profile = candidate
      } catch {
        profile = null
      }
    }

    if (profile) {
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
