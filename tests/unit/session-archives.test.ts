import type { Pool } from 'pg'
import { unzipSync } from 'fflate'
import { describe, expect, it, vi } from 'vitest'
import {
  createPostgresSessionArchiveStore,
  createSessionArchiveWorker,
  renderSessionTranscript,
  toArchiveStatus
} from '../../services/api/src/session-archives.ts'

const sessionId = 'a'.repeat(43)
const claimedAt = new Date('2026-10-15T10:00:00.000Z')
const archiveSource = {
  tenant_id: 'tenant-a', subject_id: 'learner-a', outcome: 'completed',
  occurred_at: new Date('2026-10-15T09:55:00.000Z')
}

describe('session transcript archives', () => {
  it.each([
    { status: 'pending' as const, response: 'pending' as const, event: 'denied' },
    { status: 'processing' as const, response: 'pending' as const, event: 'denied' },
    { status: 'failed' as const, response: 'failed' as const, event: 'failed' },
    { status: 'completed' as const, response: 'expired' as const, event: 'expired' }
  ])('records a $event engagement for an owned $status archive request', async ({ status, response, event }) => {
    const now = new Date()
    const job = {
      session_id: sessionId, status, artifact_id: null,
      download_expires_at: status === 'completed' ? new Date(now.getTime() - 1) : null,
      last_error_code: null, updated_at: now,
      artifact_filename: null, artifact_content_type: null, artifact_content: null, artifact_expires_at: null
    }
    const engagementWrites: unknown[][] = []
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [], rowCount: 0 }
      if (sql.includes('SELECT session_id FROM app_sessions')) return { rows: [{ session_id: sessionId }], rowCount: 1 }
      if (sql.includes('FROM session_archive_jobs AS job')) return { rows: [job], rowCount: 1 }
      if (sql.includes('INSERT INTO download_engagement')) {
        engagementWrites.push(values ?? [])
        return { rows: [], rowCount: 1 }
      }
      throw new Error(`Unexpected store query: ${sql}`)
    })
    const pool = { connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }) } as unknown as Pool
    const store = createPostgresSessionArchiveStore(pool)

    await expect(store.resolveDownload(
      { tenantId: 'tenant-a', subjectId: 'learner-a', role: 'learner' },
      sessionId, 'download-id', now
    )).resolves.toMatchObject({ status: response })

    expect(query.mock.calls[1]?.[0]).toContain('tenant_id = $2 AND subject_id = $3')
    expect(engagementWrites).toHaveLength(1)
    expect(engagementWrites[0]?.[5]).toBe(event)
    expect(engagementWrites[0]?.[8]).toBe('download-id')
  })

  it('does not reveal or log an archive request for a session owned by another principal', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [], rowCount: 0 }
      if (sql.includes('SELECT session_id FROM app_sessions')) return { rows: [], rowCount: 0 }
      throw new Error(`Unexpected store query: ${sql}`)
    })
    const pool = { connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }) } as unknown as Pool
    const store = createPostgresSessionArchiveStore(pool)

    await expect(store.resolveDownload(
      { tenantId: 'tenant-a', subjectId: 'learner-a', role: 'learner' },
      sessionId, 'download-id', new Date()
    )).resolves.toEqual({ status: 'not_found' })
    expect(query).not.toHaveBeenCalledWith(expect.stringContaining('INSERT INTO download_engagement'), expect.anything())
  })

  it('authorizes and appends completed byte-count engagement separately', async () => {
    const expiry = new Date(Date.now() + 60_000)
    const artifactContent = Buffer.from('Learner: hello\n', 'utf8')
    const writes: Array<{ sql: string; values?: unknown[] }> = []
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      writes.push({ sql, values })
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [], rowCount: 0 }
      if (sql.includes('SELECT session_id FROM app_sessions')) return { rows: [{ session_id: sessionId }], rowCount: 1 }
      if (sql.includes('FROM session_archive_jobs AS job')) {
        return { rows: [{
          session_id: sessionId, status: 'completed', artifact_id: 'artifact-1',
          download_expires_at: expiry, last_error_code: null, updated_at: new Date(),
          artifact_filename: 'transcript.txt', artifact_content_type: 'text/plain; charset=utf-8',
          artifact_content: artifactContent, artifact_expires_at: expiry
        }], rowCount: 1 }
      }
      if (sql.includes('INSERT INTO download_engagement')) return { rows: [], rowCount: 1 }
      throw new Error(`Unexpected store query: ${sql}`)
    })
    const pool = {
      connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
      query
    } as unknown as Pool
    const store = createPostgresSessionArchiveStore(pool)
    const principal = { tenantId: 'tenant-a', subjectId: 'learner-a', role: 'learner' as const }

    const prepared = await store.resolveDownload(principal, sessionId, 'download-id', new Date())
    expect(prepared).toMatchObject({ status: 'ready', artifactId: 'artifact-1', content: artifactContent })
    expect(writes.find(({ sql }) => sql.includes('INSERT INTO download_engagement'))?.values?.[5]).toBe('authorized')

    await store.recordDownloadOutcome({
      sessionId, tenantId: 'tenant-a', subjectId: 'learner-a', artifactId: 'artifact-1',
      downloadId: 'download-id', result: 'completed', occurredAt: new Date(),
      bytesDownloaded: artifactContent.byteLength
    })
    const completion = writes.filter(({ sql }) => sql.includes('INSERT INTO download_engagement')).at(-1)
    expect(completion?.values?.[5]).toBe('completed')
    expect(completion?.values?.[7]).toBe(artifactContent.byteLength)
    expect(completion?.values?.[8]).toBe('download-id')
  })

  it('renders only ordered learner and patient transcript rows, never hidden scenario data', () => {
    const text = renderSessionTranscript([
      { speaker: 'learner', occurred_at: new Date('2026-10-15T09:50:00.000Z'), content: 'When did this start?' },
      { speaker: 'patient', occurred_at: new Date('2026-10-15T09:51:00.000Z'), content: 'Yesterday.' },
      { speaker: 'answer_key', occurred_at: new Date('2026-10-15T09:52:00.000Z'), content: 'Never include me.' }
    ], archiveSource)

    expect(text).toContain('Outcome: completed')
    expect(text).toContain('Learner: When did this start?')
    expect(text).toContain('Patient: Yesterday.')
    expect(text).not.toContain('answer_key')
    expect(text).not.toContain('Never include me.')
  })

  it('maps queued, ready, and elapsed archive rows to validated account statuses', () => {
    const updatedAt = new Date('2026-10-15T10:00:00.000Z')
    const base = {
      session_id: sessionId, status: 'pending' as const, artifact_id: null,
      download_expires_at: null, last_error_code: null, updated_at: updatedAt,
      artifact_filename: null, artifact_content_type: null, artifact_content: null, artifact_expires_at: null
    }
    expect(toArchiveStatus(base).status).toBe('pending')
    expect(toArchiveStatus({
      ...base, status: 'completed', artifact_id: 'artifact-1',
      download_expires_at: new Date('2026-10-18T10:00:00.000Z'),
      artifact_expires_at: new Date('2026-10-18T10:00:00.000Z')
    }).status).toBe('available')
    expect(toArchiveStatus({
      ...base, status: 'completed', artifact_id: null,
      download_expires_at: new Date('2026-10-18T10:00:00.000Z')
    }).status).toBe('expired')
  })

  it('builds a text-only archive from the ordered session_transcript projection', async () => {
    const claimQuery = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [], rowCount: 0 }
      if (sql.includes('SELECT session_id, terminal_event_id, attempt_count, claimed_at')) {
        return { rows: [{ session_id: sessionId, terminal_event_id: 'terminal-1', attempt_count: 0, claimed_at: null }], rowCount: 1 }
      }
      if (sql.includes('UPDATE session_archive_jobs') && sql.includes('RETURNING session_id')) {
        return { rows: [{ session_id: sessionId, terminal_event_id: 'terminal-1', attempt_count: 1, claimed_at: claimedAt }], rowCount: 1 }
      }
      throw new Error(`Unexpected claim query: ${sql}`)
    })
    const artifactQuery = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [], rowCount: 0 }
      if (sql.includes('INSERT INTO session_archive_artifacts')) {
        return { rows: [{ expires_at: new Date('2026-10-18T10:00:00.000Z') }], rowCount: 1 }
      }
      if (sql.includes("SET status = 'completed'")) return { rows: [], rowCount: 1 }
      throw new Error(`Unexpected artifact query: ${sql}`)
    })
    const clients = [
      { query: claimQuery, release: vi.fn() },
      { query: artifactQuery, release: vi.fn() }
    ]
    const connect = vi.fn().mockImplementation(async () => clients.shift())
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql.includes('DELETE FROM session_audio_segments')) return { rows: [], rowCount: 0 }
      if (sql.includes('DELETE FROM session_archive_artifacts')) return { rows: [], rowCount: 0 }
      if (sql.includes('SELECT session.tenant_id')) return { rows: [archiveSource], rowCount: 1 }
      if (sql.includes('FROM session_transcript')) {
        return {
          rows: [
            { speaker: 'learner', occurred_at: new Date('2026-10-15T09:50:00Z'), content: 'Question' },
            { speaker: 'patient', occurred_at: new Date('2026-10-15T09:51:00Z'), content: 'Answer' }
          ], rowCount: 2
        }
      }
      if (sql.includes('FROM session_audio_recording_consents')) return { rows: [], rowCount: 0 }
      throw new Error(`Unexpected pool query: ${sql}`)
    })
    const worker = createSessionArchiveWorker({ connect, query: poolQuery } as unknown as Pool)

    await expect(worker.processOnce()).resolves.toBe(1)

    expect(claimQuery.mock.calls[1]?.[0]).toContain('FOR UPDATE SKIP LOCKED')
    expect(claimQuery.mock.calls[2]?.[0]).toContain("date_trunc('milliseconds', now())")
    expect(poolQuery.mock.calls.find(([sql]) => sql.includes('FROM session_transcript'))?.[0])
      .toContain('ORDER BY sequence, utterance_index')
    expect(poolQuery.mock.calls.find(([sql]) => sql.includes('FROM session_transcript'))?.[0])
      .toContain("speaker IN ('learner', 'patient')")
    const artifactInsert = artifactQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO session_archive_artifacts'))
    expect(artifactInsert?.[0]).toContain('terminal_at, created_at, expires_at')
    expect(artifactInsert?.[1]?.[7]).toEqual(archiveSource.occurred_at)
    expect(artifactInsert?.[1]?.[8]).toEqual(new Date(archiveSource.occurred_at.getTime() + 72 * 60 * 60 * 1000))
    const persistedContent = artifactInsert?.[1]?.[6]
    expect(Buffer.isBuffer(persistedContent)).toBe(true)
    expect((persistedContent as Buffer).toString('utf8')).toContain('Learner: Question')
    expect((persistedContent as Buffer).toString('utf8')).toContain('Patient: Answer')
    expect(artifactQuery.mock.calls.at(-2)?.[0]).toContain("SET status = 'completed'")
  })

  it('builds a two-sided ZIP with transcript, learner audio, patient audio, and a manifest', async () => {
    const learnerAudio = Buffer.from('learner-audio')
    const patientAudio = Buffer.from('patient-audio')
    const claimQuery = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [], rowCount: 0 }
      if (sql.includes('SELECT session_id, terminal_event_id, attempt_count, claimed_at')) {
        return { rows: [{ session_id: sessionId, terminal_event_id: 'terminal-1', attempt_count: 0, claimed_at: null }], rowCount: 1 }
      }
      if (sql.includes('UPDATE session_archive_jobs') && sql.includes('RETURNING session_id')) {
        return { rows: [{ session_id: sessionId, terminal_event_id: 'terminal-1', attempt_count: 1, claimed_at: claimedAt }], rowCount: 1 }
      }
      throw new Error(`Unexpected claim query: ${sql}`)
    })
    const artifactQuery = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [], rowCount: 0 }
      if (sql.includes('INSERT INTO session_archive_artifacts')) {
        return { rows: [{ expires_at: new Date('2026-10-18T10:00:00.000Z') }], rowCount: 1 }
      }
      if (sql.includes("SET status = 'completed'")) return { rows: [], rowCount: 1 }
      throw new Error(`Unexpected artifact query: ${sql}`)
    })
    const clients = [
      { query: claimQuery, release: vi.fn() },
      { query: artifactQuery, release: vi.fn() }
    ]
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql.includes('DELETE FROM session_audio_segments')) return { rows: [], rowCount: 0 }
      if (sql.includes('DELETE FROM session_archive_artifacts')) return { rows: [], rowCount: 0 }
      if (sql.includes('SELECT session.tenant_id')) return { rows: [archiveSource], rowCount: 1 }
      if (sql.includes('GROUP BY turn_id')) return { rows: [{ turn_id: 'turn-00000001' }], rowCount: 1 }
      if (sql.includes('FROM session_transcript')) {
        return { rows: [{ speaker: 'patient', occurred_at: archiveSource.occurred_at, content: 'Patient answer' }], rowCount: 1 }
      }
      if (sql.includes('FROM session_audio_recording_consents')) return { rows: [{}], rowCount: 1 }
      if (sql.includes('FROM session_audio_segments')) {
        return { rows: [
          { speaker: 'learner', recording_part: 0, sequence: 0, turn_id: null, content_type: 'audio/webm', content: learnerAudio },
          { speaker: 'patient', recording_part: 0, sequence: 3, turn_id: 'turn-00000001', content_type: 'audio/mpeg', content: patientAudio }
        ], rowCount: 2 }
      }
      throw new Error(`Unexpected pool query: ${sql}`)
    })
    const worker = createSessionArchiveWorker({
      connect: vi.fn().mockImplementation(async () => clients.shift()), query: poolQuery
    } as unknown as Pool)

    await expect(worker.processOnce()).resolves.toBe(1)

    const artifactInsert = artifactQuery.mock.calls.find(([sql]) => sql.includes('INSERT INTO session_archive_artifacts'))
    expect(artifactInsert?.[1]?.[4]).toBe('application/zip')
    const archive = unzipSync(artifactInsert?.[1]?.[6] as Uint8Array)
    expect(Object.keys(archive)).toEqual(expect.arrayContaining([
      'transcript.txt', 'manifest.json', 'audio/learner-part-000.webm', 'audio/patient-turn-00003.mp3'
    ]))
    expect(Buffer.from(archive['transcript.txt'] ?? []).toString()).toContain('Patient: Patient answer')
    expect(Buffer.from(archive['audio/learner-part-000.webm'] ?? [])).toEqual(learnerAudio)
    expect(Buffer.from(archive['audio/patient-turn-00003.mp3'] ?? [])).toEqual(patientAudio)
    expect(JSON.parse(Buffer.from(archive['manifest.json'] ?? []).toString())).toMatchObject({
      format: 'gptmd-two-sided-audio-v1',
      recordings: expect.arrayContaining([
        expect.objectContaining({ speaker: 'learner' }),
        expect.objectContaining({ speaker: 'patient' })
      ])
    })
  })

  it('does not publish an archive when generation starts after the terminal-time retention window', async () => {
    const staleSource = { ...archiveSource, occurred_at: new Date('2020-01-01T00:00:00.000Z') }
    const claimQuery = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [], rowCount: 0 }
      if (sql.includes('SELECT session_id, terminal_event_id, attempt_count, claimed_at')) {
        return { rows: [{ session_id: sessionId, terminal_event_id: 'terminal-1', attempt_count: 0, claimed_at: null }], rowCount: 1 }
      }
      if (sql.includes('UPDATE session_archive_jobs') && sql.includes('RETURNING session_id')) {
        return { rows: [{ session_id: sessionId, terminal_event_id: 'terminal-1', attempt_count: 1, claimed_at: claimedAt }], rowCount: 1 }
      }
      throw new Error(`Unexpected claim query: ${sql}`)
    })
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql.includes('DELETE FROM session_audio_segments')) return { rows: [], rowCount: 0 }
      if (sql.includes('DELETE FROM session_archive_artifacts')) return { rows: [], rowCount: 0 }
      if (sql.includes('SELECT session.tenant_id')) return { rows: [staleSource], rowCount: 1 }
      if (sql.includes('UPDATE session_archive_jobs')) return { rows: [], rowCount: 1 }
      if (sql.includes('FROM session_transcript')) throw new Error('expired transcript must not be read')
      throw new Error(`Unexpected pool query: ${sql}`)
    })
    const onMetrics = vi.fn()
    const worker = createSessionArchiveWorker({
      connect: vi.fn().mockResolvedValue({ query: claimQuery, release: vi.fn() }), query: poolQuery
    } as unknown as Pool, { onMetrics })

    await expect(worker.processOnce()).resolves.toBe(0)

    const expiryUpdate = poolQuery.mock.calls.find(([sql]) => sql.includes('UPDATE session_archive_jobs'))
    expect(expiryUpdate?.[0]).toContain("SET status = 'completed', artifact_id = NULL, download_expires_at = $2")
    expect(expiryUpdate?.[1]?.[1]).toEqual(new Date('2020-01-04T00:00:00.000Z'))
    expect(poolQuery).not.toHaveBeenCalledWith(expect.stringContaining('FROM session_transcript'), expect.anything())
    expect(onMetrics).toHaveBeenCalledWith(0, 1)
  })

  it('releases a failed archive build for bounded retry without exposing stored content in the error code', async () => {
    const retryQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 1 })
    const claimQuery = vi.fn(async (sql: string) => {
      if (sql === 'BEGIN' || sql === 'COMMIT') return { rows: [], rowCount: 0 }
      if (sql.includes('SELECT session_id, terminal_event_id, attempt_count, claimed_at')) {
        return { rows: [{ session_id: sessionId, terminal_event_id: 'terminal-1', attempt_count: 1, claimed_at: null }], rowCount: 1 }
      }
      if (sql.includes('UPDATE session_archive_jobs') && sql.includes('RETURNING session_id')) {
        return { rows: [{ session_id: sessionId, terminal_event_id: 'terminal-1', attempt_count: 2, claimed_at: claimedAt }], rowCount: 1 }
      }
      throw new Error(`Unexpected claim query: ${sql}`)
    })
    const client = { query: claimQuery, release: vi.fn() }
    const poolQuery = vi.fn(async (sql: string) => {
      if (sql.includes('DELETE FROM session_audio_segments')) return { rows: [], rowCount: 0 }
      if (sql.includes('DELETE FROM session_archive_artifacts')) return { rows: [], rowCount: 0 }
      if (sql.includes('SELECT session.tenant_id')) throw new Error('database detail with transcript body')
      if (sql.includes('UPDATE session_archive_jobs')) return retryQuery(sql)
      throw new Error(`Unexpected pool query: ${sql}`)
    })
    const onError = vi.fn()
    const worker = createSessionArchiveWorker({
      connect: vi.fn().mockResolvedValue(client), query: poolQuery
    } as unknown as Pool, { onError })

    await expect(worker.processOnce()).resolves.toBe(0)

    expect(retryQuery.mock.calls[0]?.[0]).toContain('make_interval')
    expect(retryQuery.mock.calls[0]?.[0]).toContain('attempt_count >= $3')
    expect(retryQuery.mock.calls[0]?.[0]).toContain("THEN 'archive_generation_failed'")
    const retryCall = poolQuery.mock.calls.find(([sql]) => sql.includes('UPDATE session_archive_jobs'))
    expect(JSON.stringify(retryCall?.[1])).not.toContain('database detail')
    expect(onError).toHaveBeenCalledOnce()
  })
})
