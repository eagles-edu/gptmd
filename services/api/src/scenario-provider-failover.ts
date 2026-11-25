import { PatientScenarioProviderError, type GeneratedPatientScenario } from './patient-profile.ts'

export async function generateScenarioWithFailover(
  primary: () => Promise<GeneratedPatientScenario>,
  fallback?: (availabilityError: PatientScenarioProviderError) => Promise<GeneratedPatientScenario>
): Promise<GeneratedPatientScenario> {
  try {
    return await primary()
  } catch (error) {
    if (!(error instanceof PatientScenarioProviderError) || !error.availabilityFailure || !fallback) throw error
    const generated = await fallback(error)
    return {
      ...generated,
      abandonedConversationIds: [...new Set([...error.conversationIds, ...generated.abandonedConversationIds])]
    }
  }
}
