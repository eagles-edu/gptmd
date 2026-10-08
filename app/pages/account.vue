<template>
  <section class="account-page" aria-labelledby="account-title">
    <p class="eyebrow">Account</p>
    <h1 id="account-title">Account Status</h1>
    <p class="intro">Your account overview brings together service usage, learning metrics, downloads, and payment access.</p>

    <div v-if="user" class="identity-row">
      <span>Signed in as {{ user.email || 'Google account' }}</span>
      <button type="button" class="sign-out" @click="signOut">Sign out</button>
    </div>
    <NuxtLink v-else-if="isConfigured" class="sign-in-link" to="/login?redirect=/account">Sign in with Google</NuxtLink>

    <section v-if="user && memberships.length" class="workspace-picker" aria-labelledby="workspace-title">
      <label id="workspace-title" for="workspace-select">GPTpatient workspace</label>
      <select id="workspace-select" v-model="selectedTenantId">
        <option v-for="(membership, index) in memberships" :key="membership.tenantId" :value="membership.tenantId">
          Workspace {{ index + 1 }}
        </option>
      </select>
    </section>
    <p v-if="selectedRoleLabel" class="membership-status" role="status">Your role in this workspace: {{ selectedRoleLabel }}<template v-if="selectedRole !== 'learner'">. Role-specific tools are not available yet.</template></p>
    <div v-if="user" class="membership-status" aria-live="polite">
      <span v-if="membershipState === 'loading'">Loading workspace access…</span>
      <span v-else-if="membershipState === 'ready' && memberships.length === 1">Workspace access is ready.</span>
      <span v-else-if="membershipState === 'ready' && memberships.length > 1">{{ memberships.length }} workspaces are available.</span>
      <button v-else-if="membershipState === 'error'" class="retry-button" type="button" @click="loadMemberships">Retry workspace access</button>
    </div>
    <v-alert v-if="membershipMessage" type="info" variant="tonal" class="connection-note">
      {{ membershipMessage }}
    </v-alert>

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
        <p>Choose prepaid access for 6 or 12 months. Renewals require a new checkout; payments do not renew automatically.</p>
        <p>ACB2Pay sandbox onboarding is in progress. No payment method is available in the app yet.</p>
        <div class="payment-actions">
          <a
            v-if="paymentCheckout6MonthUrl"
            class="action-link"
            :href="paymentCheckout6MonthUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            Continue to 6-month checkout <span aria-hidden="true">↗</span>
          </a>
          <span v-else class="status-label">6-month checkout not configured</span>
          <a
            v-if="paymentCheckout12MonthUrl"
            class="action-link"
            :href="paymentCheckout12MonthUrl"
            target="_blank"
            rel="noopener noreferrer"
          >
            Continue to 12-month checkout <span aria-hidden="true">↗</span>
          </a>
          <span v-else class="status-label">12-month checkout not configured</span>
        </div>
        <p v-if="hasPaymentCheckout" class="payment-activation-note">
          Payment confirmation and workspace access activation are not connected yet.
        </p>
        <p v-else>Payment access will be available after a payment provider is configured.</p>
        <p v-if="paymentPortalUrl">Open the secure payment portal to manage billing.</p>
        <a v-if="paymentPortalUrl" class="action-link" :href="paymentPortalUrl" target="_blank" rel="noreferrer">
          Open payment portal <span aria-hidden="true">↗</span>
        </a>
      </section>
    </div>

    <p class="privacy-note">Account and encounter details are not saved in browser storage.</p>
  </section>
</template>

<script setup lang="ts">
const { user, isConfigured, memberships, loadTenantMemberships, selectedTenantId, signOut } = useGptmdAuth()
const runtimeConfig = useRuntimeConfig()
const safePaymentUrl = (value: string): string => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.toString() : ''
  } catch {
    return ''
  }
}
const paymentPortalUrl = safePaymentUrl(runtimeConfig.public.paymentPortalUrl)
const paymentCheckout6MonthUrl = safePaymentUrl(runtimeConfig.public.paymentCheckout6MonthUrl)
const paymentCheckout12MonthUrl = safePaymentUrl(runtimeConfig.public.paymentCheckout12MonthUrl)
const hasPaymentCheckout = Boolean(paymentCheckout6MonthUrl || paymentCheckout12MonthUrl)
const tenantIds = computed(() => memberships.value.map((membership) => membership.tenantId))
const selectedRole = computed(() => memberships.value.find((membership) => membership.tenantId === selectedTenantId.value)?.role)
const selectedRoleLabel = computed(() => {
  const role = selectedRole.value
  return role === 'customer_admin' ? 'Customer administrator'
    : role === 'instructor' ? 'Instructor'
      : role === 'learner' ? 'Learner' : ''
})
const membershipMessage = ref('')
const membershipState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')

watch(selectedTenantId, (tenantId) => {
  if (membershipState.value === 'ready' && tenantId && tenantIds.value.includes(tenantId)) {
    membershipMessage.value = ''
  }
})

async function loadMemberships(): Promise<void> {
  if (!user.value) return
  membershipState.value = 'loading'
  membershipMessage.value = ''
  try {
    memberships.value = await loadTenantMemberships()
    if (selectedTenantId.value && !tenantIds.value.includes(selectedTenantId.value)) selectedTenantId.value = null
    if (tenantIds.value.length === 0) {
      membershipMessage.value = 'This Google account is signed in, but it has no active GPTpatient workspace. Contact support to request access.'
    } else if (tenantIds.value.length > 1 && !tenantIds.value.includes(selectedTenantId.value ?? '')) {
      membershipMessage.value = 'Choose the workspace you want to use before starting an encounter.'
    } else if (tenantIds.value.length === 1) {
      selectedTenantId.value = tenantIds.value[0] ?? null
    }
    membershipState.value = 'ready'
  } catch {
    membershipMessage.value = 'GPTpatient could not load your workspace access. Try again later.'
    membershipState.value = 'error'
  }
}

onMounted(loadMemberships)
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

.identity-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.85rem;
  margin: 1.3rem 0;
}

.sign-out,
.sign-in-link {
  background: #176d70;
  border: 0;
  border-radius: 0.55rem;
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-weight: 700;
  padding: 0.65rem 0.9rem;
  text-decoration: none;
}

.workspace-picker {
  display: grid;
  gap: 0.5rem;
  margin: 1rem 0 1.5rem;
  max-width: 32rem;
}

.workspace-picker label {
  font-weight: 750;
}

.workspace-picker select {
  background: var(--app-surface, #fff);
  border: 1px solid rgb(31 74 77 / 30%);
  border-radius: 0.5rem;
  color: inherit;
  font: inherit;
  min-height: 2.8rem;
  padding: 0.45rem 0.7rem;
}

.membership-status {
  color: var(--app-muted-text, #59696a);
  font-size: 0.9rem;
  min-height: 1.5rem;
}

.retry-button {
  background: transparent;
  border: 0;
  color: #176d70;
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  padding: 0;
  text-decoration: underline;
}

.retry-button:focus-visible {
  outline: 2px solid #176d70;
  outline-offset: 3px;
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

.payment-actions {
  display: grid;
  gap: 0.75rem;
  margin: 1rem 0;
}

.payment-activation-note {
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
