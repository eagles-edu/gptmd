import { describe, expect, it } from 'vitest'
import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parse as parseJsonc, type ParseError } from 'jsonc-parser'
import {
  CreateSessionResponseSchema,
  PatientProfileSchema,
  SetupResponseSchema,
  TurnResponseSchema
} from '../../app/schemas/patient-api'

describe('shared patient API schemas', () => {
  it('accepts a valid profile and rejects invalid dates, body types, and extra fields', () => {
    const profile = {
      patientName: 'Ari Nguyen',
      patientDob: '1990-01-01',
      patientBodytype: 'average',
      patientReason: 'Pelvic pain'
    }

    expect(PatientProfileSchema.parse(profile)).toEqual(profile)
    expect(PatientProfileSchema.safeParse({ ...profile, patientDob: '1990-02-30' }).success).toBe(false)
    expect(PatientProfileSchema.safeParse({ ...profile, patientBodytype: 'slim' }).success).toBe(false)
    expect(PatientProfileSchema.safeParse({ ...profile, diagnosis: 'Hidden answer' }).success).toBe(false)
  })

  it('validates session, setup, and turn response shapes', () => {
    expect(CreateSessionResponseSchema.safeParse({ sessionId: '' }).success).toBe(false)
    expect(SetupResponseSchema.safeParse({ profile: null }).success).toBe(false)
    expect(TurnResponseSchema.safeParse({ turnId: 'turn-1', text: '' }).success).toBe(false)
  })

  it('keeps the documented patient example valid JSON that matches the runtime contract', async () => {
    const path = resolve(process.cwd(), 'docs/gpt-patient-obgyn.json')
    const example = JSON.parse(await readFile(path, 'utf8')) as unknown

    expect(PatientProfileSchema.parse(example)).toEqual(example)
  })

  it('keeps every JSON document under docs syntactically valid', async () => {
    const docsDirectory = resolve(process.cwd(), 'docs')
    const collectJsonFiles = async (directory: string): Promise<string[]> => {
      const entries = await readdir(directory, { withFileTypes: true })
      const nested = await Promise.all(entries.map(async (entry) => {
        const path = join(directory, entry.name)
        if (entry.isDirectory()) return collectJsonFiles(path)
        return entry.isFile() && (entry.name.endsWith('.json') || entry.name.endsWith('.jsonc'))
          ? [path]
          : []
      }))
      return nested.flat()
    }

    const jsonFiles = await collectJsonFiles(docsDirectory)
    expect(jsonFiles.length).toBeGreaterThan(0)
    for (const path of jsonFiles) {
      const contents = await readFile(path, 'utf8')
      if (path.endsWith('.jsonc')) {
        const errors: ParseError[] = []
        parseJsonc(contents, errors, { allowTrailingComma: true })
        expect(errors, path).toEqual([])
      } else {
        expect(() => JSON.parse(contents), path).not.toThrow()
      }
    }
  })
})
