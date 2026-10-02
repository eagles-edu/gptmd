<template>
  <footer class="site-footer">
    <section v-if="merchantProfile" class="merchant-details" aria-label="Merchant information">
      <strong>{{ merchantProfile.legalName }}</strong>
      <span>Tax ID: {{ merchantProfile.taxId }}</span>
      <span>Tax ID issued {{ merchantProfile.taxIdIssued }}</span>
      <span>{{ merchantProfile.address }}</span>
      <a :href="`tel:${merchantProfile.phone}`">{{ merchantProfile.phone }}</a>
      <a :href="`mailto:${merchantProfile.supportEmail}`">{{ merchantProfile.supportEmail }}</a>
      <a
        v-if="moitHref"
        :href="moitHref"
        target="_blank"
        rel="noopener noreferrer"
      >
        MoIT confirmation
      </a>
    </section>
    <div class="footer-copy">
      <span>GPTpatient · OBGYN standardized-patient practice</span>
      <span>Fictional training scenarios; not a clinical record or medical advice.</span>
    </div>
    <nav aria-label="Policies" class="policy-links">
      <NuxtLink to="/privacy">Privacy</NuxtLink>
      <NuxtLink to="/terms">Terms</NuxtLink>
      <NuxtLink to="/service-provision">Service provision</NuxtLink>
      <NuxtLink to="/refunds">Refunds and cancellation</NuxtLink>
    </nav>
  </footer>
</template>

<script setup lang="ts">
import { merchantProfileFromConfig, moitConfirmationHref } from '~/utils/merchant-profile'

const { public: publicConfig } = useRuntimeConfig()
const merchantConfig = {
  merchantLegalName: String(publicConfig.merchantLegalName || ''),
  merchantTaxId: String(publicConfig.merchantTaxId || ''),
  merchantTaxIdIssued: String(publicConfig.merchantTaxIdIssued || ''),
  merchantAddress: String(publicConfig.merchantAddress || ''),
  merchantPhone: String(publicConfig.merchantPhone || ''),
  supportEmail: String(publicConfig.supportEmail || ''),
  moitVerificationUrl: String(publicConfig.moitVerificationUrl || '')
}
const merchantProfile = merchantProfileFromConfig(merchantConfig)
const moitHref = moitConfirmationHref(merchantConfig)
</script>

<style scoped>
.site-footer {
  align-items: center;
  border-top: 1px solid var(--app-border);
  color: var(--app-text-muted);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.84rem;
  gap: 0.5rem 1.5rem;
  justify-content: space-between;
  margin: 2rem auto 0;
  max-width: 1280px;
  padding: 1.2rem 1rem 1.6rem;
}

.footer-copy {
  display: grid;
  gap: 0.35rem;
}

.merchant-details {
  display: grid;
  flex-basis: 100%;
  gap: 0.3rem;
  line-height: 1.45;
}

.merchant-details a {
  color: inherit;
  text-underline-offset: 0.2em;
}

.policy-links {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
}

.policy-links a {
  color: inherit;
  text-underline-offset: 0.2em;
}
</style>
