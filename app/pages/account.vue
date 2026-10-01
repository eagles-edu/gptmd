<template>
  <section class="account-page" aria-labelledby="account-title">
    <p class="eyebrow">Account</p>
    <h1 id="account-title">Account Status</h1>
    <p class="intro">Your account overview brings together service usage, learning metrics, downloads, and payment access.</p>

    <v-alert class="connection-note" type="info" variant="tonal">
      Live account reporting is not connected yet. These sections will show data after the account reporting service is configured.
    </v-alert>

    <div class="account-grid">
      <section class="status-card" aria-labelledby="usage-title">
        <div class="card-heading"><span aria-hidden="true">◷</span><h2 id="usage-title">Usage</h2></div>
        <p class="status-label">Not available</p>
        <p>Session and response usage will appear here.</p>
      </section>
      <section class="status-card" aria-labelledby="metrics-title">
        <div class="card-heading"><span aria-hidden="true">↗</span><h2 id="metrics-title">Metrics</h2></div>
        <p class="status-label">Not available</p>
        <p>Practice activity and progress metrics will appear here.</p>
      </section>
      <section class="status-card" aria-labelledby="downloads-title">
        <div class="card-heading"><span aria-hidden="true">↓</span><h2 id="downloads-title">Downloads</h2></div>
        <p class="status-label">Not available</p>
        <p>Eligible encounter archives will appear here when downloads are connected.</p>
      </section>
      <section class="status-card payment-card" aria-labelledby="payment-title">
        <div class="card-heading"><span aria-hidden="true">$</span><h2 id="payment-title">Payment gateway</h2></div>
        <p v-if="paymentPortalUrl">Open the secure payment portal to manage billing.</p>
        <p v-else class="status-label">Not configured</p>
        <a v-if="paymentPortalUrl" class="action-link" :href="paymentPortalUrl" target="_blank" rel="noreferrer">
          Open payment portal <span aria-hidden="true">↗</span>
        </a>
        <p v-else>Payment access will be available after a payment provider is configured.</p>
      </section>
    </div>

    <p class="privacy-note">Account and encounter details are not saved in browser storage.</p>
  </section>
</template>

<script setup lang="ts">
const paymentPortalUrl = useRuntimeConfig().public.paymentPortalUrl
</script>

<style scoped>
.account-page {
  margin: 0 auto;
  max-width: 1080px;
  padding: clamp(2rem, 5vw, 4rem) 1.5rem;
}

.eyebrow {
  color: #267a75;
  font-size: 0.78rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  text-transform: uppercase;
}

h1 {
  font-size: clamp(2.2rem, 5vw, 3.5rem);
  letter-spacing: -0.04em;
  margin: 0.5rem 0;
}

.intro {
  color: var(--app-muted-text, #59696a);
  font-size: 1.08rem;
  line-height: 1.65;
  max-width: 65ch;
}

.connection-note {
  margin: 1.5rem 0;
}

.account-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 1.25rem;
}

.status-card {
  background: var(--app-surface, #fff);
  border: 1px solid rgb(31 74 77 / 14%);
  border-radius: 1rem;
  min-height: 10rem;
  padding: 1.4rem;
}

.card-heading {
  align-items: center;
  display: flex;
  gap: 0.7rem;
}

.card-heading > span {
  align-items: center;
  background: #e9f2ef;
  border-radius: 0.6rem;
  color: #216a68;
  display: inline-flex;
  font-size: 1.15rem;
  font-weight: 800;
  height: 2.5rem;
  justify-content: center;
  width: 2.5rem;
}

h2 {
  font-size: 1.15rem;
  margin: 0;
}

.status-card p {
  color: var(--app-muted-text, #59696a);
  line-height: 1.55;
}

.status-card .status-label {
  color: #705920;
  font-size: 0.85rem;
  font-weight: 800;
  margin-bottom: -0.35rem;
}

.action-link {
  color: #176d70;
  font-weight: 700;
}

.privacy-note {
  color: var(--app-muted-text, #59696a);
  font-size: 0.9rem;
  margin-top: 1.25rem;
}

@media (width <= 680px) {
  .account-grid {
    grid-template-columns: 1fr;
  }
}
</style>
