import type { Pool } from 'pg'

type DueCall = { grant_id: string; provider_call_id: string }
const CALL_CONCURRENCY = 5

export type AudioTranscriptionExpiryWorker = {
  processOnce(): Promise<number>
  run(signal?: AbortSignal): Promise<void>
}

export function createAudioTranscriptionExpiryWorker(
  pool: Pool,
  hangupCall: (providerCallId: string) => Promise<void>,
  options: {
    batchSize?: number
    pollIntervalMs?: number
    onError?: (error: unknown) => void
    onMetrics?: (completedCalls: number) => void
  } = {}
): AudioTranscriptionExpiryWorker {
  const batchSize = options.batchSize ?? 20
  const pollIntervalMs = options.pollIntervalMs ?? 1_000

  return {
    async processOnce() {
      const result = await pool.query<DueCall>(
        `WITH due AS (
           SELECT grant_id
           FROM app_audio_transcription_sessions
           WHERE provider_call_id IS NOT NULL
             AND disconnected_at IS NULL
             AND disconnect_after <= now()
             AND disconnect_next_attempt_at <= now()
             AND (disconnect_claimed_at IS NULL OR disconnect_claimed_at < now() - interval '1 minute')
           ORDER BY disconnect_after
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE app_audio_transcription_sessions AS audio
         SET disconnect_claimed_at = now()
         FROM due
         WHERE audio.grant_id = due.grant_id
         RETURNING audio.grant_id, audio.provider_call_id`,
        [batchSize]
      )
      let completed = 0
      for (let offset = 0; offset < result.rows.length; offset += CALL_CONCURRENCY) {
        const batch = result.rows.slice(offset, offset + CALL_CONCURRENCY)
        const outcomes = await Promise.all(batch.map(async (call) => {
          try {
            await hangupCall(call.provider_call_id)
            await pool.query(
              `UPDATE app_audio_transcription_sessions
               SET disconnected_at = now(), disconnect_claimed_at = NULL
               WHERE grant_id = $1 AND provider_call_id = $2 AND disconnected_at IS NULL`,
              [call.grant_id, call.provider_call_id]
            )
            return true
          } catch (error) {
            await pool.query(
              `UPDATE app_audio_transcription_sessions
               SET disconnect_attempts = disconnect_attempts + 1,
                   disconnect_next_attempt_at = now() + make_interval(secs => LEAST(300, (2 ^ LEAST(disconnect_attempts + 1, 8))::integer)),
                   disconnect_claimed_at = NULL
               WHERE grant_id = $1 AND provider_call_id = $2 AND disconnected_at IS NULL`,
              [call.grant_id, call.provider_call_id]
            )
            options.onError?.(error)
            return false
          }
        }))
        completed += outcomes.filter(Boolean).length
      }
      options.onMetrics?.(completed)
      return completed
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
