import { describe, expect, it } from 'vitest'
import {
  estimateAnthropicHaiku55Cost,
  estimateOpenAiResponseCost,
  OPENAI_PUBLIC_PRICING_VERSION
} from '../../services/api/src/provider-cost.ts'

describe('OpenAI public response cost estimates', () => {
  it('applies Haiku 5.5 pricing by provider-reported prompt length', () => {
    expect(estimateAnthropicHaiku55Cost({
      model: 'claude-haiku-5-5', inputTokens: 100_000, outputTokens: 1_000_000
    })).toEqual({
      pricingVersion: 'anthropic-api-pricing-2026-10-17', estimatedCostUsd: '0.510000000000'
    })
    expect(estimateAnthropicHaiku55Cost({
      model: 'claude-haiku-5-5', inputTokens: 100_001, outputTokens: 1_000_000
    })).toEqual({
      pricingVersion: 'anthropic-api-pricing-2026-10-17', estimatedCostUsd: '2.550000500000'
    })
    expect(estimateAnthropicHaiku55Cost({ model: 'unknown', inputTokens: 1, outputTokens: 1 })).toBeNull()
  })

  it('prices uncached, cached, cache-write, and output tokens on the standard tier', () => {
    expect(estimateOpenAiResponseCost({
      model: 'gpt-6-luna', serviceTier: 'default',
      inputTokens: 1_000, cachedInputTokens: 100, cacheWriteTokens: 200, outputTokens: 500
    })).toEqual({
      pricingVersion: OPENAI_PUBLIC_PRICING_VERSION,
      estimatedCostUsd: '0.000346000000'
    })
  })

  it('uses long-context rates only above the published context threshold', () => {
    expect(estimateOpenAiResponseCost({
      model: 'gpt-6-luna', serviceTier: 'default',
      inputTokens: 272_000, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 0
    })?.estimatedCostUsd).toBe('0.027200000000')
    expect(estimateOpenAiResponseCost({
      model: 'gpt-6-luna', serviceTier: 'default',
      inputTokens: 272_001, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 1
    })?.estimatedCostUsd).toBe('0.054400950000')
  })

  it('leaves cost unattributed when no supported public rate matches the response', () => {
    const usage = {
      inputTokens: 10, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 2
    }
    expect(estimateOpenAiResponseCost({ ...usage, model: 'unknown-model', serviceTier: 'default' })).toBeNull()
    expect(estimateOpenAiResponseCost({ ...usage, model: 'gpt-6-luna', serviceTier: 'auto' })).toBeNull()
  })
})
