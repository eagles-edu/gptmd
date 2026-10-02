export interface MerchantProfileConfig {
  merchantLegalName: string
  merchantTaxId: string
  merchantTaxIdIssued: string
  merchantAddress: string
  merchantPhone: string
  supportEmail: string
  moitVerificationUrl: string
}

export interface MerchantProfile {
  legalName: string
  taxId: string
  taxIdIssued: string
  address: string
  phone: string
  supportEmail: string
}

export function merchantProfileFromConfig(config: MerchantProfileConfig): MerchantProfile | null {
  const values = [
    config.merchantLegalName,
    config.merchantTaxId,
    config.merchantTaxIdIssued,
    config.merchantAddress,
    config.merchantPhone,
    config.supportEmail
  ].map((value) => value.trim())

  if (values.some((value) => value.length === 0)) return null

  const [legalName, taxId, taxIdIssued, address, phone, supportEmail] = values
  if (!legalName || !taxId || !taxIdIssued || !address || !phone || !supportEmail) return null

  return { legalName, taxId, taxIdIssued, address, phone, supportEmail }
}

export function moitConfirmationHref(config: MerchantProfileConfig): string | null {
  const href = config.moitVerificationUrl.trim()
  return merchantProfileFromConfig(config) && href.startsWith('https://') ? href : null
}
