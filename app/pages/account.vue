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

    <section v-if="user && memberships.length > 1" class="workspace-picker" aria-labelledby="workspace-title">
      <label id="workspace-title" for="workspace-select">GPTpatient workspace</label>
      <select id="workspace-select" v-model="selectedTenantId">
        <option :value="null" disabled>Choose a workspace</option>
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
    <AiTimeBudgetControls v-if="selectedRole === 'customer_admin' && selectedTenantId" :tenant-id="selectedTenantId" />
    <div v-if="user" class="membership-status" aria-live="polite">
      <span v-if="membershipState === 'loading'">Loading workspace access…</span>
      <span v-else-if="membershipState === 'ready' && memberships.length === 1">Workspace membership loaded.</span>
      <span v-else-if="membershipState === 'ready' && memberships.length > 1">{{ memberships.length }} workspaces are available.</span>
      <button v-else-if="membershipState === 'error'" class="retry-button" type="button" @click="loadMemberships">Retry workspace access</button>
    </div>
    <v-alert v-if="membershipMessage" type="info" variant="tonal" class="connection-note">
      {{ membershipMessage }}
    </v-alert>

    <div class="account-grid">
      <section class="status-card" aria-labelledby="usage-title">
        <div class="card-heading"><span aria-hidden="true">◷</span><h2 id="usage-title">Usage</h2></div>
        <template v-if="selectedRole === 'learner'">
          <p v-if="usageState === 'loading'" class="status-label">Loading usage…</p>
          <template v-else-if="learnerUsage">
            <p class="status-label">{{ formatTokenCount(learnerUsage.usage.totalTokens) }} provider tokens this UTC month</p>
            <p>{{ learnerUsage.usage.responseCount }} recorded provider responses</p>
            <p class="usage-period">Usage period: {{ learnerUsage.periodStart.slice(0, 10) }} to {{ learnerUsage.periodEnd.slice(0, 10) }}.</p>
          </template>
          <template v-else>
            <p class="status-label">{{ usageState === 'error' ? 'Usage unavailable' : 'Usage not loaded' }}</p>
            <p>{{ usageMessage || 'Choose a learner workspace to view personal usage.' }}</p>
            <button v-if="selectedTenantId" type="button" class="retry-button" @click="loadUsage">Refresh usage</button>
          </template>
        </template>
        <p v-else-if="selectedRole === 'customer_admin'">Organization and group usage is shown in the workspace budget controls.</p>
        <p v-else>Personal usage is available in a learner workspace.</p>
      </section>
      <section v-if="selectedRole === 'learner'" class="status-card token-buckets" aria-labelledby="token-buckets-title">
        <div class="card-heading"><span aria-hidden="true">◫</span><h2 id="token-buckets-title">Token balances</h2></div>
        <p v-if="bucketState === 'loading'">Loading balances…</p>
        <p v-else-if="bucketState === 'error'" role="status">Balances are unavailable. <button type="button" class="retry-button" @click="loadTokenBuckets">Retry</button></p>
        <p v-else-if="tokenBuckets.length === 0">No active token grants are configured for this account and workspace. Purchases remain unavailable until payment confirmation is connected.</p>
        <ul v-else class="bucket-list">
          <li v-for="(bucket, index) in tokenBuckets" :key="`${bucket.accountScope}-${bucket.bucketKind}-${bucket.groupCode || 'personal'}-${bucket.expiresAt}-${index}`">
            <div class="bucket-heading">
              <strong>{{ bucketLabel(bucket) }}</strong>
              <span>{{ formatTokenCount(bucket.remainingTokens) }} remaining</span>
            </div>
            <progress :value="bucketUsed(bucket)" :max="Number(bucket.grantedTokens)" :aria-label="`${bucketLabel(bucket)} usage`" />
            <p>{{ formatTokenCount(bucket.usedTokens) }} used of {{ formatTokenCount(bucket.grantedTokens) }} tokens<template v-if="Number(bucket.reservedTokens) > 0"> · {{ formatTokenCount(bucket.reservedTokens) }} reserved</template></p>
            <p v-if="bucket.renewalAt" class="usage-period">Renews {{ formatArchiveDate(bucket.renewalAt) }} · unused included tokens expire at renewal.</p>
            <p class="usage-period">Expires {{ formatArchiveDate(bucket.expiresAt) }} · {{ bucket.daysRemaining }} days left.</p>
          </li>
        </ul>
      </section>
      <section v-if="selectedRole === 'learner'" class="status-card usage-ledger" aria-labelledby="usage-ledger-title">
        <div class="card-heading"><span aria-hidden="true">≡</span><h2 id="usage-ledger-title">Usage ledger</h2></div>
        <p v-if="ledgerState === 'loading'">Loading recent provider usage…</p>
        <p v-else-if="ledgerState === 'error'" role="status">Usage history is unavailable. <button type="button" class="retry-button" @click="loadUsageLedger">Retry</button></p>
        <p v-else-if="usageLedger.length === 0">No provider usage has been recorded for this workspace member.</p>
        <div v-else class="table-wrap">
          <table class="usage-table">
            <thead><tr><th scope="col">Date</th><th scope="col">Session</th><th scope="col">Activity</th><th scope="col">Provider</th><th scope="col">Tokens</th></tr></thead>
            <tbody>
              <tr v-for="entry in usageLedger" :key="`${entry.sessionId}-${entry.occurredAt}-${entry.operation}`">
                <td><time :datetime="entry.occurredAt">{{ formatArchiveDate(entry.occurredAt) }}</time></td>
                <td>{{ entry.sessionId.slice(0, 8) }}</td>
                <td>{{ entry.operation === 'scenario_generation' ? 'Scenario setup' : 'Patient response' }}</td>
                <td>{{ entry.provider }}</td>
                <td>{{ formatTokenCount(entry.totalTokens) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="usage-period">Latest 100 recorded provider calls. Included and add-on balances are separate; current balances and expiry dates require the entitlement ledger.</p>
      </section>
      <section class="status-card" aria-labelledby="metrics-title">
        <div class="card-heading"><span aria-hidden="true">↗</span><h2 id="metrics-title">Metrics</h2></div>
        <p class="status-label">Not available</p>
        <p>Practice activity and progress metrics will appear here.</p>
      </section>
      <section class="status-card" aria-labelledby="downloads-title">
        <div class="card-heading"><span aria-hidden="true">↓</span><h2 id="downloads-title">Downloads</h2></div>
        <template v-if="selectedRole === 'learner'">
          <p v-if="archiveMessage" class="membership-status" role="status">{{ archiveMessage }}</p>
          <p v-if="archiveState === 'loading'" class="status-label">Loading archives…</p>
          <p v-else-if="archiveState === 'error'" class="status-label">Archives unavailable</p>
          <p v-else-if="archives.length === 0">No completed session archives are available.</p>
          <ul v-else class="archive-list" aria-label="Session archives">
            <li v-for="archive in archives" :key="archive.archiveId">
              <div class="archive-details">
                <strong>{{ archiveLabel(archive) }}</strong>
                <span>{{ archiveStatusLabel(archive.status) }}</span>
                <time v-if="archive.downloadExpiresAt" :datetime="archive.downloadExpiresAt">
                  Expires {{ formatArchiveDate(archive.downloadExpiresAt) }}
                </time>
              </div>
              <button
                v-if="archive.status === 'available'"
                type="button"
                class="retry-button"
                :disabled="downloadingArchiveId === archive.sessionId"
                @click="downloadArchive(archive)"
              >
                {{ downloadingArchiveId === archive.sessionId ? 'Preparing…' : 'Download archive' }}
              </button>
            </li>
          </ul>
          <button v-if="archiveState !== 'loading'" type="button" class="retry-button" @click="loadArchives">
            Refresh archives
          </button>
        </template>
        <p v-else class="membership-status">Session archives are available to learners in their selected workspace.</p>
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

    <section v-if="user" class="token-store" aria-labelledby="token-store-title">
      <div class="section-heading">
        <div>
          <p class="eyebrow">TEAECL token plans</p>
          <h2 id="token-store-title">Plans and add-ons</h2>
        </div>
        <button type="button" class="retry-button" :disabled="storeState === 'loading'" @click="loadStorefront">
          Refresh offers
        </button>
      </div>
      <p class="membership-status">Checkout is unavailable until payment confirmation is configured. Viewing an offer does not grant token credit.</p>
      <p v-if="storeState === 'loading'" class="status-label">Loading offers…</p>
      <p v-else-if="storeState === 'error'" class="status-label" role="alert">Token offers are unavailable. Try refreshing.</p>
      <p v-else-if="storefrontProducts.length === 0" class="status-label">No published offers are available.</p>
      <div v-else class="table-wrap">
        <table class="store-table">
          <thead><tr><th scope="col">Offer</th><th scope="col">Included tokens</th><th scope="col">Price</th><th scope="col">Availability</th></tr></thead>
          <tbody>
            <tr v-for="product in storefrontProducts" :key="product.code">
              <th scope="row">
                <span>{{ productName(product) }}</span>
                <small v-if="product.description">{{ product.description }}</small>
              </th>
              <td>{{ formatTokenCount(String(product.tokens)) }}</td>
              <td>{{ formatProductPrice(product) }}</td>
              <td>Checkout unavailable</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

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
interface SessionArchive {
  archiveId: string
  sessionId: string
  updatedAt: string
  status: 'pending' | 'building' | 'available' | 'failed' | 'expired'
  artifactId: string | null
  downloadExpiresAt: string | null
  errorCode: string | null
}
interface LearnerUsage {
  periodStart: string
  periodEnd: string
  usage: { totalTokens: string; responseCount: number }
}
interface UsageLedgerEntry {
  occurredAt: string
  sessionId: string
  provider: string
  operation: 'scenario_generation' | 'patient_turn'
  totalTokens: string
}
interface TokenBucket {
  accountScope: 'consumer' | 'organization'
  bucketKind: 'included' | 'addon'
  groupCode: string | null
  grantedTokens: string
  usedTokens: string
  reservedTokens: string
  remainingTokens: string
  renewalAt: string | null
  expiresAt: string
  daysRemaining: number
}
interface StoreProduct {
  code: string
  name?: string
  description?: string
  kind: 'monthly_tier' | 'token_addon'
  tokens: number
  priceMinor: number | null
  currency: string | null
}
interface ConsumerStorefront {
  revision: number
  currency: string | null
  products: StoreProduct[]
  checkoutEnabled: false
}
const learnerUsage = ref<LearnerUsage | null>(null)
const usageState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const usageMessage = ref('')
const usageLedger = ref<UsageLedgerEntry[]>([])
const ledgerState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const tokenBuckets = ref<TokenBucket[]>([])
const bucketState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const storefront = ref<ConsumerStorefront | null>(null)
const storeState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const storefrontProducts = computed(() => storefront.value?.products ?? [])
const archives = ref<SessionArchive[]>([])
const archiveState = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
const archiveMessage = ref('')
const downloadingArchiveId = ref<string | null>(null)
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
    await loadArchives()
    await loadUsage()
    await loadUsageLedger()
    await loadTokenBuckets()
  } catch {
    membershipMessage.value = 'GPTpatient could not load your workspace access. Try again later.'
    membershipState.value = 'error'
  }
}

async function loadArchives(): Promise<void> {
  if (selectedRole.value !== 'learner' || !selectedTenantId.value) {
    archives.value = []
    archiveState.value = 'idle'
    archiveMessage.value = ''
    return
  }
  archiveState.value = 'loading'
  archiveMessage.value = ''
  try {
    const config = useRuntimeConfig()
    const result = await $fetch<{ archives: SessionArchive[] }>(
      `${String(config.public.apiBase).replace(/\/$/, '')}/api/account/archives`,
      { headers: await useGptmdAuth().accessHeaders() }
    )
    archives.value = result.archives
    archiveState.value = 'ready'
  } catch {
    archiveState.value = 'error'
    archiveMessage.value = 'Transcript archives could not be loaded. Try refreshing.'
  }
}

async function loadUsage(): Promise<void> {
  if (selectedRole.value !== 'learner' || !selectedTenantId.value) {
    learnerUsage.value = null
    usageState.value = 'idle'
    usageMessage.value = ''
    return
  }
  learnerUsage.value = null
  usageState.value = 'loading'
  usageMessage.value = ''
  try {
    const config = useRuntimeConfig()
    learnerUsage.value = await $fetch<LearnerUsage>(
      `${String(config.public.apiBase).replace(/\/$/, '')}/api/account/usage`,
      { headers: await useGptmdAuth().accessHeaders() }
    )
    usageState.value = 'ready'
  } catch {
    usageState.value = 'error'
    usageMessage.value = 'Personal token usage could not be loaded. Try refreshing.'
  }
}

async function loadUsageLedger(): Promise<void> {
  if (selectedRole.value !== 'learner' || !selectedTenantId.value) {
    usageLedger.value = []
    ledgerState.value = 'idle'
    return
  }
  ledgerState.value = 'loading'
  try {
    const config = useRuntimeConfig()
    const result = await $fetch<{ entries: UsageLedgerEntry[] }>(
      `${String(config.public.apiBase).replace(/\/$/, '')}/api/account/usage-ledger`,
      { headers: await useGptmdAuth().accessHeaders() }
    )
    usageLedger.value = result.entries
    ledgerState.value = 'ready'
  } catch {
    usageLedger.value = []
    ledgerState.value = 'error'
  }
}

async function loadTokenBuckets(): Promise<void> {
  if (selectedRole.value !== 'learner' || !selectedTenantId.value) {
    tokenBuckets.value = []
    bucketState.value = 'idle'
    return
  }
  bucketState.value = 'loading'
  try {
    const config = useRuntimeConfig()
    const result = await $fetch<{ buckets: TokenBucket[] }>(
      `${String(config.public.apiBase).replace(/\/$/, '')}/api/account/token-buckets`,
      { headers: await useGptmdAuth().accessHeaders() }
    )
    tokenBuckets.value = result.buckets
    bucketState.value = 'ready'
  } catch {
    tokenBuckets.value = []
    bucketState.value = 'error'
  }
}

function bucketLabel(bucket: TokenBucket): string {
  if (bucket.bucketKind === 'addon') {
    return bucket.accountScope === 'organization'
      ? `Organization add-on${bucket.groupCode ? ` · ${bucket.groupCode}` : ''}`
      : 'Personal add-on tokens'
  }
  return bucket.accountScope === 'organization'
    ? `Organization monthly allowance${bucket.groupCode ? ` · ${bucket.groupCode}` : ''}`
    : 'Monthly included allowance'
}

function bucketUsed(bucket: TokenBucket): number {
  return Math.min(Number(bucket.grantedTokens), Number(bucket.usedTokens) + Number(bucket.reservedTokens))
}

function formatTokenCount(value: string): string {
  return Number(value).toLocaleString()
}

async function loadStorefront(): Promise<void> {
  if (!user.value) return
  storeState.value = 'loading'
  try {
    const config = useRuntimeConfig()
    const result = await $fetch<{ storefront: ConsumerStorefront }>(
      `${String(config.public.apiBase).replace(/\/$/, '')}/api/store/consumer-tokens`,
      { headers: await useGptmdAuth().accessHeaders(false) }
    )
    storefront.value = result.storefront
    storeState.value = 'ready'
  } catch {
    storefront.value = null
    storeState.value = 'error'
  }
}

function productName(product: StoreProduct): string {
  return product.name || product.code.charAt(0).toUpperCase() + product.code.slice(1)
}

function formatProductPrice(product: StoreProduct): string {
  if (product.priceMinor == null || !product.currency) return 'Price not set'
  const fractionDigits = new Intl.NumberFormat(undefined, {
    style: 'currency', currency: product.currency
  }).resolvedOptions().maximumFractionDigits ?? 2
  const amount = product.priceMinor / (10 ** fractionDigits)
  return new Intl.NumberFormat(undefined, {
    style: 'currency', currency: product.currency
  }).format(amount)
}

function archiveLabel(archive: SessionArchive): string {
  return `Encounter ${archive.sessionId.slice(0, 8)}`
}

function archiveStatusLabel(status: SessionArchive['status']): string {
  return status === 'pending' ? 'Queued'
    : status === 'building' ? 'Preparing'
      : status === 'available' ? 'Ready to download'
        : status === 'expired' ? 'Expired' : 'Unavailable'
}

function formatArchiveDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

async function downloadArchive(archive: SessionArchive): Promise<void> {
  downloadingArchiveId.value = archive.sessionId
  archiveMessage.value = ''
  try {
    const config = useRuntimeConfig()
    const result = await fetch(
      `${String(config.public.apiBase).replace(/\/$/, '')}/api/sessions/${encodeURIComponent(archive.sessionId)}/archive/download`,
      { headers: await useGptmdAuth().accessHeaders() }
    )
    if (!result.ok) throw new Error('download_unavailable')
    const blob = await result.blob()
    const extension = result.headers.get('content-type')?.includes('application/zip') ? 'zip' : 'txt'
    const filename = result.headers.get('content-disposition')?.match(/filename="([A-Za-z0-9._-]+)"/)?.[1]
      ?? `gptmd-session-${archive.sessionId.slice(0, 8)}.${extension}`
    const objectUrl = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = filename
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
    archiveMessage.value = 'Session archive download started.'
  } catch {
    archiveMessage.value = 'Session archive could not be downloaded. Refresh the archive list and try again.'
    await loadArchives()
  } finally {
    downloadingArchiveId.value = null
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

onMounted(() => {
  void loadMemberships()
  void loadStorefront()
})
watch(selectedTenantId, () => { void loadEntitlements() })
watch(selectedTenantId, () => { void loadArchives() })
watch(selectedTenantId, () => { void loadUsage() })
watch(selectedTenantId, () => { void loadUsageLedger() })
watch(selectedTenantId, () => { void loadTokenBuckets() })
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

.token-store {
  border-top: 1px solid rgb(31 74 77 / 18%);
  margin-top: 2rem;
  padding-top: 1.5rem;
}

.store-table {
  border-collapse: collapse;
  margin-top: 1rem;
  min-width: 38rem;
  text-align: left;
  width: 100%;
}

.store-table th,
.store-table td {
  border-bottom: 1px solid rgb(31 74 77 / 16%);
  padding: 0.8rem 0.65rem;
  vertical-align: top;
}

.store-table th[scope="row"] span,
.store-table th[scope="row"] small {
  display: block;
}

.store-table th[scope="row"] small {
  color: var(--app-muted-text, #59696a);
  font-size: 0.85rem;
  font-weight: 400;
  margin-top: 0.2rem;
  max-width: 34rem;
  overflow-wrap: anywhere;
}

.status-card {
  background: var(--app-surface, #fff);
  border: 1px solid rgb(31 74 77 / 14%);
  border-radius: 1rem;
  min-height: 10rem;
  padding: 1.4rem;
}

.usage-ledger {
  grid-column: 1 / -1;
  min-width: 0;
}

.token-buckets {
  grid-column: 1 / -1;
  min-width: 0;
}

.bucket-list {
  display: grid;
  gap: 0 1.5rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  list-style: none;
  margin: 1rem 0 0;
  padding: 0;
}

.bucket-list li {
  border-top: 1px solid rgb(31 74 77 / 16%);
  min-width: 0;
  padding: 1rem 0;
}

.bucket-heading {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  justify-content: space-between;
}

.bucket-list progress {
  accent-color: #277b71;
  display: block;
  height: 0.7rem;
  margin: 0.8rem 0 0.4rem;
  width: 100%;
}

.bucket-list p {
  margin: 0.35rem 0;
}

.usage-table {
  border-collapse: collapse;
  min-width: 38rem;
  text-align: left;
  width: 100%;
}

.usage-table th,
.usage-table td {
  border-bottom: 1px solid rgb(31 74 77 / 16%);
  padding: 0.65rem;
  vertical-align: top;
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

.archive-list {
  list-style: none;
  margin: 1rem 0;
  padding: 0;
}

.archive-list li {
  align-items: center;
  border-top: 1px solid rgb(31 74 77 / 16%);
  display: flex;
  flex-wrap: wrap;
  gap: 0.85rem;
  justify-content: space-between;
  min-width: 0;
  padding: 0.75rem 0;
}

.archive-details {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

.archive-details strong,
.archive-details span,
.archive-details time {
  overflow-wrap: anywhere;
}

.archive-details span,
.archive-details time {
  color: var(--app-muted-text, #59696a);
  font-size: 0.85rem;
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

  .bucket-list {
    grid-template-columns: 1fr;
  }

  .entitlement-grid {
    grid-template-columns: 1fr;
  }
}
</style>
