import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { createPatientScenarioConversationCleanupWorker } from '../../services/api/src/patient-scenario-conversation-cleanup-worker.ts'

describe('patient scenario Conversation cleanup worker', () => {
  it('claims due cleanup IDs and removes a purged Conversation from the queue', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ provider_conversation_id: 'conv-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
    const deleteConversation = vi.fn().mockResolvedValue(undefined)
    const onMetrics = vi.fn()
    const worker = createPatientScenarioConversationCleanupWorker(
      { query } as unknown as Pool,
      deleteConversation,
      { onMetrics }
    )

    await expect(worker.processOnce()).resolves.toBe(1)

    expect(query.mock.calls[0]?.[0]).toContain('FOR UPDATE SKIP LOCKED')
    expect(query.mock.calls[0]?.[0]).toContain("cleanup_claimed_at < now() - interval '1 minute'")
    expect(deleteConversation).toHaveBeenCalledWith('conv-1')
    expect(query.mock.calls[1]?.[0]).toContain('DELETE FROM app_patient_scenario_conversation_cleanup')
    expect(onMetrics).toHaveBeenCalledWith(1)
  })

  it('releases failed cleanup IDs for bounded exponential retry', async () => {
    const failure = new Error('provider unavailable')
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ provider_conversation_id: 'conv-2' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
    const onError = vi.fn()
    const worker = createPatientScenarioConversationCleanupWorker(
      { query } as unknown as Pool,
      vi.fn().mockRejectedValue(failure),
      { onError }
    )

    await expect(worker.processOnce()).resolves.toBe(0)

    expect(query.mock.calls[1]?.[0]).toContain('cleanup_attempts = cleanup_attempts + 1')
    expect(query.mock.calls[1]?.[0]).toContain('make_interval(secs => LEAST(300, (2 ^ LEAST(cleanup_attempts + 1, 8))::integer))')
    expect(onError).toHaveBeenCalledWith(failure)
  })
})
