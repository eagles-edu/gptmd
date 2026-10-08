import type { Pool } from 'pg'

type DueConversation = { provider_conversation_id: string }
const CLEANUP_CONCURRENCY = 5

export type PatientScenarioConversationCleanupWorker = {
  processOnce(): Promise<number>
  run(signal?: AbortSignal): Promise<void>
}

export function createPatientScenarioConversationCleanupWorker(
  pool: Pool,
  deleteConversation: (conversationId: string) => Promise<void>,
  options: {
    batchSize?: number
    pollIntervalMs?: number
    onError?: (error: unknown) => void
    onMetrics?: (completedConversations: number) => void
  } = {}
): PatientScenarioConversationCleanupWorker {
  const batchSize = options.batchSize ?? 20
  const pollIntervalMs = options.pollIntervalMs ?? 1_000

  return {
    async processOnce() {
      const result = await pool.query<DueConversation>(
        `WITH due AS (
           SELECT provider_conversation_id
           FROM app_patient_scenario_conversation_cleanup
           WHERE cleanup_next_attempt_at <= now()
             AND (cleanup_claimed_at IS NULL OR cleanup_claimed_at < now() - interval '1 minute')
           ORDER BY cleanup_next_attempt_at, created_at
           FOR UPDATE SKIP LOCKED
           LIMIT $1
         )
         UPDATE app_patient_scenario_conversation_cleanup AS cleanup
         SET cleanup_claimed_at = now()
         FROM due
         WHERE cleanup.provider_conversation_id = due.provider_conversation_id
         RETURNING cleanup.provider_conversation_id`,
        [batchSize]
      )
      let completed = 0
      for (let offset = 0; offset < result.rows.length; offset += CLEANUP_CONCURRENCY) {
        const batch = result.rows.slice(offset, offset + CLEANUP_CONCURRENCY)
        const outcomes = await Promise.all(batch.map(async ({ provider_conversation_id: id }) => {
          try {
            await deleteConversation(id)
            await pool.query(
              `DELETE FROM app_patient_scenario_conversation_cleanup
               WHERE provider_conversation_id = $1`,
              [id]
            )
            return true
          } catch (error) {
            await pool.query(
              `UPDATE app_patient_scenario_conversation_cleanup
               SET cleanup_attempts = cleanup_attempts + 1,
                   cleanup_next_attempt_at = now() + make_interval(secs => LEAST(300, (2 ^ LEAST(cleanup_attempts + 1, 8))::integer)),
                   cleanup_claimed_at = NULL
               WHERE provider_conversation_id = $1`,
              [id]
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
