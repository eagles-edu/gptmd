import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('session transcript migration', () => {
  it('projects required turn phase and modality directly', async () => {
    const sql = await readFile(resolve('services/api/migrations/016_strict_session_transcript_view.sql'), 'utf8')

    expect(sql).toContain("event.payload->>'phase' AS phase")
    expect(sql).toContain("event.payload->>'learnerModality'")
    expect(sql.toLowerCase()).not.toContain('coalesce(')
  })
})
