export const OPENAI_PUBLIC_PRICING_VERSION = 'openai-api-pricing-2026-10-06'

type TokenRates = {
  input: number
  cachedInput: number
  cacheWrite: number
  output: number
}

type ModelRates = Record<'standard' | 'flex' | 'fast', { short: TokenRates; long: TokenRates }>

const GPT_6_LUNA_RATES: ModelRates = {
  standard: {
    short: { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.5 },
    long: { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 0.75 }
  },
  flex: {
    short: { input: 0.05, cachedInput: 0.005, cacheWrite: 0.0625, output: 0.25 },
    long: { input: 0.1, cachedInput: 0.01, cacheWrite: 0.125, output: 0.375 }
  },
  fast: {
    short: { input: 0.2, cachedInput: 0.02, cacheWrite: 0.25, output: 1 },
    long: { input: 0.4, cachedInput: 0.04, cacheWrite: 0.5, output: 1.5 }
  }
}

const TOKENS_PER_MILLION = 1_000_000
const LONG_CONTEXT_THRESHOLD = 272_000

export function estimateOpenAiResponseCost(input: {
  model: string
  serviceTier: string | null
  inputTokens: number
  cachedInputTokens: number
  cacheWriteTokens: number
  outputTokens: number
}): { pricingVersion: string; estimatedCostUsd: string } | null {
  if (input.model !== 'gpt-6-luna') return null
  const tier = input.serviceTier === 'default'
    ? 'standard'
    : input.serviceTier === 'flex'
      ? 'flex'
      : input.serviceTier === 'fast' || input.serviceTier === 'priority'
        ? 'fast'
        : null
  if (!tier) return null

  const rates = GPT_6_LUNA_RATES[tier][input.inputTokens > LONG_CONTEXT_THRESHOLD ? 'long' : 'short']
  const uncachedInputTokens = input.inputTokens - input.cachedInputTokens - input.cacheWriteTokens
  const cost = (
    uncachedInputTokens * rates.input +
    input.cachedInputTokens * rates.cachedInput +
    input.cacheWriteTokens * rates.cacheWrite +
    input.outputTokens * rates.output
  ) / TOKENS_PER_MILLION

  return {
    pricingVersion: OPENAI_PUBLIC_PRICING_VERSION,
    estimatedCostUsd: cost.toFixed(12)
  }
}
