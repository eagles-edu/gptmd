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

  it('stores local voice utterances as append-only transcript rows in stable order', async () => {
    const sql = await readFile(resolve('services/api/migrations/022_session_local_utterances.sql'), 'utf8')

    expect(sql).toContain('CREATE TABLE session_local_utterances')
    expect(sql).toContain('UNIQUE (session_id, ordinal)')
    expect(sql).toContain('sequence bigint NOT NULL CHECK (sequence >= 0)')
    expect(sql).toContain('BEFORE UPDATE OR DELETE ON session_local_utterances')
    expect(sql).toContain('FROM session_local_utterances AS local')
    expect(sql).toContain('local.ordinal + 2 AS utterance_index')
  })
})
