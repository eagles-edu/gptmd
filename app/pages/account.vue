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
          Workspace {{ index + 1 }} ({{ roleLabel(membership.role) }})
        </option>
      </select>
    </section>
    <p v-if="selectedRoleLabel" class="membership-status" role="status">Your role in this workspace: {{ selectedRoleLabel }}<template v-if="selectedRole !== 'learner'">. Visit setup is available to learners only.</template></p>
    <p v-if="selectedRole === 'learner' && selectedMembership" class="membership-status" role="status">
      {{ visitEntitled ? 'Visit setup is included in this workspace. Remaining quota is checked when you begin.' : 'Visit setup is not enabled for this workspace. Contact your workspace administrator.' }}
    </p>
    <p v-if="selectedRole === 'learner' && selectedMembership" class="membership-status" role="status">
      {{ selectedMembership.audioTranscriptionAvailable ? 'Voice transcription is available for this workspace.' : 'Voice transcription is unavailable for this workspace. Transcript mode remains available.' }}
    </p>
    <section v-if="selectedRole === 'customer_admin' && selectedTenantId" class="entitlement-controls" aria-labelledby="entitlement-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">Workspace controls</p>
          <h2 id="entitlement-title">Entitlements and limits</h2>
        </div>
        <button type="button" class="retry-button" :disabled="entitlementState === 'loading' || entitlementState === 'saving'" @click="saveEntitlements">
          {{ entitlementState === 'saving' ? 'Saving…' : 'Save changes' }}
        </button>
      </div>
      <p v-if="entitlementMessage" class="membership-status" role="status">{{ entitlementMessage }}</p>
      <div v-if="entitlementPolicy" class="entitlement-grid">
        <fieldset>
          <legend>Access</legend>
          <label><input v-model="entitlementPolicy.sessionsEnabled" type="checkbox"> Allow visit setup</label>
          <label><input v-model="entitlementPolicy.responsesEnabled" type="checkbox"> Allow patient responses</label>
          <label><input v-model="entitlementPolicy.audioTranscriptionEnabled" type="checkbox"> Allow voice transcription</label>
          <label><input v-model="entitlementPolicy.audioTranscriptionPrivacyApproved" type="checkbox"> Privacy approval recorded for voice</label>
        </fieldset>
        <fieldset>
          <legend>Usage limits</legend>
          <label v-for="field in quotaFields" :key="field.key" class="limit-field">
            <span>{{ field.label }}</span>
            <input
              :value="entitlementPolicy[field.key] ?? ''"
              type="number"
              min="0"
              step="1"
              inputmode="numeric"
              @input="setEntitlementLimit(field.key, $event)"
            >
            <small>Blank means unlimited</small>
          </label>
        </fieldset>
      </div>
    </section>
    <div v-if="user" class="membership-status" aria-live="polite">
      <span v-if="membershipState === 'loading'">Loading workspace access…</span>
      <span v-else-if="membershipState === 'ready' && memberships.length === 1">Workspace membership loaded.</span>
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
const selectedMembership = computed(() => memberships.value.find((membership) => membership.tenantId === selectedTenantId.value))
const selectedRole = computed(() => selectedMembership.value?.role)
const visitEntitled = computed(() => Boolean(selectedMembership.value?.sessionsEnabled && selectedMembership.value.responsesEnabled))
const roleLabel = (role: string | undefined): string => {
  return role === 'customer_admin' ? 'Customer administrator'
    : role === 'instructor' ? 'Instructor'
      : role === 'learner' ? 'Learner' : ''
}
const selectedRoleLabel = computed(() => roleLabel(selectedRole.value))
const membershipMessage = ref('')
const membershipState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
type EntitlementLimitKey = 'monthlySessionQuota' | 'monthlySessionQuotaPerUser' | 'monthlyResponseQuota' |
  'monthlyResponseQuotaPerUser' | 'responseQuotaPerSession' | 'maxActiveSessions' | 'monthlyAudioTranscriptionSessionQuota'
interface EntitlementPolicy {
  sessionsEnabled: boolean
  responsesEnabled: boolean
  monthlySessionQuota: number | null
  monthlySessionQuotaPerUser: number | null
  monthlyResponseQuota: number | null
  monthlyResponseQuotaPerUser: number | null
  responseQuotaPerSession: number | null
  maxActiveSessions: number | null
  audioTranscriptionEnabled: boolean
  audioTranscriptionPrivacyApproved: boolean
  monthlyAudioTranscriptionSessionQuota: number | null
}
const quotaFields: Array<{ key: EntitlementLimitKey; label: string }> = [
  { key: 'monthlySessionQuota', label: 'Visits per workspace / month' },
  { key: 'monthlySessionQuotaPerUser', label: 'Visits per learner / month' },
  { key: 'monthlyResponseQuota', label: 'Responses per workspace / month' },
  { key: 'monthlyResponseQuotaPerUser', label: 'Responses per learner / month' },
  { key: 'responseQuotaPerSession', label: 'Responses per visit' },
  { key: 'maxActiveSessions', label: 'Concurrent visits' },
  { key: 'monthlyAudioTranscriptionSessionQuota', label: 'Voice sessions per month' }
]
const entitlementPolicy = ref<EntitlementPolicy | null>(null)
const entitlementState = ref<'idle' | 'loading' | 'saving' | 'error'>('idle')
const entitlementMessage = ref('')

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
    await loadEntitlements()
  } catch {
    membershipMessage.value = 'GPTpatient could not load your workspace access. Try again later.'
    membershipState.value = 'error'
  }
}

async function loadEntitlements(): Promise<void> {
  if (selectedRole.value !== 'customer_admin' || !selectedTenantId.value) {
    entitlementPolicy.value = null
    return
  }
  entitlementState.value = 'loading'
  try {
    const config = useRuntimeConfig()
    const result = await $fetch<{ policy: EntitlementPolicy }>(
      `${String(config.public.apiBase).replace(/\/$/, '')}/api/admin/entitlements`,
      { headers: await useGptmdAuth().accessHeaders() }
    )
    entitlementPolicy.value = result.policy
    entitlementMessage.value = ''
    entitlementState.value = 'idle'
  } catch {
    entitlementMessage.value = 'Workspace controls could not be loaded. Try again.'
    entitlementState.value = 'error'
  }
}

function setEntitlementLimit(key: EntitlementLimitKey, event: Event): void {
  if (!entitlementPolicy.value) return
  const raw = (event.target as HTMLInputElement).value
  entitlementPolicy.value[key] = raw === '' ? null : Number(raw)
}

async function saveEntitlements(): Promise<void> {
  if (!entitlementPolicy.value || !selectedTenantId.value) return
  entitlementState.value = 'saving'
  entitlementMessage.value = ''
  try {
    const config = useRuntimeConfig()
    const result = await $fetch<{ policy: EntitlementPolicy }>(
      `${String(config.public.apiBase).replace(/\/$/, '')}/api/admin/entitlements`,
      {
        method: 'PUT',
        headers: await useGptmdAuth().accessHeaders(),
        body: entitlementPolicy.value
      }
    )
    entitlementPolicy.value = result.policy
    entitlementState.value = 'idle'
    await loadMemberships()
    entitlementMessage.value = 'Entitlement policy saved and applied.'
  } catch {
    entitlementMessage.value = 'Entitlement policy was not saved. Check the limits and try again.'
    entitlementState.value = 'error'
  }
}

onMounted(loadMemberships)
watch(selectedTenantId, () => { void loadEntitlements() })
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

.entitlement-controls {
  border-top: 1px solid rgb(31 74 77 / 18%);
  margin: 2rem 0;
  padding-top: 1.25rem;
}

.section-heading {
  align-items: end;
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: space-between;
}

.section-heading h2 {
  font-size: 1.35rem;
  margin: 0.25rem 0 0;
}

.entitlement-grid {
  display: grid;
  gap: 2rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-top: 1rem;
}

.entitlement-grid fieldset {
  border: 1px solid rgb(31 74 77 / 22%);
  display: grid;
  gap: 0.85rem;
  min-width: 0;
  padding: 1rem;
}

.entitlement-grid legend {
  font-weight: 750;
  padding: 0 0.35rem;
}

.entitlement-grid fieldset > label:not(.limit-field) {
  align-items: flex-start;
  display: flex;
  gap: 0.6rem;
}

.limit-field {
  display: grid;
  gap: 0.35rem;
}

.limit-field input {
  border: 1px solid rgb(31 74 77 / 30%);
  color: inherit;
  font: inherit;
  min-height: 2.5rem;
  padding: 0.4rem 0.55rem;
  width: 100%;
}

.limit-field small {
  color: var(--app-muted-text, #59696a);
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

  .entitlement-grid {
    grid-template-columns: 1fr;
  }
}
</style>
