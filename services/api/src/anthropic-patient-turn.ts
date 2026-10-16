import { z } from 'zod'
import type { ProviderTokenReservation } from './provider-token-reservations.ts'
import { ANTHROPIC_HAIKU_FAILOVER_MODEL, type AnthropicMessagesClient } from './anthropic-messages.ts'
import { PatientTurnModelOutputSchema, PATIENT_TURN_INSTRUCTIONS, PATIENT_TURN_MAX_OUTPUT_TOKENS, matchHistoryCueFields, matchPainCueFields, type PatientTurnGenerationContext } from './patient-turn.ts'
import type { ProviderUsageSample } from './session-contracts.ts'
import { estimateAnthropicHaiku55Cost } from './provider-cost.ts'

const AnthropicPatientTurnSchema = z.object({
  responseId: z.string(),
  output: PatientTurnModelOutputSchema,
  providerUsage: z.custom<ProviderUsageSample>(),
  provider: z.literal('anthropic')
})

export async function generateAnthropicPatientTurn(
  client: AnthropicMessagesClient,
  context: PatientTurnGenerationContext,
  reserveProviderTokens?: (inputTokens: number, outputTokenCap: number) => Promise<ProviderTokenReservation>
): Promise<z.infer<typeof AnthropicPatientTurnSchema>> {
  const matchedFields = new Set(matchHistoryCueFields(context.learnerMessage))
  const matchedPainFields = new Set(matchPainCueFields(context.learnerMessage))
  const acceptedHistory = new Map(context.acceptedTurns.flatMap((turn) => turn.patientReportedFacts)
    .map((fact) => [fact.field, fact]))
  const acceptedPain = new Map(context.acceptedTurns.flatMap((turn) => turn.patientReportedPainFacts)
    .map((fact) => [`${fact.painEpisodeId}:${fact.field}`, fact]))
  const relevantHistory = context.profile.history.filter((entry) => matchedFields.has(entry.field)).map((entry) => {
    const accepted = acceptedHistory.get(entry.field)
    return accepted ? { field: entry.field, status: 'known', value: accepted.value } : entry
  })
  const relevantPainEpisodes = matchedPainFields.size > 0 ? context.profile.painEpisodes.map((episode) => ({
    painEpisodeId: episode.episodeId,
    patientDescription: episode.patientDescription,
    currentStatus: episode.currentStatus,
    details: episode.details.filter((detail) => matchedPainFields.has(detail.field)).map((detail) => {
      const accepted = acceptedPain.get(`${episode.episodeId}:${detail.field}`)
      return accepted ? { field: detail.field, status: 'known', value: accepted.value } : detail
    })
  })) : []
  const input = {
    phase: context.phase,
    matchedHistoryTopics: [...matchedFields],
    matchedPainTopics: [...matchedPainFields],
    versions: context.versions,
    correctionRequested: context.retryAfterValidationFailure === true,
    patientScenario: {
      fullName: context.profile.fullName,
      dateOfBirth: context.profile.dateOfBirth,
      reasonForVisit: context.profile.reasonForVisit,
      currentPregnancyStatus: context.profile.currentPregnancyStatus,
      currentMenopausalStatus: context.profile.currentMenopausalStatus,
      persona: context.profile.persona,
      relevantHistory,
      painHistoryStatus: matchedPainFields.size > 0 ? context.profile.painHistoryStatus : undefined,
      relevantPainEpisodes
    },
    acceptedTranscript: context.acceptedTurns.map((turn) => ({
      learner: turn.learnerMessage,
      patient: turn.patientResponse
    })),
    latestLearnerMessage: context.learnerMessage
  }
  const request = {
    model: ANTHROPIC_HAIKU_FAILOVER_MODEL,
    system: PATIENT_TURN_INSTRUCTIONS,
    messages: [{ role: 'user' as const, content: JSON.stringify(input) }],
    outputConfig: {
      format: {
        type: 'json_schema' as const,
        schema: z.toJSONSchema(PatientTurnModelOutputSchema)
      }
    }
  }
  const inputTokens = await client.countInputTokens(request)
  const reservation = await reserveProviderTokens?.(inputTokens, PATIENT_TURN_MAX_OUTPUT_TOKENS)
  const startedAt = performance.now()
  let response
  try {
    response = await client.createMessage({ ...request, maxTokens: PATIENT_TURN_MAX_OUTPUT_TOKENS })
  } catch (error) {
    await reservation?.hold().catch(() => undefined)
    throw error
  }
  const usage = response.usage
  const totalTokens = usage.input_tokens + usage.output_tokens
  const cost = estimateAnthropicHaiku55Cost({
    model: response.model,
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens
  })
  const providerUsage: ProviderUsageSample = {
    provider: 'anthropic',
    responseId: response.id,
    model: response.model,
    serviceTier: null,
    inputTokens: usage.input_tokens,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: usage.output_tokens,
    totalTokens,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    pricingVersion: cost?.pricingVersion ?? null,
    estimatedCostUsd: cost?.estimatedCostUsd ?? null
  }
  await reservation?.settle(providerUsage.responseId, providerUsage.totalTokens)
  if (response.stop_reason !== 'end_turn') throw new Error('Anthropic patient turn was incomplete or refused')
  const text = response.content.filter((part) => part.type === 'text')
    .map((part) => part.text ?? '').join('')
  return AnthropicPatientTurnSchema.parse({
    responseId: response.id,
    output: PatientTurnModelOutputSchema.parse(JSON.parse(text)),
    providerUsage,
    provider: 'anthropic'
  })
}
