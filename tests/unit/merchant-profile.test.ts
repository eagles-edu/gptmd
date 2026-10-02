import { describe, expect, it } from 'vitest'
import { merchantProfileFromConfig, moitConfirmationHref } from '../../app/utils/merchant-profile'

const completeConfig = {
  merchantLegalName: 'Example Company',
  merchantTaxId: 'TAX-123',
  merchantTaxIdIssued: '2026-01-01 · Hanoi',
  merchantAddress: '1 Example Street, Hanoi',
  merchantPhone: '+84000000000',
  supportEmail: 'support@example.test',
  moitVerificationUrl: 'https://online.gov.vn/confirmation/example'
}

describe('merchant public footer configuration', () => {
  it('requires every legal identity and support field before displaying a merchant profile', () => {
    expect(merchantProfileFromConfig(completeConfig)).toEqual({
      legalName: 'Example Company',
      taxId: 'TAX-123',
      taxIdIssued: '2026-01-01 · Hanoi',
      address: '1 Example Street, Hanoi',
      phone: '+84000000000',
      supportEmail: 'support@example.test'
    })
    expect(merchantProfileFromConfig({ ...completeConfig, merchantAddress: ' ' })).toBeNull()
  })

  it('only exposes an HTTPS MoIT confirmation URL with a complete merchant profile', () => {
    expect(moitConfirmationHref(completeConfig)).toBe(completeConfig.moitVerificationUrl)
    expect(moitConfirmationHref({ ...completeConfig, moitVerificationUrl: 'http://example.test' })).toBeNull()
    expect(moitConfirmationHref({ ...completeConfig, merchantPhone: '' })).toBeNull()
  })
})
