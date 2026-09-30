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

const checkOnly = process.argv.includes('--check')
const schemas = [
  ['patient-profile', 'PatientProfile', PatientProfileSchema],
  ['patient-scenario-profile', 'PatientScenarioProfile', PatientScenarioProfileSchema],
  ['session-created-response', 'CreateSessionResponse', CreateSessionResponseSchema],
  ['setup-response', 'SetupResponse', SetupResponseSchema],
  ['turn-response', 'TurnResponse', TurnResponseSchema]
]
const outputDirectory = new URL('../docs/schemas/', import.meta.url)
await mkdir(outputDirectory, { recursive: true })

const patientProfilePath = new URL('../docs/pp.md', import.meta.url)
const patientProfileSource = await readFile(patientProfilePath, 'utf8')
const canonicalSection = patientProfileSource.split(/^5-variables\s*$/m, 1)[0]
const documentedPatientFields = canonicalSection
  .split(/\r?\n/)
  .map((field) => field.trim())
  .filter(Boolean)
if (JSON.stringify(documentedPatientFields) !== JSON.stringify(PATIENT_PROFILE_FIELDS)) {
  throw new Error('services/api/src/patient-profile.ts must match the field order in docs/pp.md.')
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
