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
  PATIENT_PROFILE_FIELDS,
  PatientScenarioProfileSchema
} from '../services/api/src/patient-profile.ts'
import {
  ArchiveStatusSchema,
  ClinicalActionSchema,
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
  ['patient-reported-fact-expansion', 'PatientReportedFactExpansion', PatientReportedFactExpansionSchema],
  ['session-state', 'SessionState', SessionStateSchema],
  ['session-turn', 'SessionTurn', SessionTurnSchema],
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
if (
  JSON.stringify(Object.keys(patientProfileDocument.setupProfileTemplate)) !==
  JSON.stringify(patientProfileDocument.setupProfileFields)
) {
  throw new Error('setupProfileFields must match the key order in setupProfileTemplate.')
}

let stale = false
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
