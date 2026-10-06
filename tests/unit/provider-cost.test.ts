import { describe, expect, it } from 'vitest'
import {
  estimateOpenAiResponseCost,
  OPENAI_PUBLIC_PRICING_VERSION
} from '../../services/api/src/provider-cost.ts'

describe('OpenAI public response cost estimates', () => {
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
