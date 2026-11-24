import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('scenario provider pin migration', () => {
  it('preserves OpenAI as the historical default and permits stateless Anthropic identity bindings', async () => {
    const sql = await readFile(new URL('../../services/api/migrations/045_scenario_provider_pin.sql', import.meta.url), 'utf8')

    expect(sql).toContain("ADD COLUMN scenario_provider text NOT NULL DEFAULT 'openai'")
    expect(sql.match(/scenario_provider IN \('openai', 'anthropic'\)/g)).toHaveLength(2)
    expect(sql).toContain('ALTER COLUMN provider_conversation_id DROP NOT NULL')
    expect(sql).toContain('session_identity_binding_scenario_identity_fk')
    expect(sql).toContain('scenario_fingerprint, schema_version')
    expect(sql).toContain('NEW.scenario_provider')
    expect(sql).toContain("RAISE EXCEPTION 'The existing session identity foreign key was not found'")
    expect(sql.indexOf('DO $migration$')).toBeLessThan(
      sql.indexOf('DROP CONSTRAINT patient_scenarios_identity_tuple_unique')
    )
  })
})
