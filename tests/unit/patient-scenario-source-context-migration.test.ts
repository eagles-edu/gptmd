import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('patient scenario source-context migration', () => {
  it('adds immutable-scenario provenance as a non-null JSON object for historical and new records', async () => {
    const sql = await readFile(new URL('../../services/api/migrations/028_patient_scenario_source_context.sql', import.meta.url), 'utf8')

    expect(sql).toContain('ADD COLUMN source_context_json jsonb NOT NULL DEFAULT')
    expect(sql).toContain("CHECK (jsonb_typeof(source_context_json) = 'object')")
  })
})
