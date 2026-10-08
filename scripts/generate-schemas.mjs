import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  CreateSessionResponseSchema,
  PatientProfileSchema,
  SetupResponseSchema,
  TurnResponseSchema
} from '../app/schemas/patient-api.ts'
import {
  PATIENT_HISTORY_FIELDS,
  PAIN_PROFILE_FIELDS,
  PATIENT_CHART_FIELDS,
  PATIENT_PHYSICAL_EXAM_FINDING_FIELDS,
  PATIENT_PROFILE_FIELDS,
  PAIN_EPISODE_FIELDS,
  MAX_PAIN_EPISODES,
  PatientScenarioProfileSchema
} from '../services/api/src/patient-profile.ts'
import {
  ArchiveStatusSchema,
  AssessmentSubmissionSchema,
  ClinicalActionSchema,
  CurrentEncounterResponseSchema,
  ImmutablePatientScenarioSchema,
  PatientScenarioSetupResponseSchema,
  PatientReportedFactExpansionSchema,
  SessionCreatedResponseSchema,
  SessionStateSchema,
  SessionVersionPinsSchema,
  SessionTurnSchema,
  TerminalEventSchema
} from '../services/api/src/session-contracts.ts'

const checkOnly = process.argv.includes('--check')
const schemas = [
  ['patient-profile', 'PatientProfile', PatientProfileSchema],
  ['patient-scenario-profile', 'PatientScenarioProfile', PatientScenarioProfileSchema],
  ['immutable-patient-scenario', 'ImmutablePatientScenario', ImmutablePatientScenarioSchema],
  ['session-version-pins', 'SessionVersionPins', SessionVersionPinsSchema],
  ['api-session-created-response', 'SessionCreatedResponse', SessionCreatedResponseSchema],
  ['patient-scenario-setup-response', 'PatientScenarioSetupResponse', PatientScenarioSetupResponseSchema],
  ['current-encounter-response', 'CurrentEncounterResponse', CurrentEncounterResponseSchema],
  ['patient-reported-fact-expansion', 'PatientReportedFactExpansion', PatientReportedFactExpansionSchema],
  ['session-state', 'SessionState', SessionStateSchema],
  ['session-turn', 'SessionTurn', SessionTurnSchema],
  ['assessment-submission', 'AssessmentSubmission', AssessmentSubmissionSchema],
  ['clinical-action', 'ClinicalAction', ClinicalActionSchema],
  ['terminal-event', 'TerminalEvent', TerminalEventSchema],
  ['archive-status', 'ArchiveStatus', ArchiveStatusSchema],
  ['session-created-response', 'CreateSessionResponse', CreateSessionResponseSchema],
  ['setup-response', 'SetupResponse', SetupResponseSchema],
  ['turn-response', 'TurnResponse', TurnResponseSchema]
]
const outputDirectory = new URL('../docs/schemas/', import.meta.url)
await mkdir(outputDirectory, { recursive: true })

const patientProfilePath = new URL('../services/api/catalog/patient-profile.json', import.meta.url)
const patientProfileDocument = z.object({
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
}).strict().parse(JSON.parse(await readFile(patientProfilePath, 'utf8')))

if (
  JSON.stringify(patientProfileDocument.patientProfileFields) !==
  JSON.stringify(PATIENT_PROFILE_FIELDS)
) {
  throw new Error('services/api/src/patient-profile.ts must match services/api/catalog/patient-profile.json.')
}
if (patientProfileDocument.painEpisodePolicy.maximumInstances !== MAX_PAIN_EPISODES ||
    JSON.stringify(patientProfileDocument.painEpisodePolicy.details) !== JSON.stringify(PAIN_EPISODE_FIELDS) ||
    JSON.stringify(patientProfileDocument.painEpisodePolicy.identityFields) !== JSON.stringify(['pain-1', 'pain-2'])) {
  throw new Error('Pain episode limits and fields must match the canonical patient-profile catalog.')
}
if (JSON.stringify(patientProfileDocument.chartFindings.fields) !== JSON.stringify(PATIENT_CHART_FIELDS)) {
  throw new Error('services/api/src/patient-profile.ts chart fields must match services/api/catalog/patient-profile.json.')
}
if (JSON.stringify(patientProfileDocument.physicalExamFindings.fields) !== JSON.stringify(PATIENT_PHYSICAL_EXAM_FINDING_FIELDS)) {
  throw new Error('services/api/src/patient-profile.ts physical exam fields must match services/api/catalog/patient-profile.json.')
}
if (
  JSON.stringify(Object.keys(patientProfileDocument.setupProfileTemplate)) !==
  JSON.stringify(patientProfileDocument.setupProfileFields)
) {
  throw new Error('setupProfileFields must match the key order in setupProfileTemplate.')
}

let stale = false
const ppResponseExamples = await readFile(new URL('../docs/schemas/pp-possible-values.md', import.meta.url), 'utf8')
const ppPreface = ppResponseExamples.split(/^## /m, 1)[0]
  .split('\n')
  .filter((line, index) => index > 0 || !line.startsWith('# '))
  .join('\n')
  .trim()
if (!ppPreface) throw new Error('docs/schemas/pp-possible-values.md must include the shared patient-response policy before its field sections.')
const responseGuidance = {}
const historyFieldSections = {}
const documentedPatientFields = [...PATIENT_HISTORY_FIELDS, ...PAIN_PROFILE_FIELDS]
let currentHistorySection = null
for (const line of ppResponseExamples.split('\n')) {
  const sectionMatch = /^## (.+)$/.exec(line)
  if (sectionMatch) {
    currentHistorySection = sectionMatch[1].trim()
    continue
  }
  if (!line.startsWith('| `')) continue
  const cells = line.slice(1, -1).split('|').map((cell) => cell.trim())
  const fieldMatch = /^`([^`]+)`$/.exec(cells[0] ?? '')
  if (!fieldMatch || cells.length !== 3 || !cells[1] || !cells[2]) continue
  const field = fieldMatch[1]
  if (!currentHistorySection) throw new Error(`PP response field ${field} appears before a history section heading.`)
  if (responseGuidance[field]) throw new Error(`Duplicate PP response examples for ${field}.`)
  historyFieldSections[field] = currentHistorySection
  responseGuidance[field] = {
    commonPatientWording: cells[1],
    clinicianAssistedGuidance: cells[2]
  }
}
if (
  JSON.stringify(Object.keys(responseGuidance).sort()) !==
  JSON.stringify(documentedPatientFields.sort())
) {
  throw new Error('docs/schemas/pp-possible-values.md must include exactly one response-guidance row per canonical non-pain history or pain field.')
}
if (JSON.stringify(Object.keys(historyFieldSections).sort()) !== JSON.stringify([...documentedPatientFields].sort())) {
  throw new Error('docs/schemas/pp-possible-values.md must assign exactly one section to every canonical non-pain history or pain field.')
}
const guidanceSource = `// Generated from docs/schemas/pp-possible-values.md; edit the Markdown source instead.\nexport const PATIENT_PROFILE_RESPONSE_POLICY = ${JSON.stringify(ppPreface)}\nexport const PATIENT_PROFILE_RESPONSE_GUIDANCE = ${JSON.stringify(responseGuidance, null, 2)} as const\n`
const guidancePath = fileURLToPath(new URL('../services/api/src/patient-profile-response-guidance.generated.ts', import.meta.url))
const sectionNames = [...new Set(Object.values(historyFieldSections))]
const sectionSource = `// Generated from docs/schemas/pp-possible-values.md; edit the Markdown source instead.\nexport const PATIENT_PROFILE_HISTORY_SECTIONS = ${JSON.stringify(sectionNames, null, 2)} as const\nexport const PATIENT_PROFILE_FIELD_SECTIONS = ${JSON.stringify(historyFieldSections, null, 2)} as const\n`
const sectionPath = fileURLToPath(new URL('../services/api/src/patient-profile-sections.generated.ts', import.meta.url))
if (checkOnly) {
  let existing
  try {
    existing = await readFile(guidancePath, 'utf8')
  } catch {
    existing = ''
  }
  if (existing !== guidanceSource) {
    console.error('services/api/src/patient-profile-response-guidance.generated.ts is missing or out of date; run npm run schemas:build.')
    stale = true
  }
  let existingSections
  try {
    existingSections = await readFile(sectionPath, 'utf8')
  } catch {
    existingSections = ''
  }
  if (existingSections !== sectionSource) {
    console.error('services/api/src/patient-profile-sections.generated.ts is missing or out of date; run npm run schemas:build.')
    stale = true
  }
} else {
  await writeFile(guidancePath, guidanceSource)
  await writeFile(sectionPath, sectionSource)
  console.log('Generated services/api/src/patient-profile-response-guidance.generated.ts')
  console.log('Generated services/api/src/patient-profile-sections.generated.ts')
}

for (const [name, title, source] of schemas) {
  const outputPath = fileURLToPath(new URL(`${name}.schema.json`, outputDirectory))
  const schema = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title,
    ...z.toJSONSchema(source)
  }
  const generated = `${JSON.stringify(schema, null, 2)}\n`

  if (checkOnly) {
    let existing
    try {
      existing = await readFile(outputPath, 'utf8')
    } catch {
      existing = ''
    }
    if (existing !== generated) {
      console.error(`docs/schemas/${name}.schema.json is missing or out of date; run npm run schemas:build.`)
      stale = true
    }
  } else {
    await writeFile(outputPath, generated)
    console.log(`Generated docs/schemas/${name}.schema.json`)
  }
}

if (stale) process.exitCode = 1
