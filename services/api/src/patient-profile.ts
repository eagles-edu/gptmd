import OpenAI from 'openai'
import { readFileSync } from 'node:fs'
import { zodTextFormat } from 'openai/helpers/zod'
import { z } from 'zod'
import { reportResponsesTiming, type ResponsesTimingRecorder } from './response-timing.ts'
import { estimateOpenAiResponseCost } from './provider-cost.ts'
import type { ProviderUsageSample } from './session-contracts.ts'

export const PAIN_EPISODE_FIELDS = [
  'whatProvokesPalliatesPain',
  'painQuality',
  'painLocationRadiationWhere',
  'painSeverity0-10',
  'timePainOnset',
  'constantIntermittentPain',
  'durationPain'
] as const
export type PainEpisodeField = typeof PAIN_EPISODE_FIELDS[number]
export const PAIN_PROFILE_FIELDS = ['anyPain', ...PAIN_EPISODE_FIELDS] as const
export const MAX_PAIN_EPISODES = 2 as const
export const MAX_PAIN_HISTORY_REFS = MAX_PAIN_EPISODES * PAIN_PROFILE_FIELDS.length

// Keep this field catalog aligned with the canonical catalog in ../catalog/patient-profile.json.
// `reasonForVisit` is represented as a required profile property; the remaining
// history fields are selected per case in `history`; pain details are episode-scoped.
export const PATIENT_HISTORY_FIELDS = [
  'lastMenstrualPeriod',
  'typicalMenstrualPeriodDescription',
  'dysmenorrheaHistory',
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
  'numberPriorPregnanciesReaching20Weeks',
  'numberMiscarriage',
  'numberStillbirths',
  'numberAbortions',
  'numberEctopicPregnancies',
  'numberPregnanciesWithLiveBirth',
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
export const PATIENT_PROFILE_FIELDS = [
  'reasonForVisit',
  'lastMenstrualPeriod',
  'typicalMenstrualPeriodDescription',
  'dysmenorrheaHistory',
  ...PAIN_PROFILE_FIELDS,
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
  'numberPriorPregnanciesReaching20Weeks',
  'numberMiscarriage',
  'numberStillbirths',
  'numberAbortions',
  'numberEctopicPregnancies',
  'numberPregnanciesWithLiveBirth',
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

export const PATIENT_CHART_FIELDS = [
  'currentPulse',
  'bpSitting',
  'respiratoryRate',
  'axillaryTemp',
  'oralTemp',
  'analTemp',
  'dermalTemp',
  'auralTemp'
] as const

export const PATIENT_PHYSICAL_EXAM_FINDING_FIELDS = [
  'lungAuscultation',
  'skinLipsSclera',
  'skinBlanche'
] as const

const BloodPressureReadingSchema = z.object({
  systolic: z.number().int().min(1).max(300),
  diastolic: z.number().int().min(1).max(200)
}).strict().refine((reading) => reading.systolic > reading.diastolic)

const LungAuscultationSchema = z.object({
  breathSounds: z.array(z.enum(['normal', 'wheeze', 'fine_rales', 'coarse_rales', 'rhonchi'])).min(1).max(5),
  ralesDistribution: z.enum(['basilar', 'diffuse']).nullable(),
  rhonchiSeverity: z.enum(['none', 'mild', 'moderate', 'marked', 'critical']),
  effectOfCoughing: z.enum(['clears', 'partially_clears', 'unchanged', 'worsens', 'not_assessed']),
  accessoryMuscleUse: z.boolean(),
  postureTolerance: z.enum(['tolerates_supine', 'prefers_upright', 'unable_to_tolerate_supine', 'not_assessed'])
}).strict().superRefine((findings, context) => {
  const hasNormal = findings.breathSounds.includes('normal')
  const hasAbnormal = findings.breathSounds.some((sound) => sound !== 'normal')
  if (hasNormal && hasAbnormal) {
    context.addIssue({ code: 'custom', message: 'Normal breath sounds cannot be combined with abnormal sounds.' })
  }
  if (findings.breathSounds.some((sound) => sound === 'fine_rales' || sound === 'coarse_rales') !== (findings.ralesDistribution !== null)) {
    context.addIssue({ code: 'custom', message: 'Rales distribution is required only when rales are present.' })
  }
  if (findings.breathSounds.includes('rhonchi') !== (findings.rhonchiSeverity !== 'none')) {
    context.addIssue({ code: 'custom', message: 'Rhonchi severity must match whether rhonchi are present.' })
  }
  if (!findings.breathSounds.includes('rhonchi') && findings.effectOfCoughing !== 'not_assessed') {
    context.addIssue({ code: 'custom', message: 'The effect of coughing is only recorded when rhonchi are present.' })
  }
})

const TemperatureReadingSchema = z.number().finite().min(25).max(45).nullable()

export const PatientVitalSignsSchema = z.object({
  currentPulse: z.number().int().min(1).max(300),
  pulseIrregular: z.boolean(),
  pulseQuality: z.enum(['normal', 'thready', 'pounding', 'weak', 'absent_radial', 'absent_carotid', 'absent_radial_and_carotid']),
  bpSitting: BloodPressureReadingSchema,
  bpOrthostaticSupine: BloodPressureReadingSchema.nullable(),
  respiratoryRate: z.number().int().min(1).max(100),
  axillaryTemp: TemperatureReadingSchema,
  oralTemp: TemperatureReadingSchema,
  analTemp: TemperatureReadingSchema,
  dermalTemp: TemperatureReadingSchema,
  auralTemp: TemperatureReadingSchema
}).strict()
export type PatientVitalSigns = z.infer<typeof PatientVitalSignsSchema>

export const PatientPhysicalExamFindingsSchema = z.object({
  lungAuscultation: LungAuscultationSchema,
  skinLipsSclera: z.object({
    skin: z.enum(['normal', 'pale', 'cyanotic', 'pink', 'red', 'yellow']),
    lips: z.enum(['normal', 'pale', 'cyanotic', 'pink', 'red']),
    sclera: z.enum(['normal', 'white', 'red', 'yellow'])
  }).strict(),
  skinBlanche: z.number().finite().min(0).max(3)
}).strict()
export type PatientPhysicalExamFindings = z.infer<typeof PatientPhysicalExamFindingsSchema>

export const OBSTETRIC_COUNT_FIELDS = [
  'numberPregnancies', 'numberPriorPregnanciesReaching20Weeks', 'numberMiscarriage', 'numberStillbirths', 'numberAbortions',
  'numberEctopicPregnancies', 'numberPregnanciesWithLiveBirth', 'numberLiveBirths', 'numberChildren'
] as const
export type ObstetricCountField = typeof OBSTETRIC_COUNT_FIELDS[number]

const COMPLETED_PREGNANCY_OUTCOME_FIELDS = [
  'numberMiscarriage', 'numberStillbirths', 'numberAbortions',
  'numberEctopicPregnancies', 'numberPregnanciesWithLiveBirth'
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

const PainEpisodeDetailSchema = z.object({
  field: z.enum(PAIN_EPISODE_FIELDS),
  status: z.enum(['known', 'negative', 'unknown', 'not_applicable']),
  value: HistoryValueSchema
}).strict()
const PainEpisodeSchema = z.object({
  episodeId: z.enum(['pain-1', 'pain-2']),
  patientDescription: z.string().trim().min(1).max(120),
  currentStatus: z.enum(['current', 'intermittent', 'past']),
  details: z.array(PainEpisodeDetailSchema).length(PAIN_EPISODE_FIELDS.length)
}).strict().superRefine((episode, context) => {
  const fields = episode.details.map((detail) => detail.field)
  if (new Set(fields).size !== PAIN_EPISODE_FIELDS.length ||
      PAIN_EPISODE_FIELDS.some((field) => !fields.includes(field))) {
    context.addIssue({ code: 'custom', message: 'Each pain episode must have exactly one status entry for every PQRST field' })
  }
  for (const detail of episode.details) {
    if ((detail.status === 'unknown' || detail.status === 'not_applicable') && detail.value !== null) {
      context.addIssue({ code: 'custom', message: `Unknown or not-applicable ${detail.field} must have a null value` })
    }
    if ((detail.status === 'known' || detail.status === 'negative') && detail.value === null) {
      context.addIssue({ code: 'custom', message: `Known or negative ${detail.field} must have a value` })
    }
  }
})

export const PatientScenarioProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  dateOfBirth: z.iso.date(),
  bodyType: z.enum(['average', 'heavy']),
  reasonForVisit: z.string().trim().min(1).max(1_000),
  diagnosis: z.string().trim().min(1).max(1_000).nullable(),
  painHistoryStatus: z.enum(['present', 'absent']),
  painEpisodes: z.array(PainEpisodeSchema).max(MAX_PAIN_EPISODES),
  history: z.array(ProfileHistoryEntrySchema).max(PATIENT_HISTORY_FIELDS.length),
  vitalSigns: PatientVitalSignsSchema,
  physicalExamFindings: PatientPhysicalExamFindingsSchema,
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
}).strict().superRefine((profile, context) => {
  const episodeIds = profile.painEpisodes.map((episode) => episode.episodeId)
  if (new Set(episodeIds).size !== episodeIds.length) {
    context.addIssue({ code: 'custom', message: 'Pain episode IDs must be unique' })
  }
  if ((profile.painHistoryStatus === 'present') !== (profile.painEpisodes.length > 0)) {
    context.addIssue({ code: 'custom', message: 'Pain history status must match whether pain episodes are present' })
  }
})

export type PatientScenarioProfile = z.infer<typeof PatientScenarioProfileSchema>

const patientProfileCatalogJson = readFileSync(
  new URL('../catalog/patient-profile.json', import.meta.url),
  'utf8'
)

// Bump the prompt or policy version when their corresponding behavior changes.
export const PATIENT_SCENARIO_PROMPT_VERSION = 'patient-scenario-prompt-v10'
export const PATIENT_SCENARIO_POLICY_VERSION = 'patient-scenario-policy-v3'
export const PATIENT_SCENARIO_SCHEMA_VERSION = 7 as const

export interface PatientScenarioVersionPins {
  promptVersion: string
  modelVersion: string
  schemaVersion: typeof PATIENT_SCENARIO_SCHEMA_VERSION
  policyVersion: string
}

const setupInstructions = [
  'Create one fictional OB-GYN training patient as a complete private scenario profile.',
  'Use the supplied structured schema and the complete canonical patient-profile parameter catalog in the developer context. Treat the catalog as the authoritative inventory of PP fields and setup parameters. Include only history fields relevant to this case; do not fill every available field.',
  'For each included history entry, use known for a patient-reported or established detail, negative for an explicit negative, unknown when relevant but not known, and not_applicable only when the field does not apply. Unknown and not_applicable values must be null. Do not turn missing information into a negative.',
  'Represent pain only with painHistoryStatus and painEpisodes, never as flat history entries. Include no more than two distinct pain episodes across all causes. Give each a stable ID (pain-1 or pain-2), a short patient-voice description, current/intermittent/past status, and exactly one known/negative/unknown/not_applicable entry for each PQRST field. Keep each episode’s location, onset, quality, severity, pattern, duration, and provoking/relieving factors independent. Do not merge episodes or infer their cause. painHistoryStatus is present exactly when one or two episodes are supplied; otherwise it is absent.',
  'When case-relevant associated symptoms or negatives are not already represented by a dedicated field, include miscellaneousDetailsNos as unknown so the patient can answer on demand. Do not seed blanket negatives or expose these details in reasonForVisit.',
  'Use currentMenopausalStatus for the scenario’s present-state truth. Keep the separate menopauseStatus history entry for the applicable patient-reported/history detail; do not use it as a substitute for currentMenopausalStatus.',
  'Make the current reason, history, diagnosis if any, patient beliefs, examination findings, and test results internally consistent. Invent no unsupported test result.',
  'For obstetric counts, gravidity (G) is the total confirmed pregnancy count, including a current pregnancy: nulligravida is 0, primigravida is 1, and multigravida is 2 or more, regardless of outcome. In this PP, parity (P) is the patient-reported number of completed prior pregnancies reaching 20 weeks or later, regardless of outcome or fetal count; count a multiple pregnancy once and exclude a current pregnancy. Do not infer parity from live births, stillbirths, gravidity, or living-child counts. For example, if exactly two of three pregnancies reached 20 weeks, G3P2; if a fourth pregnancy is current, G4P2. numberPregnanciesWithLiveBirth counts pregnancies resulting in one or more live-born infants, while numberLiveBirths counts the infants; a multiple pregnancy counts once in the former and once per live-born infant in the latter. numberChildren is the current living-child count and must not be inferred from births. Include obstetricalHistory complications only when supported by the scenario and patient report.',
  'Populate vitalSigns with internally consistent fictional chart findings: pulse, blood pressure, respiratory rate, and each temperature site measured in this case. Choose each displayed vital in the context of this patient’s age, pregnancy status, current presentation, relevant history, acuity, and established diagnosis when one exists. Make the pulse, blood pressure, respiratory rate, temperature, and physicalExamFindings coherent with one another and the overall clinical picture. A chronic or non-acute condition does not by itself require abnormal vitals; use findings appropriate to the case severity, and give any significant abnormality or apparent contradiction a clear scenario-based reason. Do not force abnormalities to signal the diagnosis or use one generic set for every case. Leave unmeasured temperature sites null; never derive one site from another. Use bpOrthostaticSupine only when a supine measurement is part of the scenario. Populate physicalExamFindings separately: lung auscultation (normal or abnormal sounds; basilar or diffuse rales; rhonchi severity and cough response; accessory muscle use; posture tolerance), separate skin/lips/sclera color observations, and skinBlanche capillary refill time in seconds from 0 to 3 (lower is faster/better, higher is slower/worse). Keep exam findings out of learner setup; they require a completed patient-exam workflow.',
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
  usage: ProviderUsageSample | null
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

/** Remove setup content and then delete a Conversation that will not be used by a session. */
export async function deletePatientSetupConversation(client: OpenAI, conversationId: string): Promise<void> {
  await clearPatientSetupConversation(client, conversationId)
  let result: Awaited<ReturnType<typeof client.conversations.delete>>
  try {
    result = await client.conversations.delete(conversationId)
  } catch (error) {
    if (error instanceof OpenAI.APIError && error.status === 404) return
    throw error
  }
  if (!result.deleted) throw new Error('Abandoned patient setup Conversation was not deleted')
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

const RELATIVE_DATE_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12
}

const RELATIVE_DAY_OFFSETS: Record<string, number> = {
  'the day before yesterday': -2,
  yesterday: -1,
  today: 0,
  tomorrow: 1,
  'the day after tomorrow': 2
}

/** Parse counted relative dates, including approximate qualifiers; leave vague narrative prose uninterpreted. */
function parseRelativeHistoryDate(value: string, asOf: Date): string | null | undefined {
  const dayOffset = RELATIVE_DAY_OFFSETS[value.toLowerCase()]
  if (dayOffset !== undefined) {
    return new Date(Date.UTC(
      asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate() + dayOffset
    )).toISOString().slice(0, 10)
  }

  const match = value.match(/^(?:about|around|approximately)?\s*(?:(?<agoCount>\d{1,5}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?<agoUnit>day|week|month|year)s?\s+ago|in\s+(?<futureCount>\d{1,5}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?<futureUnit>day|week|month|year)s?|(?<fromNowCount>\d{1,5}|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?<fromNowUnit>day|week|month|year)s?\s+from\s+now)$/i)
  if (!match?.groups) return undefined

  const countToken = (match.groups.agoCount ?? match.groups.futureCount ?? match.groups.fromNowCount)?.toLowerCase()
  const unit = (match.groups.agoUnit ?? match.groups.futureUnit ?? match.groups.fromNowUnit)?.toLowerCase()
  if (!countToken || !unit) return null
  const count = /^\d+$/.test(countToken) ? Number(countToken) : RELATIVE_DATE_NUMBERS[countToken]
  if (!count || !Number.isSafeInteger(count)) return null

  const limit = unit === 'day' ? 43_830
    : unit === 'week' ? 6_261
      : unit === 'month' ? 1_440 : 120
  if (count > limit) return null

  const direction = match.groups.agoCount ? -1 : 1
  const year = asOf.getUTCFullYear()
  const month = asOf.getUTCMonth()
  const day = asOf.getUTCDate()
  let relativeDate: Date
  if (unit === 'day' || unit === 'week') {
    const dayOffset = count * (unit === 'week' ? 7 : 1) * direction
    relativeDate = new Date(Date.UTC(year, month, day + dayOffset))
  } else {
    const monthOffset = count * (unit === 'year' ? 12 : 1) * direction
    const monthIndex = year * 12 + month + monthOffset
    const targetYear = Math.floor(monthIndex / 12)
    const targetMonth = ((monthIndex % 12) + 12) % 12
    const finalDayOfMonth = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate()
    relativeDate = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, finalDayOfMonth)))
  }

  if (!Number.isFinite(relativeDate.getTime())) return null
  return relativeDate.toISOString().slice(0, 10)
}

/** Validate chronology for exact ISO, unambiguous English month-name, and explicit relative dates. */
export function isHistoryDatePlausible(dateOfBirth: string, value: unknown, asOf: Date): boolean {
  if (typeof value !== 'string') return true
  if (!Number.isFinite(asOf.getTime())) return false
  const text = value.trim()
  const calendarDate = parseHistoryCalendarDate(text)
  const normalizedDate = calendarDate === undefined
    ? parseRelativeHistoryDate(text, asOf)
    : calendarDate
  if (normalizedDate === undefined) return true
  if (normalizedDate === null) return false
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

  const liveBirthPregnancies = counts.numberPregnanciesWithLiveBirth
  const liveBornInfants = counts.numberLiveBirths
  if (liveBirthPregnancies !== undefined && liveBornInfants !== undefined &&
      liveBornInfants < liveBirthPregnancies) return false

  const pregnancies = counts.numberPregnancies
  if (pregnancies === undefined) return true
  if (currentPregnancyStatus === 'pregnant' && pregnancies < 1) return false
  const completedPregnancies = currentPregnancyStatus === 'pregnant' ? pregnancies - 1 : pregnancies
  if (counts.numberPriorPregnanciesReaching20Weeks !== undefined &&
      counts.numberPriorPregnanciesReaching20Weeks > completedPregnancies) return false

  const knownOutcomes = COMPLETED_PREGNANCY_OUTCOME_FIELDS
    .map((field) => counts[field])
    .filter((value): value is number => value !== undefined)
  const outcomeTotal = knownOutcomes.reduce((total, value) => total + value, 0)
  const expectedOutcomes = completedPregnancies
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
  for (const field of ['lastMenstrualPeriod'] as const) {
    const datedHistory = profile.history.find((entry) => entry.field === field)
    if (datedHistory && !isHistoryDatePlausible(profile.dateOfBirth, datedHistory.value, asOf)) return false
  }
  for (const episode of profile.painEpisodes) {
    const onset = episode.details.find((detail) => detail.field === 'timePainOnset')
    if (onset && !isHistoryDatePlausible(profile.dateOfBirth, onset.value, asOf)) return false
  }
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
    recordTiming?: ResponsesTimingRecorder
    recordProviderUsage?: (usage: ProviderUsageSample) => Promise<void>
    recordAbandonedConversationIds?: (conversationIds: string[]) => Promise<void>
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
  const rememberAbandonedConversation = async (conversationId: string): Promise<void> => {
    if (abandonedConversationIds.includes(conversationId)) return
    abandonedConversationIds.push(conversationId)
    await options.recordAbandonedConversationIds?.([conversationId])
  }
  const discardConversation = async (conversationId: string): Promise<boolean> => {
    try {
      await deletePatientSetupConversation(client, conversationId)
      return true
    } catch {
      await rememberAbandonedConversation(conversationId)
      return false
    }
  }

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let conversation: Awaited<ReturnType<typeof client.conversations.create>>
    try {
      conversation = await client.conversations.create()
    } catch {
      throw new PatientScenarioProviderError([...abandonedConversationIds])
    }
    let response: OpenAI.Responses.Response
    let durationMs: number
    try {
      const startedAt = performance.now()
      let firstTokenReported = false
      const stream = client.responses.stream({
        model,
        conversation: conversation.id,
        prompt_cache_options: { mode: 'explicit', ttl: '30m' },
        input: [
          {
            role: 'developer',
            content: [
              { type: 'input_text', text: setupInstructions },
              {
                type: 'input_text',
                text: `Complete canonical patient-profile parameter catalog (intact JSON):\n${patientProfileCatalogJson}`,
                prompt_cache_breakpoint: { mode: 'explicit' }
              }
            ]
          },
          {
            role: 'user',
            content: `Generate one coherent fictional patient scenario profile for an OB-GYN history-taking simulation. Stable scenario variation seed: ${options.scenarioSeed}`
          }
        ],
        text: {
          format: zodTextFormat(PatientScenarioProfileSchema, 'patient_scenario_profile')
        }
      })
      const reportFirstToken = () => {
        if (firstTokenReported) return
        firstTokenReported = true
        reportResponsesTiming(options.recordTiming, 'first_token', startedAt)
      }
      stream.on('response.output_text.delta', reportFirstToken)
      stream.on('response.refusal.delta', reportFirstToken)
      stream.on('response.completed', () => reportResponsesTiming(options.recordTiming, 'completed', startedAt))
      response = await stream.finalResponse()
      durationMs = Math.max(0, Math.round(performance.now() - startedAt))
    } catch {
      await discardConversation(conversation.id)
      throw new PatientScenarioProviderError([...abandonedConversationIds])
    }

    const usage: ProviderUsageSample | null = response.usage ? (() => {
      const cost = estimateOpenAiResponseCost({
        model: response.model,
        serviceTier: response.service_tier ?? null,
        inputTokens: response.usage.input_tokens,
        cachedInputTokens: response.usage.input_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: response.usage.input_tokens_details?.cache_write_tokens ?? 0,
        outputTokens: response.usage.output_tokens
      })
      return {
        responseId: response.id,
        model: response.model,
        serviceTier: response.service_tier ?? null,
        inputTokens: response.usage.input_tokens,
        cachedInputTokens: response.usage.input_tokens_details?.cached_tokens ?? 0,
        cacheWriteTokens: response.usage.input_tokens_details?.cache_write_tokens ?? 0,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.total_tokens,
        durationMs,
        pricingVersion: cost?.pricingVersion ?? null,
        estimatedCostUsd: cost?.estimatedCostUsd ?? null
      }
    })() : null
    if (usage) await options.recordProviderUsage?.(usage)

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
        await discardConversation(conversation.id)
        continue
      }
      return {
        conversationId: conversation.id,
        responseId: response.id,
        profile,
        usage,
        abandonedConversationIds
      }
    }

    await discardConversation(conversation.id)
  }

  throw new PatientScenarioValidationError(abandonedConversationIds)
}
