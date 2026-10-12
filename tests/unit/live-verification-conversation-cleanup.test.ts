import { describe, expect, it, vi } from 'vitest'
import { cleanupLiveVerificationConversations } from '../../services/api/src/live-verification-conversation-cleanup.ts'

describe('live verification provider Conversation cleanup', () => {
  it('deletes the active and queued failed-attempt Conversations once each', async () => {
    const query = vi.fn(async () => undefined)
    const deleteConversation = vi.fn(async () => undefined)

    const result = await cleanupLiveVerificationConversations(
      query,
      ['conv-success', 'conv-failed-attempt', 'conv-success'],
      deleteConversation
    )

    expect(deleteConversation.mock.calls).toEqual([
      ['conv-success'], ['conv-failed-attempt']
    ])
    expect(query).toHaveBeenCalledTimes(2)
    expect(query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM app_patient_scenario_conversation_cleanup'), ['conv-success'])
    expect(query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM app_patient_scenario_conversation_cleanup'), ['conv-failed-attempt'])
    expect(result).toEqual({ deletedCount: 2, failedCount: 0, trackingFailureCount: 0 })
  })

  it('keeps a failed provider deletion durably queued for retry', async () => {
    const query = vi.fn(async () => undefined)
    const deleteConversation = vi.fn(async () => { throw new Error('provider unavailable') })

    const result = await cleanupLiveVerificationConversations(query, ['conv-retry'], deleteConversation)

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO app_patient_scenario_conversation_cleanup'),
      ['conv-retry']
    )
    expect(result).toEqual({ deletedCount: 0, failedCount: 1, trackingFailureCount: 0 })
  })

  it('reports when cleanup state cannot be recorded so the verifier can preserve its database', async () => {
    const query = vi.fn(async () => { throw new Error('database unavailable') })
    const deleteConversation = vi.fn(async () => { throw new Error('provider unavailable') })

    const result = await cleanupLiveVerificationConversations(query, ['conv-untracked'], deleteConversation)

    expect(result).toEqual({ deletedCount: 0, failedCount: 1, trackingFailureCount: 1 })
  })
})
