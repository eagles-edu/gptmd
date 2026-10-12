export type LiveVerificationCleanupResult = {
  deletedCount: number
  failedCount: number
  trackingFailureCount: number
}

type CleanupQuery = (sql: string, values?: unknown[]) => Promise<unknown>

/** Delete both the successful setup Conversation and any failed-attempt Conversations queued by setup. */
export async function cleanupLiveVerificationConversations(
  query: CleanupQuery,
  conversationIds: string[],
  deleteConversation: (conversationId: string) => Promise<void>
): Promise<LiveVerificationCleanupResult> {
  const result: LiveVerificationCleanupResult = {
    deletedCount: 0,
    failedCount: 0,
    trackingFailureCount: 0
  }

  for (const conversationId of new Set(conversationIds)) {
    try {
      await deleteConversation(conversationId)
      result.deletedCount += 1
      try {
        await query(
          `DELETE FROM app_patient_scenario_conversation_cleanup
           WHERE provider_conversation_id = $1`,
          [conversationId]
        )
      } catch {
        result.trackingFailureCount += 1
      }
    } catch {
      result.failedCount += 1
      try {
        await query(
          `INSERT INTO app_patient_scenario_conversation_cleanup (provider_conversation_id)
           VALUES ($1) ON CONFLICT (provider_conversation_id) DO NOTHING`,
          [conversationId]
        )
      } catch {
        result.trackingFailureCount += 1
      }
    }
  }

  return result
}
