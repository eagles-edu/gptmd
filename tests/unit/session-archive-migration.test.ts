import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('session transcript archive migration', () => {
  it('creates the artifact table before adding the queue foreign key', async () => {
    const sql = await readFile(resolve('services/api/migrations/032_session_transcript_archives.sql'), 'utf8')
    const artifactTable = sql.indexOf('CREATE TABLE session_archive_artifacts')
    const artifactForeignKey = sql.indexOf('FOREIGN KEY (artifact_id) REFERENCES session_archive_artifacts')

    expect(artifactTable).toBeGreaterThanOrEqual(0)
    expect(artifactForeignKey).toBeGreaterThan(artifactTable)
    expect(sql).toContain("CHECK (expires_at = terminal_at + interval '72 hours')")
    expect(sql).toContain('ON DELETE SET NULL')
  })

  it('adds append-only authorization, completion, denial, expiry, and failure records', async () => {
    const sql = await readFile(resolve('services/api/migrations/032_session_transcript_archives.sql'), 'utf8')

    expect(sql).toContain("CHECK (result IN ('authorized', 'completed', 'denied', 'expired', 'failed'))")
    expect(sql).toContain("result = 'completed' AND artifact_id IS NOT NULL AND completed_at IS NOT NULL")
    expect(sql).toContain('UPDATE download_engagement SET download_id = engagement_id')
    expect(sql.indexOf('DROP TRIGGER download_engagement_is_append_only'))
      .toBeLessThan(sql.indexOf('UPDATE download_engagement SET download_id = engagement_id'))
    expect(sql.lastIndexOf('CREATE TRIGGER download_engagement_is_append_only'))
      .toBeGreaterThan(sql.indexOf('UPDATE download_engagement SET download_id = engagement_id'))
    expect(sql).toContain('download_engagement_completion_state CHECK')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('REVOKE ALL ON session_archive_artifacts FROM PUBLIC')
  })
})
