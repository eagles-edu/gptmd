import { z } from 'zod'
import { educatorCatalogScenarioSource } from './educator-input-catalog.ts'
import type { ProviderTokenReservation } from './provider-token-reservations.ts'
import { ANTHROPIC_HAIKU_FAILOVER_MODEL, type AnthropicMessagesClient } from './anthropic-messages.ts'
import {
  buildPatientScenarioPrompt,
  isPatientScenarioConsistent,
  PatientScenarioProfileSchema,
  PatientScenarioValidationError,
  PATIENT_SCENARIO_MAX_OUTPUT_TOKENS,
  type GeneratedPatientScenario,
  type PatientScenarioVersionPins
} from './patient-profile.ts'
import { estimateAnthropicHaiku55Cost } from './provider-cost.ts'
import type { ProviderUsageSample } from './session-contracts.ts'

export async function generateAnthropicPatientScenario(
  client: AnthropicMessagesClient,
  versions: PatientScenarioVersionPins,
  asOf: Date,
  scenarioSeed: string,
  recordProviderUsage?: (usage: ProviderUsageSample) => Promise<void>,
  reserveProviderTokens?: (inputTokens: number, outputTokenCap: number) => Promise<ProviderTokenReservation>
): Promise<GeneratedPatientScenario> {
  const prompt = buildPatientScenarioPrompt(versions.promptVersion, scenarioSeed)
  const request = {
    model: ANTHROPIC_HAIKU_FAILOVER_MODEL,
    system: prompt.instructions,
    messages: [{
      role: 'user' as const,
      content: `${prompt.references.join('\n\n')}\n\n${prompt.userMessage}`
    }],
    outputConfig: {
      format: {
        type: 'json_schema' as const,
        schema: z.toJSONSchema(PatientScenarioProfileSchema)
      }
    }
  }
  let addonTokensUsed = false

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const inputTokens = await client.countInputTokens(request)
    const reservation = await reserveProviderTokens?.(inputTokens, PATIENT_SCENARIO_MAX_OUTPUT_TOKENS)
    const startedAt = performance.now()
    let response
    try {
      response = await client.createMessage({ ...request, maxTokens: PATIENT_SCENARIO_MAX_OUTPUT_TOKENS })
    } catch (error) {
      await reservation?.hold().catch(() => undefined)
      throw error
    }

    const inputCount = response.usage.input_tokens
    const outputCount = response.usage.output_tokens
    const totalTokens = inputCount + outputCount
    const cost = estimateAnthropicHaiku55Cost({
      model: response.model,
      inputTokens: inputCount,
      outputTokens: outputCount
    })
    const usage: ProviderUsageSample = {
      provider: 'anthropic',
      responseId: response.id,
      model: response.model,
      serviceTier: null,
      inputTokens: inputCount,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: outputCount,
      totalTokens,
      durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
      pricingVersion: cost?.pricingVersion ?? null,
      estimatedCostUsd: cost?.estimatedCostUsd ?? null
    }
    addonTokensUsed ||= await reservation?.settle(response.id, totalTokens) ?? false
    await recordProviderUsage?.(usage)

    if (response.stop_reason !== 'end_turn') continue
    const text = response.content.filter((part) => part.type === 'text')
      .map((part) => part.text ?? '').join('')
    try {
      const profile = PatientScenarioProfileSchema.parse(JSON.parse(text))
      if (!isPatientScenarioConsistent(profile, asOf)) continue
      return {
        conversationId: null,
        provider: 'anthropic',
        responseId: response.id,
        profile,
        usage,
        addonTokensUsed,
        abandonedConversationIds: [],
        ...(versions.promptVersion === 'patient-scenario-prompt-v15'
          ? { sourceContext: educatorCatalogScenarioSource(scenarioSeed) }
          : {})
      }
    } catch {
      continue
    }
  }

  throw new PatientScenarioValidationError([])
}
