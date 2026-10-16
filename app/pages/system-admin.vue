<template>
  <main class="system-admin" aria-labelledby="system-admin-title">
    <header class="page-header">
      <div>
        <p class="eyebrow">Platform operations</p>
        <h1 id="system-admin-title">GPTMD Systems</h1>
      </div>
      <div class="header-actions">
        <span class="overall-status" :class="overallState" role="status">
          <span class="status-dot" aria-hidden="true" />{{ overallLabel }}
        </span>
        <button class="icon-button" type="button" aria-label="Refresh system status" title="Refresh system status" :disabled="loading" @click="refresh">
          <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.4-3" /></svg>
        </button>
      </div>
    </header>

    <p v-if="!isConfigured" class="notice">Authentication is not configured.</p>
    <NuxtLink v-else-if="!user" class="sign-in-link" to="/login?redirect=/system-admin">Sign in to continue</NuxtLink>
    <p v-else-if="accessDenied" class="notice error" role="alert">This account is not authorized for GPTMD platform operations.</p>
    <p v-else-if="errorMessage" class="notice error" role="alert">{{ errorMessage }}</p>

    <template v-if="user && !accessDenied">
      <p v-if="operatorMissing" class="notice" role="status">
        The restricted host operator is unavailable. Status from the API process is shown where possible; logs and service controls are disabled.
      </p>
      <p v-if="actionMessage" class="notice" role="status">{{ actionMessage }}</p>

      <section class="dependency-section" aria-labelledby="dependency-title">
        <div class="section-heading"><h2 id="dependency-title">Dependencies</h2><span v-if="observedAt">Updated {{ formatDate(observedAt) }}</span></div>
        <div class="dependency-grid">
          <div v-for="dependency in dependencies" :key="dependency.name" class="dependency-row">
            <span class="dependency-name">{{ dependency.name }}</span>
            <span class="state-value" :class="stateClass(dependency.status)"><span class="status-dot" aria-hidden="true" />{{ dependency.status }}</span>
          </div>
        </div>
      </section>

      <section class="catalog-section" aria-labelledby="catalog-title">
        <div class="section-heading">
          <div>
            <h2 id="catalog-title">Consumer token catalog</h2>
            <p class="catalog-note">TEAECL-managed offers only. Checkout is disabled; learners and hospital administrators cannot change AI settings or provider routing.</p>
          </div>
          <button class="text-button" type="button" :disabled="catalogState === 'loading' || catalogState === 'saving'" @click="saveCatalog">
            {{ catalogState === 'saving' ? 'Saving…' : 'Save catalog' }}
          </button>
        </div>
        <p v-if="catalogMessage" class="catalog-message" role="status">{{ catalogMessage }}</p>
        <p v-if="catalogState === 'loading'" class="empty-state">Loading catalog…</p>
        <form v-else class="catalog-form" @submit.prevent="saveCatalog">
          <div class="catalog-fields">
            <label>
              <span>Lunar base tokens per month</span>
              <input v-model.number="catalog.baseMonthlyTokens" type="number" min="1" max="715827882" step="1" required>
            </label>
            <label>
              <span>Store currency (ISO 4217)</span>
              <input v-model.trim="catalog.currency" type="text" minlength="3" maxlength="3" pattern="[A-Z]{3}" required>
            </label>
          </div>
          <div class="table-wrap">
            <table class="catalog-table">
              <thead><tr><th scope="col">Monthly tier</th><th scope="col">Included tokens</th><th scope="col">Price (minor units)</th><th scope="col">Catalog status</th></tr></thead>
              <tbody>
                <tr v-for="tier in catalog.tiers" :key="tier.code">
                  <th scope="row">{{ tier.code }}</th>
                  <td>{{ formatCount(catalog.baseMonthlyTokens * tierMultipliers[tier.code]) }}</td>
                  <td><input :value="tier.monthlyPriceMinor ?? ''" type="number" min="0" step="1" :aria-label="`${tier.code} monthly price in minor units`" @input="setTierPrice(tier, $event)"></td>
                  <td><select v-model="tier.status" :aria-label="`${tier.code} catalog status`"><option value="draft">Draft</option><option value="published">Published</option></select></td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="section-heading addon-heading">
            <h3>Add-on token packages</h3>
            <button class="text-button" type="button" @click="addCatalogAddOn">Add package</button>
          </div>
          <div v-if="catalog.addOns.length" class="table-wrap">
            <table class="catalog-table addon-table">
              <thead><tr><th scope="col">Code</th><th scope="col">Name</th><th scope="col">Description</th><th scope="col">Tokens</th><th scope="col">Price</th><th scope="col">Status</th><th scope="col"><span class="visually-hidden">Remove</span></th></tr></thead>
              <tbody>
                <tr v-for="(product, index) in catalog.addOns" :key="`${product.code}-${index}`">
                  <td><input v-model.trim="product.code" type="text" maxlength="40" :aria-label="`Package ${index + 1} code`"></td>
                  <td><input v-model.trim="product.name" type="text" maxlength="100" :aria-label="`Package ${index + 1} name`"></td>
                  <td><input v-model.trim="product.description" type="text" maxlength="500" :aria-label="`Package ${index + 1} description`"></td>
                  <td><input v-model.number="product.tokens" type="number" min="1" step="1" :aria-label="`Package ${index + 1} token amount`"></td>
                  <td><input :value="product.priceMinor ?? ''" type="number" min="0" step="1" :aria-label="`Package ${index + 1} price in minor units`" @input="setAddOnPrice(product, $event)"></td>
                  <td><select v-model="product.status" :aria-label="`Package ${index + 1} status`"><option value="draft">Draft</option><option value="published">Published</option></select></td>
                  <td><button class="icon-button danger" type="button" :aria-label="`Remove package ${product.name || index + 1}`" title="Remove package" @click="catalog.addOns.splice(index, 1)"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 14h12l1-14M9 7V4h6v3" /></svg></button></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-else class="catalog-note">No add-on packages configured.</p>
          <p class="catalog-note">Published means eligible for future storefront display only. No purchase or credit grant is enabled without verified ACB2Pay confirmation.</p>
        </form>
      </section>

      <section class="service-section" aria-labelledby="service-title">
        <div class="section-heading"><h2 id="service-title">Services</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th scope="col">Service</th><th scope="col">State</th><th scope="col">Memory</th><th scope="col">CPU</th><th scope="col">Restarts</th><th scope="col">Active since</th><th scope="col"><span class="visually-hidden">Actions</span></th></tr></thead>
            <tbody>
              <tr v-for="service in serviceRows" :key="service.name">
                <th scope="row">{{ service.label }}</th>
                <td><span class="state-value" :class="stateClass(service.activeState)"><span class="status-dot" aria-hidden="true" />{{ service.activeState }}<small v-if="service.subState !== 'running'"> · {{ service.subState }}</small></span></td>
                <td>{{ formatBytes(service.memoryBytes) }}</td>
                <td>{{ formatCpu(service.cpuNanoseconds) }}</td>
                <td>{{ service.restartCount }}</td>
                <td>{{ service.activeSince ? formatDate(service.activeSince) : '—' }}</td>
                <td class="row-actions">
                  <button class="icon-button" type="button" :aria-label="`View ${service.label} logs`" :title="`View ${service.label} logs`" :disabled="!operatorAvailable" @click="openLogs(service.name)">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 5h14M5 10h14M5 15h9M5 20h9" /></svg>
                  </button>
                  <button class="icon-button danger" type="button" :aria-label="`Restart ${service.label}`" :title="`Restart ${service.label}`" :disabled="!operatorAvailable || actionBusy" @click="restartService(service.name)">
                    <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5.6 9A7 7 0 0 1 18 6l2 2M4 16l2 2a7 7 0 0 0 12.4-3" /></svg>
                  </button>
                </td>
              </tr>
              <tr v-if="serviceRows.length === 0"><td colspan="7" class="empty-state">{{ loading ? 'Loading service status…' : 'Service status is unavailable.' }}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="performance-section" aria-labelledby="performance-title">
        <div class="section-heading"><h2 id="performance-title">API process</h2><span>Sampled at {{ formatInterval(apiProcess?.intervalMs) }}</span></div>
        <div class="metric-grid">
          <div class="metric"><span>CPU</span><strong>{{ apiProcess ? `${apiProcess.cpuPercentOfOneCore.toFixed(1)}%` : '—' }}</strong></div>
          <div class="metric"><span>Resident memory</span><strong>{{ formatBytes(apiProcess?.rssBytes ?? null) }}</strong></div>
          <div class="metric"><span>Heap used</span><strong>{{ formatBytes(apiProcess?.heapUsedBytes ?? null) }}</strong></div>
          <div class="metric"><span>External memory</span><strong>{{ formatBytes(apiProcess?.externalBytes ?? null) }}</strong></div>
        </div>
      </section>

      <section class="logs-section" aria-labelledby="logs-title">
        <div class="section-heading log-heading">
          <h2 id="logs-title">Service logs</h2>
          <div class="log-actions">
            <label class="visually-hidden" for="log-service">Service</label>
            <select id="log-service" v-model="selectedLogService" :disabled="!operatorAvailable" @change="loadLogs">
              <option value="web">Web</option><option value="api">API</option><option value="worker">Worker</option>
            </select>
            <button class="text-button" type="button" :disabled="!operatorAvailable || logsLoading" @click="loadLogs">Refresh logs</button>
            <button class="text-button" type="button" :disabled="!operatorAvailable || actionBusy" @click="rotateLogs">Rotate journal</button>
          </div>
        </div>
        <p v-if="logsMessage" class="log-message" role="status">{{ logsMessage }}</p>
        <div class="log-list" aria-live="polite">
          <div v-for="(entry, index) in logs" :key="`${entry.timestamp}-${index}`" class="log-entry">
            <time :datetime="entry.timestamp">{{ formatDate(entry.timestamp) }}</time>
            <span class="log-priority" :class="priorityClass(entry.priority)">{{ priorityLabel(entry.priority) }}</span>
            <span v-if="entry.event" class="log-event">{{ entry.event }}</span>
            <code>{{ entry.message }}</code>
          </div>
          <p v-if="logs.length === 0" class="empty-state">{{ logsLoading ? 'Loading logs…' : 'No sanitized structured logs loaded.' }}</p>
        </div>
      </section>
    </template>
  </main>
</template>

<script setup lang="ts">
type ServiceName = 'web' | 'api' | 'worker'
type SystemUnit = {
  service: ServiceName
  activeState: string
  subState: string
  activeSince: string | null
  restartCount: number
  memoryBytes: number | null
  cpuNanoseconds: number | null
}
type SystemLog = { timestamp: string; priority: number | null; event: string | null; message: string }
type ProcessSample = { intervalMs: number; cpuPercentOfOneCore: number; rssBytes: number; heapUsedBytes: number; externalBytes: number }
type Overview = {
  observedAt: string
  operatorAvailable: boolean
  systemdUnits: SystemUnit[]
  apiProcess: ProcessSample | null
  dependencies: Record<string, string>
}
type ConsumerCatalog = {
  schemaVersion: 1
  revision: number
  baseMonthlyTokens: number
  currency: string
  tiers: [
    { code: 'lunar'; monthlyPriceMinor: number | null; status: 'draft' | 'published' },
    { code: 'solar'; monthlyPriceMinor: number | null; status: 'draft' | 'published' },
    { code: 'stellar'; monthlyPriceMinor: number | null; status: 'draft' | 'published' }
  ]
  addOns: Array<{
    code: string
    name: string
    description: string
    tokens: number
    priceMinor: number | null
    status: 'draft' | 'published'
  }>
}

useHead({ title: 'GPTMD Systems' })
const config = useRuntimeConfig()
const { user, session, isConfigured, accessHeaders } = useGptmdAuth()
const overview = ref<Overview | null>(null)
const logs = ref<SystemLog[]>([])
const selectedLogService = ref<ServiceName>('api')
const loading = ref(false)
const logsLoading = ref(false)
const actionBusy = ref(false)
const accessDenied = ref(false)
const errorMessage = ref('')
const actionMessage = ref('')
const logsMessage = ref('')
const catalog = ref<ConsumerCatalog>(emptyCatalog())
const catalogState = ref<'idle' | 'loading' | 'saving' | 'error'>('idle')
const catalogMessage = ref('')
const tierMultipliers = { lunar: 1, solar: 2, stellar: 3 } as const
let refreshTimer: ReturnType<typeof setInterval> | undefined

const observedAt = computed(() => overview.value?.observedAt ?? null)
const operatorAvailable = computed(() => Boolean(overview.value?.operatorAvailable))
const operatorMissing = computed(() => Boolean(overview.value && !overview.value.operatorAvailable))
const apiProcess = computed(() => overview.value?.apiProcess ?? null)
const dependencies = computed(() => Object.entries(overview.value?.dependencies ?? {}).map(([name, status]) => ({
  name: name === 'postgres' ? 'PostgreSQL' : name === 'redis' ? 'Redis' : name === 'openai' ? 'OpenAI' : 'Authentication',
  status
})))
const serviceRows = computed(() => {
  const byName = new Map(overview.value?.systemdUnits.map((service) => [service.service, service]) ?? [])
  return (['web', 'api', 'worker'] as const).map((name) => ({
    name,
    label: name === 'web' ? 'Web' : name === 'api' ? 'API' : 'Worker',
    activeState: byName.get(name)?.activeState ?? 'unavailable',
    subState: byName.get(name)?.subState ?? 'unknown',
    activeSince: byName.get(name)?.activeSince ?? null,
    restartCount: byName.get(name)?.restartCount ?? 0,
    memoryBytes: byName.get(name)?.memoryBytes ?? null,
    cpuNanoseconds: byName.get(name)?.cpuNanoseconds ?? null
  }))
})
const overallState = computed(() => {
  if (accessDenied.value || errorMessage.value) return 'error'
  const statuses = [...dependencies.value.map(({ status }) => status), ...serviceRows.value.map(({ activeState }) => activeState)]
  if (statuses.length === 0 || statuses.includes('unavailable')) return 'unknown'
  return statuses.every((status) => status === 'ready' || status === 'configured' || status === 'active') ? 'healthy' : 'degraded'
})
const overallLabel = computed(() => overallState.value === 'healthy' ? 'Healthy' : overallState.value === 'degraded' ? 'Degraded' : overallState.value === 'error' ? 'Access issue' : 'Checking')

function apiUrl(path: string): string {
  return `${String(config.public.apiBase).replace(/\/$/, '')}/api/system-admin${path}`
}

async function request<T>(path: string, init: { method?: 'GET' | 'POST' | 'PUT'; body?: Record<string, unknown> } = {}): Promise<T> {
  return await $fetch<T>(apiUrl(path), {
    method: init.method,
    body: init.body,
    headers: await accessHeaders(false)
  })
}

async function refresh(): Promise<void> {
  if (!user.value || !session.value?.access_token || !isConfigured.value) return
  loading.value = true
  errorMessage.value = ''
  accessDenied.value = false
  try {
    overview.value = await request<Overview>('/overview')
    await loadCatalog()
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number; response?: { status?: number } })?.statusCode ??
      (error as { response?: { status?: number } })?.response?.status
    if (statusCode === 403) accessDenied.value = true
    else errorMessage.value = 'System status could not be loaded.'
  } finally {
    loading.value = false
  }
}

function emptyCatalog(revision = 0): ConsumerCatalog {
  return {
    schemaVersion: 1,
    revision,
    baseMonthlyTokens: 0,
    currency: '',
    tiers: [
      { code: 'lunar', monthlyPriceMinor: null, status: 'draft' },
      { code: 'solar', monthlyPriceMinor: null, status: 'draft' },
      { code: 'stellar', monthlyPriceMinor: null, status: 'draft' }
    ],
    addOns: []
  }
}

async function loadCatalog(): Promise<void> {
  catalogState.value = 'loading'
  catalogMessage.value = ''
  try {
    const result = await request<{ catalog: ConsumerCatalog | null }>('/consumer-catalog')
    catalog.value = result.catalog ?? emptyCatalog()
    catalogState.value = 'idle'
  } catch {
    catalogState.value = 'error'
    catalogMessage.value = 'Consumer catalog could not be loaded.'
  }
}

function formatCount(value: number): string {
  return Number.isSafeInteger(value) && value > 0 ? new Intl.NumberFormat().format(value) : 'Set base amount'
}

function setTierPrice(tier: ConsumerCatalog['tiers'][number], event: Event): void {
  const value = (event.target as HTMLInputElement).value
  tier.monthlyPriceMinor = value === '' ? null : Number(value)
}

function setAddOnPrice(product: ConsumerCatalog['addOns'][number], event: Event): void {
  const value = (event.target as HTMLInputElement).value
  product.priceMinor = value === '' ? null : Number(value)
}

function addCatalogAddOn(): void {
  const code = `addon-${catalog.value.addOns.length + 1}`
  catalog.value.addOns.push({
    code, name: '', description: '', tokens: 0, priceMinor: null, status: 'draft'
  })
}

async function saveCatalog(): Promise<void> {
  if (catalogState.value === 'saving' || catalogState.value === 'loading') return
  catalogState.value = 'saving'
  catalogMessage.value = ''
  try {
    const result = await request<{ catalog: ConsumerCatalog }>('/consumer-catalog', {
      method: 'PUT', body: catalog.value as unknown as Record<string, unknown>
    })
    catalog.value = result.catalog
    catalogState.value = 'idle'
    catalogMessage.value = 'Consumer catalog saved. Checkout remains disabled.'
  } catch (error: unknown) {
    const statusCode = (error as { statusCode?: number })?.statusCode
    catalogState.value = 'error'
    catalogMessage.value = statusCode === 409
      ? 'Another operator changed the catalog. Reload before saving.'
      : 'Catalog was not saved. Check prices, package codes, and token amounts.'
  }
}

async function loadLogs(): Promise<void> {
  if (!operatorAvailable.value) return
  logsLoading.value = true
  logsMessage.value = ''
  try {
    const result = await request<{ logs: SystemLog[] }>(`/logs?service=${selectedLogService.value}&limit=100`)
    logs.value = result.logs
  } catch {
    logs.value = []
    logsMessage.value = 'Sanitized service logs could not be loaded.'
  } finally {
    logsLoading.value = false
  }
}

async function openLogs(service: ServiceName): Promise<void> {
  selectedLogService.value = service
  await loadLogs()
}

async function restartService(service: ServiceName): Promise<void> {
  const label = service === 'web' ? 'Web' : service.toUpperCase()
  if (!window.confirm(`Restart the GPTMD ${label} service? Active requests may be interrupted.`)) return
  actionBusy.value = true
  actionMessage.value = ''
  try {
    await request('/restart', { method: 'POST', body: { service, confirmation: service } })
    actionMessage.value = `${label} restart completed.`
    await refresh()
  } catch {
    actionMessage.value = `${label} restart failed or the operator is unavailable.`
  } finally {
    actionBusy.value = false
  }
}

async function rotateLogs(): Promise<void> {
  if (!window.confirm('Rotate the GPTMD journal now? This rotates files but does not delete retained logs.')) return
  actionBusy.value = true
  actionMessage.value = ''
  try {
    await request('/rotate-logs', { method: 'POST', body: { confirmation: 'ROTATE GPTMD LOGS' } })
    actionMessage.value = 'GPTMD journal rotation completed.'
  } catch {
    actionMessage.value = 'Journal rotation failed or the operator is unavailable.'
  } finally {
    actionBusy.value = false
  }
}

function stateClass(status: string): string {
  return status === 'ready' || status === 'configured' || status === 'active' ? 'good'
    : status === 'unavailable' || status === 'missing' || status === 'failed' ? 'bad' : 'muted'
}

function priorityLabel(priority: number | null): string {
  return priority === null ? 'LOG' : priority <= 3 ? 'ERROR' : priority === 4 ? 'WARN' : 'INFO'
}

function priorityClass(priority: number | null): string {
  return priority !== null && priority <= 3 ? 'bad' : priority === 4 ? 'warn' : 'muted'
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = bytes / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
  return `${size.toFixed(1)} ${units[unit]}`
}

function formatCpu(nanoseconds: number | null): string {
  if (nanoseconds === null) return '—'
  const seconds = nanoseconds / 1_000_000_000
  return seconds < 60 ? `${seconds.toFixed(1)} s` : `${(seconds / 60).toFixed(1)} min`
}

function formatInterval(intervalMs: number | undefined): string {
  if (!intervalMs) return 'not sampled'
  return `${Math.round(intervalMs / 1000)}s window`
}

function formatDate(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

onMounted(() => {
  void refresh()
  refreshTimer = setInterval(() => { void refresh() }, 30_000)
})
onBeforeUnmount(() => { if (refreshTimer) clearInterval(refreshTimer) })
watch(
  [() => user.value?.id, () => session.value?.access_token],
  ([subjectId, accessToken], [previousSubjectId, previousAccessToken]) => {
    if (subjectId && accessToken && (subjectId !== previousSubjectId || accessToken !== previousAccessToken)) {
      void refresh()
    }
  }
)
</script>

<style scoped>
.system-admin {
  color: #213235;
  margin: 0 auto;
  max-width: 1440px;
  padding: 2rem 1.5rem 4rem;
}

.page-header, .section-heading, .header-actions, .log-actions, .row-actions {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.page-header {
  border-bottom: 1px solid #d5dfdf;
  margin-bottom: 1.25rem;
  padding-bottom: 1rem;
}

.eyebrow {
  color: #32756f;
  font-size: 0.78rem;
  font-weight: 700;
  margin: 0 0 0.35rem;
  text-transform: uppercase;
}

h1 {
  font-size: 1.7rem;
  margin: 0;
}

h2 {
  font-size: 1.05rem;
  margin: 0;
}

.header-actions { justify-content: flex-end; }

.overall-status, .state-value {
  align-items: center;
  display: inline-flex;
  gap: 0.45rem;
}

.overall-status {
  font-size: 0.9rem;
  font-weight: 700;
}

.status-dot {
  background: currentcolor;
  border-radius: 50%;
  display: inline-block;
  flex: 0 0 0.5rem;
  height: 0.5rem;
  width: 0.5rem;
}

.good { color: #16734b; }
.bad, .error { color: #a42a2a; }
.warn { color: #8b5a11; }
.muted, .unknown { color: #677578; }

.notice {
  background: #edf4f2;
  border-left: 3px solid #32756f;
  margin: 1rem 0;
  padding: 0.75rem 0.9rem;
}

.notice.error {
  background: #fbefef;
  border-color: #a42a2a;
}

.dependency-section, .catalog-section, .service-section, .performance-section, .logs-section {
  border-bottom: 1px solid #d5dfdf;
  padding: 1.25rem 0;
}

.section-heading { margin-bottom: 0.75rem; }

.section-heading > span {
  color: #677578;
  font-size: 0.8rem;
}

.catalog-note, .catalog-message {
  color: #58686a;
  font-size: 0.86rem;
  margin: 0.35rem 0 0.75rem;
  max-width: 75ch;
}

.catalog-message { color: #16734b; }

.catalog-fields {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin: 1rem 0;
  max-width: 680px;
}

.catalog-fields label {
  display: grid;
  gap: 0.35rem;
}

.catalog-fields label span {
  color: #58686a;
  font-size: 0.82rem;
}

.catalog-fields input, .catalog-table input, .catalog-table select {
  background: #fff;
  border: 1px solid #adbbbb;
  border-radius: 3px;
  color: inherit;
  font: inherit;
  min-height: 2.3rem;
  min-width: 6rem;
  padding: 0.4rem 0.5rem;
  width: 100%;
}

.catalog-table { min-width: 680px; }
.addon-table { min-width: 1050px; }
.catalog-table th[scope="row"] { text-transform: capitalize; }
.catalog-table td { white-space: normal; }
.addon-heading { margin-top: 1.25rem; }

.addon-heading h3 {
  font-size: 0.96rem;
  margin: 0;
}

.dependency-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 0.5rem 1.5rem;
}

.dependency-row {
  align-items: center;
  border-bottom: 1px solid #e5ebeb;
  display: flex;
  justify-content: space-between;
  min-height: 2.75rem;
}

.dependency-name { font-weight: 600; }

.state-value {
  font-size: 0.88rem;
  text-transform: capitalize;
}

.state-value small {
  color: #677578;
  font-size: 0.8rem;
}

.table-wrap { overflow-x: auto; }

table {
  border-collapse: collapse;
  min-width: 820px;
  text-align: left;
  width: 100%;
}

th, td {
  border-bottom: 1px solid #e5ebeb;
  padding: 0.7rem 0.55rem;
  white-space: nowrap;
}

thead th {
  color: #58686a;
  font-size: 0.76rem;
  font-weight: 700;
  text-transform: uppercase;
}

tbody th { font-weight: 650; }
.row-actions { justify-content: flex-end; }

.icon-button {
  align-items: center;
  background: transparent;
  border: 1px solid #b8c7c7;
  border-radius: 4px;
  color: #31494b;
  cursor: pointer;
  display: inline-flex;
  height: 2.2rem;
  justify-content: center;
  padding: 0;
  width: 2.2rem;
}

.icon-button:hover:not(:disabled) { background: #edf4f2; }
.icon-button.danger { color: #a42a2a; }

.icon-button:disabled, .text-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.icon-button svg {
  fill: none;
  height: 1.1rem;
  stroke: currentcolor;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 1.7;
  width: 1.1rem;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1rem;
}

.metric {
  border-left: 2px solid #32756f;
  display: grid;
  gap: 0.35rem;
  padding: 0.25rem 0.75rem;
}

.metric span {
  color: #677578;
  font-size: 0.8rem;
}

.metric strong {
  font-size: 1.2rem;
  font-variant-numeric: tabular-nums;
}

.log-heading { align-items: flex-start; }

.log-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

select {
  background: #fff;
  border: 1px solid #adbbbb;
  border-radius: 3px;
  color: inherit;
  min-height: 2.3rem;
  padding: 0.4rem 0.55rem;
}

.text-button {
  background: transparent;
  border: 1px solid #9eafaf;
  border-radius: 3px;
  color: #284e4d;
  cursor: pointer;
  min-height: 2.3rem;
  padding: 0.4rem 0.65rem;
}

.text-button:hover:not(:disabled) { background: #edf4f2; }

.log-message {
  color: #8b5a11;
  font-size: 0.88rem;
}

.log-list {
  background: #f6f8f8;
  border: 1px solid #d5dfdf;
  max-height: 420px;
  overflow: auto;
}

.log-entry {
  align-items: baseline;
  border-bottom: 1px solid #e1e7e7;
  display: grid;
  font-size: 0.78rem;
  gap: 0.65rem;
  grid-template-columns: minmax(130px, 190px) 58px minmax(180px, 260px) 1fr;
  padding: 0.55rem 0.65rem;
}

.log-entry time {
  color: #59686a;
  font-variant-numeric: tabular-nums;
}

.log-priority { font-weight: 700; }

.log-event {
  color: #386a67;
  font-weight: 650;
}

.log-entry code {
  color: #344447;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.empty-state {
  color: #677578;
  margin: 0;
  padding: 1rem;
  text-align: center;
}

.sign-in-link {
  color: #1d6664;
  display: inline-block;
  margin-top: 1rem;
}

.visually-hidden {
  clip-path: inset(50%);
  height: 1px;
  overflow: hidden;
  position: absolute;
  white-space: nowrap;
  width: 1px;
}

@media (width <= 760px) {
  .system-admin { padding: 1.25rem 1rem 3rem; }
  .page-header { align-items: flex-start; }
  .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .catalog-fields { grid-template-columns: minmax(0, 1fr); }
  table { min-width: 0; }
  thead th:nth-child(3), tbody td:nth-child(3) { display: none; }
  thead th:nth-child(4), tbody td:nth-child(4), thead th:nth-child(6), tbody td:nth-child(6) { display: none; }
  th, td { padding: 0.55rem 0.3rem; }
  .row-actions { gap: 0.25rem; }

  .log-heading {
    align-items: stretch;
    flex-direction: column;
  }
  .log-actions { justify-content: flex-start; }
  .log-entry { grid-template-columns: 1fr auto; }
  .log-event { grid-column: 1 / -1; }
  .log-entry code { grid-column: 1 / -1; }
}
</style>
