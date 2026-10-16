import { describe, expect, it } from 'vitest'
import {
  parseConsumerTokenCatalog,
  projectConsumerStoreCatalog,
  type ConsumerTokenCatalog
} from '../../services/api/src/consumer-token-catalog.ts'

const catalog: ConsumerTokenCatalog = {
  schemaVersion: 1,
  revision: 3,
  baseMonthlyTokens: 125_000,
  currency: 'USD',
  tiers: [
    { code: 'lunar', monthlyPriceMinor: 1000, status: 'published' },
    { code: 'solar', monthlyPriceMinor: 2000, status: 'published' },
    { code: 'stellar', monthlyPriceMinor: null, status: 'draft' }
  ],
  addOns: [
    { code: 'small-pack', name: 'Small pack', description: 'Extra tokens', tokens: 10_000, priceMinor: 500, status: 'published' },
    { code: 'future-pack', name: 'Future pack', description: '', tokens: 20_000, priceMinor: null, status: 'draft' }
  ]
}

describe('consumer token catalog contract', () => {
  it('derives Lunar, Solar, and Stellar monthly grants from a single base amount', () => {
    const storefront = projectConsumerStoreCatalog(catalog)
    expect(storefront.products.map(({ code, tokens }) => [code, tokens])).toEqual([
      ['lunar', 125_000], ['solar', 250_000], ['small-pack', 10_000]
    ])
    expect(storefront.checkoutEnabled).toBe(false)
    expect(storefront.products.some(({ code }) => code === 'stellar')).toBe(false)
  })

  it('rejects publishing without a price and duplicate add-on codes', () => {
    expect(parseConsumerTokenCatalog({
      ...catalog,
      tiers: [
        { code: 'lunar', monthlyPriceMinor: null, status: 'published' },
        catalog.tiers[1], catalog.tiers[2]
      ]
    })).toBeNull()
    expect(parseConsumerTokenCatalog({
      ...catalog,
      addOns: [catalog.addOns[0], { ...catalog.addOns[0], name: 'Duplicate code' }]
    })).toBeNull()
  })

  it('does not expose draft products or accept client-controlled provider/model settings', () => {
    expect(parseConsumerTokenCatalog({
      ...catalog, provider: 'customer-choice', model: 'customer-choice'
    })).toBeNull()
    expect(projectConsumerStoreCatalog(catalog).products.map(({ code }) => code))
      .not.toContain('future-pack')
  })
})
