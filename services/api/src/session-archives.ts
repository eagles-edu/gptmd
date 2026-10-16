import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { AuthenticatedPrincipal } from './auth.ts'
import { ArchiveStatusSchema, type ArchiveStatus } from './session-contracts.ts'

const MAX_ARCHIVE_TURNS = 10_000
const MAX_ARCHIVE_BYTES = 5 * 1024 * 1024
const MAX_ARCHIVE_ATTEMPTS = 5
const STALE_CLAIM_AFTER = "interval '5 minutes'"
const ARCHIVE_RETENTION_HOURS = 72

type ArchiveRow = {
  session_id: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  artifact_id: string | null
  download_expires_at: Date | null
  last_error_code: string | null
  updated_at: Date
  artifact_filename: string | null
  artifact_content_type: string | null
  artifact_content: Buffer | null
  artifact_expires_at: Date | null
}

type DownloadResolution =
  | { status: 'not_found' }
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'failed' }
  | { status: 'ready'; downloadId: string; artifactId: string; filename: string; contentType: string; content: Buffer }

export interface SessionArchiveStore {
  listOwnedArchives(principal: AuthenticatedPrincipal): Promise<ArchiveStatus[]>
  resolveDownload(
    principal: AuthenticatedPrincipal,
    sessionId: string,
    downloadId: string,
    requestedAt: Date
  ): Promise<DownloadResolution>
  recordDownloadOutcome(input: {
    sessionId: string
    tenantId: string
    subjectId: string
    artifactId: string
    downloadId: string
    result: 'completed' | 'failed'
    occurredAt: Date
    bytesDownloaded: number | null
  }): Promise<void>
}

export function createPostgresSessionArchiveStore(pool: Pool): SessionArchiveStore {
  return {
    async listOwnedArchives(principal) {
      const result = await pool.query<ArchiveRow>(
        `SELECT job.session_id, job.status, job.artifact_id, job.download_expires_at,
                job.last_error_code, job.updated_at, artifact.filename AS artifact_filename,
                artifact.content_type AS artifact_content_type, artifact.expires_at AS artifact_expires_at
         FROM session_archive_jobs AS job
         JOIN app_sessions AS session ON session.session_id = job.session_id
         LEFT JOIN session_archive_artifacts AS artifact
           ON artifact.artifact_id = job.artifact_id
          AND artifact.session_id = job.session_id
          AND artifact.tenant_id = session.tenant_id
          AND artifact.subject_id = session.subject_id
         WHERE session.tenant_id = $1 AND session.subject_id = $2
         ORDER BY job.updated_at DESC, job.session_id`,
        [principal.tenantId, principal.subjectId]
      )
      return result.rows.map(toArchiveStatus)
    },

    async resolveDownload(principal, sessionId, downloadId, requestedAt) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const owned = await client.query<{ session_id: string }>(
          `SELECT session_id FROM app_sessions
           WHERE session_id = $1 AND tenant_id = $2 AND subject_id = $3
           FOR SHARE`,
          [sessionId, principal.tenantId, principal.subjectId]
        )
        if (!owned.rows[0]) {
          await client.query('COMMIT')
          return { status: 'not_found' }
        }

        const result = await client.query<ArchiveRow>(
          `SELECT job.session_id, job.status, job.artifact_id, job.download_expires_at,
                  job.last_error_code, job.updated_at, artifact.filename AS artifact_filename,
                  artifact.content_type AS artifact_content_type, artifact.content AS artifact_content,
                  artifact.expires_at AS artifact_expires_at
           FROM session_archive_jobs AS job
           LEFT JOIN session_archive_artifacts AS artifact
             ON artifact.artifact_id = job.artifact_id
            AND artifact.session_id = job.session_id
            AND artifact.tenant_id = $2
            AND artifact.subject_id = $3
           WHERE job.session_id = $1
           FOR UPDATE OF job`,
          [sessionId, principal.tenantId, principal.subjectId]
        )
        const row = result.rows[0]
        if (!row) {
          await recordEngagement(client, {
            sessionId, tenantId: principal.tenantId, subjectId: principal.subjectId,
            artifactId: null, downloadId, result: 'denied', occurredAt: requestedAt
          })
          await client.query('COMMIT')
          return { status: 'pending' }
        }
        if (row.status === 'pending' || row.status === 'processing') {
          await recordEngagement(client, {
            sessionId, tenantId: principal.tenantId, subjectId: principal.subjectId,
            artifactId: null, downloadId, result: 'denied', occurredAt: requestedAt
          })
          await client.query('COMMIT')
          return { status: 'pending' }
        }
        if (row.status === 'failed') {
          await recordEngagement(client, {
            sessionId, tenantId: principal.tenantId, subjectId: principal.subjectId,
            artifactId: null, downloadId, result: 'failed', occurredAt: requestedAt
          })
          await client.query('COMMIT')
          return { status: 'failed' }
        }

        if (!row.artifact_id || !row.artifact_content || !row.artifact_filename ||
            !row.artifact_content_type || !row.artifact_expires_at || row.artifact_expires_at <= requestedAt ||
            !row.download_expires_at || row.download_expires_at <= requestedAt) {
          await recordEngagement(client, {
            sessionId, tenantId: principal.tenantId, subjectId: principal.subjectId,
            artifactId: row.artifact_id, downloadId, result: 'expired', occurredAt: requestedAt
          })
          await client.query('COMMIT')
          return { status: 'expired' }
        }

        await recordEngagement(client, {
          sessionId, tenantId: principal.tenantId, subjectId: principal.subjectId,
          artifactId: row.artifact_id, downloadId, result: 'authorized', occurredAt: requestedAt
        })
        await client.query('COMMIT')
        return {
          status: 'ready', downloadId, artifactId: row.artifact_id,
          filename: row.artifact_filename, contentType: row.artifact_content_type,
          content: row.artifact_content
        }
      } catch (error) {
        await rollback(client)
        throw error
      } finally {
        client.release()
      }
    },

    async recordDownloadOutcome(input) {
      await pool.query(
        `INSERT INTO download_engagement (
           engagement_id, session_id, tenant_id, subject_id, artifact_id, result,
           requested_at, completed_at, bytes_downloaded, download_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8, $9)`,
        [randomUUID(), input.sessionId, input.tenantId, input.subjectId, input.artifactId,
          input.result, input.occurredAt, input.bytesDownloaded, input.downloadId]
      )
    }
  }
}

export function toArchiveStatus(row: ArchiveRow): ArchiveStatus {
  const base = { archiveId: row.session_id, sessionId: row.session_id, updatedAt: row.updated_at.toISOString() }
  if (row.status === 'failed') {
    return ArchiveStatusSchema.parse({
      ...base, status: 'failed', artifactId: null, downloadExpiresAt: null,
      errorCode: row.last_error_code ?? 'archive_generation_failed'
    })
  }
  if (row.status === 'pending' || row.status === 'processing') {
    return ArchiveStatusSchema.parse({
      ...base, status: row.status === 'pending' ? 'pending' : 'building',
      artifactId: null, downloadExpiresAt: null, errorCode: null
    })
  }
  const now = new Date()
  const expired = !row.artifact_id || !row.artifact_expires_at || row.artifact_expires_at <= now ||
    !row.download_expires_at || row.download_expires_at <= now
  if (expired) {
    const expiresAt = row.download_expires_at?.toISOString() ?? row.updated_at.toISOString()
    return ArchiveStatusSchema.parse({
      ...base, status: 'expired', artifactId: null, downloadExpiresAt: expiresAt, errorCode: null
    })
  }
  return ArchiveStatusSchema.parse({
    ...base, status: 'available', artifactId: row.artifact_id,
    downloadExpiresAt: row.download_expires_at?.toISOString() ?? null, errorCode: null
  })
}

export type SessionArchiveWorker = {
  processOnce(): Promise<number>
  run(signal?: AbortSignal): Promise<void>
}

type ClaimedArchive = { session_id: string; terminal_event_id: string; attempt_count: number; claimed_at: Date }
type TranscriptLine = { speaker: string; occurred_at: Date; content: string }
type ArchiveSource = {
  tenant_id: string
  subject_id: string
  outcome: string
  occurred_at: Date
}

export function createSessionArchiveWorker(
  pool: Pool,
  options: {
    pollIntervalMs?: number
    onError?: (error: unknown) => void
    onMetrics?: (archived: number, expired: number) => void
  } = {}
): SessionArchiveWorker {
  const pollIntervalMs = options.pollIntervalMs ?? 1_000

  return {
    async processOnce() {
      const expired = await pruneExpiredArchives(pool)
      const job = await claimArchive(pool)
      if (!job) {
        options.onMetrics?.(0, expired)
        return 0
      }
      try {
        const source = await readArchiveSource(pool, job)
        const expiresAt = new Date(source.occurred_at.getTime() + ARCHIVE_RETENTION_HOURS * 60 * 60 * 1000)
        if (expiresAt <= new Date()) {
          const expiredJob = await pool.query(
            `UPDATE session_archive_jobs
             SET status = 'completed', artifact_id = NULL, download_expires_at = $2,
                 completed_at = now(), claimed_at = NULL, last_error_code = NULL, updated_at = now()
             WHERE session_id = $1 AND status = 'processing' AND claimed_at = $3`,
            [job.session_id, expiresAt, job.claimed_at]
          )
          if (expiredJob.rowCount !== 1) throw new Error('archive_claim_lost')
          options.onMetrics?.(0, expired + 1)
          return 0
        }
        const content = await readTranscript(pool, job.session_id, source)
        const contentBuffer = Buffer.from(content, 'utf8')
        if (contentBuffer.byteLength > MAX_ARCHIVE_BYTES) throw new Error('archive_size_limit')
        const artifactId = randomUUID()
        const filename = `gptmd-transcript-${source.occurred_at.toISOString().slice(0, 10)}-${job.session_id.slice(0, 8)}.txt`
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          const artifact = await client.query<{ expires_at: Date }>(
            `INSERT INTO session_archive_artifacts (
               artifact_id, session_id, tenant_id, subject_id, content_type, filename, content,
               terminal_at, created_at, expires_at
             ) VALUES ($1, $2, $3, $4, 'text/plain; charset=utf-8', $5, $6, $7, now(), $8)
             RETURNING expires_at`,
            [artifactId, job.session_id, source.tenant_id, source.subject_id, filename, contentBuffer,
              source.occurred_at, expiresAt]
          )
          const updated = await client.query(
            `UPDATE session_archive_jobs
             SET status = 'completed', artifact_id = $2, download_expires_at = $3,
                 completed_at = now(), claimed_at = NULL, last_error_code = NULL, updated_at = now()
             WHERE session_id = $1 AND status = 'processing' AND claimed_at = $4`,
            [job.session_id, artifactId, artifact.rows[0]?.expires_at, job.claimed_at]
          )
          if (updated.rowCount !== 1) throw new Error('archive_claim_lost')
          await client.query('COMMIT')
        } catch (error) {
          await rollback(client)
          throw error
        } finally {
          client.release()
        }
        options.onMetrics?.(1, expired)
        return 1
      } catch (error) {
        await recordArchiveFailure(pool, job)
        options.onError?.(error)
        options.onMetrics?.(0, expired)
        return 0
      }
    },

    async run(signal = new AbortController().signal) {
      while (!signal.aborted) {
        try {
          await this.processOnce()
        } catch (error) {
          options.onError?.(error)
        }
        await delay(pollIntervalMs, signal)
      }
    }
  }
}

async function claimArchive(pool: Pool): Promise<ClaimedArchive | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<ClaimedArchive>(
      `SELECT session_id, terminal_event_id, attempt_count, claimed_at
       FROM session_archive_jobs
       WHERE (status = 'pending' AND available_at <= now())
          OR (status = 'processing' AND claimed_at < now() - ${STALE_CLAIM_AFTER})
       ORDER BY available_at, created_at
       LIMIT 1
       FOR UPDATE SKIP LOCKED`
    )
    const job = result.rows[0]
    if (!job) {
      await client.query('COMMIT')
      return null
    }
    if (job.attempt_count >= MAX_ARCHIVE_ATTEMPTS) {
      await client.query(
        `UPDATE session_archive_jobs
         SET status = 'failed', claimed_at = NULL, last_error_code = 'archive_retry_exhausted', updated_at = now()
         WHERE session_id = $1`,
        [job.session_id]
      )
      await client.query('COMMIT')
      return null
    }
    const claimed = await client.query<ClaimedArchive>(
      `UPDATE session_archive_jobs
       SET status = 'processing', attempt_count = attempt_count + 1,
           claimed_at = date_trunc('milliseconds', now()), updated_at = now()
       WHERE session_id = $1
       RETURNING session_id, terminal_event_id, attempt_count, claimed_at`,
      [job.session_id]
    )
    await client.query('COMMIT')
    return claimed.rows[0] ?? null
  } catch (error) {
    await rollback(client)
    throw error
  } finally {
    client.release()
  }
}

async function readArchiveSource(pool: Pool, job: ClaimedArchive): Promise<ArchiveSource> {
  const result = await pool.query<ArchiveSource>(
    `SELECT session.tenant_id, session.subject_id, outcome.outcome, outcome.occurred_at
     FROM session_archive_jobs AS job
     JOIN app_sessions AS session ON session.session_id = job.session_id
     JOIN session_outcomes AS outcome
       ON outcome.session_id = job.session_id AND outcome.terminal_event_id = job.terminal_event_id
     WHERE job.session_id = $1 AND job.status = 'processing' AND job.claimed_at = $2`,
    [job.session_id, job.claimed_at]
  )
  const source = result.rows[0]
  if (!source) throw new Error('archive_source_missing')
  return source
}

async function readTranscript(pool: Pool, sessionId: string, source: ArchiveSource): Promise<string> {
  const result = await pool.query<TranscriptLine>(
    `SELECT speaker, occurred_at, content
     FROM session_transcript
     WHERE session_id = $1 AND speaker IN ('learner', 'patient')
     ORDER BY sequence, utterance_index
     LIMIT $2`,
    [sessionId, MAX_ARCHIVE_TURNS + 1]
  )
  return renderSessionTranscript(result.rows, source)
}

export function renderSessionTranscript(lines: TranscriptLine[], source: ArchiveSource): string {
  if (lines.length > MAX_ARCHIVE_TURNS) throw new Error('archive_turn_limit')
  const entries = lines
    .filter((line) => (line.speaker === 'learner' || line.speaker === 'patient') && typeof line.content === 'string')
    .map((line) => `${line.occurred_at.toISOString()} ${line.speaker === 'learner' ? 'Learner' : 'Patient'}: ${line.content}`)
  return [
    'GPTMD simulated encounter transcript',
    `Outcome: ${source.outcome}`,
    `Ended at: ${source.occurred_at.toISOString()}`,
    '',
    ...entries,
    ''
  ].join('\n')
}

async function recordArchiveFailure(pool: Pool, job: ClaimedArchive): Promise<void> {
  await pool.query(
    `UPDATE session_archive_jobs
     SET status = CASE WHEN attempt_count >= $3 THEN 'failed' ELSE 'pending' END,
         available_at = now() + make_interval(secs => LEAST(300, (2 ^ LEAST(attempt_count, 8))::integer)),
         claimed_at = NULL,
         last_error_code = CASE WHEN attempt_count >= $3 THEN 'archive_generation_failed' ELSE NULL END,
         updated_at = now()
     WHERE session_id = $1 AND status = 'processing' AND claimed_at = $2`,
    [job.session_id, job.claimed_at, MAX_ARCHIVE_ATTEMPTS]
  )
}

async function pruneExpiredArchives(pool: Pool): Promise<number> {
  const result = await pool.query(
    `DELETE FROM session_archive_artifacts WHERE expires_at <= now()`
  )
  return result.rowCount ?? 0
}

async function recordEngagement(
  client: PoolClient,
  event: {
    sessionId: string
    tenantId: string
    subjectId: string
    artifactId: string | null
    downloadId: string
    result: 'authorized' | 'denied' | 'expired' | 'failed'
    occurredAt: Date
  }
): Promise<void> {
  await client.query(
    `INSERT INTO download_engagement (
       engagement_id, session_id, tenant_id, subject_id, artifact_id, result,
       requested_at, completed_at, bytes_downloaded, download_id
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9)`,
    [randomUUID(), event.sessionId, event.tenantId, event.subjectId, event.artifactId,
      event.result, event.occurredAt, event.result === 'authorized' ? null : event.occurredAt, event.downloadId]
  )
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK')
  } catch {
    // Preserve the original persistence failure.
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms)
    function done() {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
    if (signal.aborted) done()
  })
}
