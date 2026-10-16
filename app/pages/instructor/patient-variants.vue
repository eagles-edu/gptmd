<template>
  <section class="variant-settings-page" aria-labelledby="variant-settings-title">
    <p class="eyebrow">TEAECL system administration</p>
    <h1 id="variant-settings-title">Patient variant settings</h1>

    <p v-if="!user && isConfigured" class="status-message">
      <NuxtLink to="/login?redirect=/system-admin/patient-variants">Sign in with Google</NuxtLink>
    </p>
    <p v-else-if="tenantState === 'loading'" class="status-message">Loading workspaces…</p>
    <p v-else-if="accessDenied" class="status-message" role="alert">GPTMD system administrator access is required.</p>
    <p v-else-if="tenantMessage" class="status-message" role="status">{{ tenantMessage }}</p>

    <div v-if="user && !accessDenied && tenantState === 'ready'" class="workspace-picker">
      <label for="variant-workspace">Workspace</label>
      <select id="variant-workspace" v-model="selectedTenantId">
        <option value="" disabled>Choose a workspace</option>
        <option v-for="tenant in tenants" :key="tenant.tenantId" :value="tenant.tenantId">
          {{ tenant.displayName }}
        </option>
      </select>
    </div>

    <template v-if="user && !accessDenied && selectedTenantId">
      <div class="settings-toolbar">
        <div>
          <h2>Ten portrait variants</h2>
          <p>Each profile is independent. Appearance does not set personality or clinical facts.</p>
        </div>
        <div class="save-actions">
          <button type="button" :disabled="saving || settingsState !== 'ready'" @click="saveSettings('draft')">
            {{ saving && saveStatus === 'draft' ? 'Saving…' : 'Save draft' }}
          </button>
          <button type="button" class="approve-button" :disabled="saving || settingsState !== 'ready' || !canApprove" @click="approveSettings">
            {{ saving && saveStatus === 'approved' ? 'Approving…' : 'Approve settings' }}
          </button>
        </div>
      </div>
      <p class="status-message" role="status" aria-live="polite">{{ settingsMessage }}</p>
      <p v-if="hasDuplicatePrimaryVoices" class="validation-message" role="alert">
        Every portrait variant needs a distinct primary voice before approval.
      </p>

      <section v-for="variant in settings.variants" :key="variant.variantKey" class="variant-row" :aria-labelledby="`title-${variant.variantKey}`">
        <div class="variant-heading">
          <h2 :id="`title-${variant.variantKey}`">{{ variant.variantKey }}</h2>
          <span class="profile-ids">{{ variant.voiceProfileId }} · {{ variant.variabilityProfileId }}</span>
        </div>

        <div class="profile-grid">
          <fieldset class="voice-fields">
            <legend>Voice</legend>
            <label :for="`provider-${variant.variantKey}`">Speech provider</label>
            <select :id="`provider-${variant.variantKey}`" v-model="variant.voice.provider" @change="setVoiceProvider(variant)">
              <option :value="null">Choose a provider</option>
              <option value="browser-speech-synthesis">Browser voice</option>
              <option value="openai-audio-speech">Server-generated voice</option>
            </select>
            <label :for="`voice-${variant.variantKey}`">{{ variant.voice.provider === 'openai-audio-speech' ? 'Server voice' : 'Voice mapping' }}</label>
            <select v-if="variant.voice.provider === 'openai-audio-speech'" :id="`voice-${variant.variantKey}`" v-model="variant.voice.voiceId" @change="syncServerVoice(variant)">
              <option :value="null">Choose a voice</option>
              <option v-for="voice in openAiVoices" :key="voice" :value="voice">{{ voice }}</option>
            </select>
            <select v-else :id="`voice-${variant.variantKey}`" v-model="variant.voice.voiceId" @change="syncVoiceLocale(variant)">
              <option :value="null">Choose a voice</option>
              <option v-for="voice in voices" :key="voice.voiceURI" :value="voice.voiceURI">
                {{ voice.name }} ({{ voice.lang }})
              </option>
            </select>
            <label :for="`fallback-${variant.variantKey}`">Fallback voice</label>
            <select :id="`fallback-${variant.variantKey}`" v-model="variant.voice.fallbackVoiceId">
              <option :value="null">Choose a fallback</option>
              <option v-for="voice in voices" :key="voice.voiceURI" :value="voice.voiceURI">
                {{ voice.name }} ({{ voice.lang }})
              </option>
            </select>
            <p class="voice-locale">{{ variant.voice.locale || 'Locale follows the selected voice.' }}</p>
            <div v-if="variant.voice.provider === 'browser-speech-synthesis'" class="numeric-settings">
              <label :for="`rate-${variant.variantKey}`">Rate {{ variant.voice.rate ?? '—' }}
                <input :id="`rate-${variant.variantKey}`" v-model.number="variant.voice.rate" type="range" min="0.5" max="2" step="0.1">
              </label>
              <label :for="`pitch-${variant.variantKey}`">Pitch {{ variant.voice.pitch ?? '—' }}
                <input :id="`pitch-${variant.variantKey}`" v-model.number="variant.voice.pitch" type="range" min="0" max="2" step="0.1">
              </label>
              <label :for="`volume-${variant.variantKey}`">Volume {{ variant.voice.volume ?? '—' }}
                <input :id="`volume-${variant.variantKey}`" v-model.number="variant.voice.volume" type="range" min="0" max="1" step="0.05">
              </label>
            </div>
            <button class="preview-button" type="button" :disabled="variant.voice.provider !== 'browser-speech-synthesis' || !variant.voice.voiceId || !speechSynthesisAvailable" @click="previewVoice(variant)">
              Preview browser voice
            </button>
          </fieldset>

          <fieldset class="variability-fields">
            <legend>Communication variability</legend>
            <label v-for="trait in variabilityTraits" :key="trait.key" :for="`${trait.key}-${variant.variantKey}`">
              {{ trait.label }}
              <textarea
                :id="`${trait.key}-${variant.variantKey}`"
                :value="variant.variability[trait.key].allowedValues.join('\n')"
                rows="3"
                maxlength="2400"
                @input="setAllowedValues(variant, trait.key, $event)"
              />
            </label>
          </fieldset>
        </div>
      </section>
    </template>
  </section>
</template>

<script setup lang="ts">
definePageMeta({ path: '/system-admin/patient-variants' })

type VariantKey = '1019-average' | '1019-heavy' | '2029-average' | '2029-heavy' | '3039-average' | '3039-heavy' | '4049-average' | '4049-heavy' | '5059-average' | '5059-heavy'
type TraitKey = 'mood' | 'maturity' | 'verbosity' | 'educationLevel' | 'willingnessToDisclose'
interface VariantSettings {
  variantKey: VariantKey
  voiceProfileId: string
  voice: { provider: 'browser-speech-synthesis' | 'openai-audio-speech' | null; voiceId: string | null; locale: string | null; rate: number | null; pitch: number | null; volume: number | null; fallbackVoiceId: string | null }
  variabilityProfileId: string
  variability: Record<TraitKey, { allowedValues: string[] }>
}
interface VariantSettingsDocument { schemaVersion: 1; status: 'draft' | 'approved'; revision: number; variants: VariantSettings[] }
interface LocalVoice { name: string; lang: string; voiceURI: string }
interface TenantOption { tenantId: string; displayName: string }

const variantKeys: VariantKey[] = [
  '1019-average', '1019-heavy', '2029-average', '2029-heavy', '3039-average',
  '3039-heavy', '4049-average', '4049-heavy', '5059-average', '5059-heavy'
]
const openAiVoices = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar']
const variabilityTraits: Array<{ key: TraitKey; label: string }> = [
  { key: 'mood', label: 'Mood' },
  { key: 'maturity', label: 'Maturity' },
  { key: 'verbosity', label: 'Verbosity' },
  { key: 'educationLevel', label: 'Health-literacy level' },
  { key: 'willingnessToDisclose', label: 'Willingness to disclose' }
]

function emptySettings(): VariantSettingsDocument {
  return {
    schemaVersion: 1,
    status: 'draft',
    revision: 0,
    variants: variantKeys.map((variantKey) => ({
      variantKey,
      voiceProfileId: `voice-${variantKey}`,
      voice: { provider: null, voiceId: null, locale: null, rate: null, pitch: null, volume: null, fallbackVoiceId: null },
      variabilityProfileId: `variability-${variantKey}`,
      variability: {
        mood: { allowedValues: [] }, maturity: { allowedValues: [] }, verbosity: { allowedValues: [] },
        educationLevel: { allowedValues: [] }, willingnessToDisclose: { allowedValues: [] }
      }
    }))
  }
}

const { user, isConfigured, accessHeaders } = useGptmdAuth()
const tenants = ref<TenantOption[]>([])
const selectedTenantId = ref('')
const tenantState = ref<'loading' | 'ready' | 'error'>('loading')
const tenantMessage = ref('')
const accessDenied = ref(false)
const settingsState = ref<'loading' | 'ready' | 'error'>('loading')
const settingsMessage = ref('')
const settings = ref<VariantSettingsDocument>(emptySettings())
const saving = ref(false)
const saveStatus = ref<'draft' | 'approved' | null>(null)
const voices = ref<LocalVoice[]>([])
const speechSynthesisAvailable = ref(false)
const hasDuplicatePrimaryVoices = computed(() => {
  const assignments = settings.value.variants
    .filter((variant) => variant.voice.provider && variant.voice.voiceId)
    .map((variant) => `${variant.voice.provider}:${variant.voice.voiceId}`)
  return new Set(assignments).size !== assignments.length
})
const canApprove = computed(() => !hasDuplicatePrimaryVoices.value && settings.value.variants.every((variant) =>
  ((variant.voice.provider === 'browser-speech-synthesis' &&
    voices.value.some((voice) => voice.voiceURI === variant.voice.voiceId) &&
    Boolean(variant.voice.locale) && variant.voice.rate !== null && variant.voice.pitch !== null &&
    variant.voice.volume !== null) ||
   (variant.voice.provider === 'openai-audio-speech' &&
    openAiVoices.includes(variant.voice.voiceId ?? '') && variant.voice.locale === 'en' &&
    variant.voice.rate === null && variant.voice.pitch === null && variant.voice.volume === null)) &&
  voices.value.some((voice) => voice.voiceURI === variant.voice.fallbackVoiceId) &&
  Boolean(variant.voice.fallbackVoiceId) &&
  variabilityTraits.every((trait) => variant.variability[trait.key].allowedValues.length > 0)
))

function refreshVoices(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return
  voices.value = window.speechSynthesis.getVoices().map(({ name, lang, voiceURI }) => ({ name, lang, voiceURI }))
}

function setAllowedValues(variant: VariantSettings, trait: TraitKey, event: Event): void {
  variant.variability[trait].allowedValues = (event.target as HTMLTextAreaElement).value
    .split('\n').map((value) => value.trim()).filter(Boolean).slice(0, 20)
}

function syncVoiceLocale(variant: VariantSettings): void {
  const voice = voices.value.find((candidate) => candidate.voiceURI === variant.voice.voiceId)
  if (voice) {
    variant.voice.provider = 'browser-speech-synthesis'
    variant.voice.locale = voice.lang
    variant.voice.rate ??= 1
    variant.voice.pitch ??= 1
    variant.voice.volume ??= 1
  } else {
    variant.voice.provider = null
    variant.voice.locale = null
  }
}

function setVoiceProvider(variant: VariantSettings): void {
  variant.voice.voiceId = null
  variant.voice.fallbackVoiceId = null
  if (variant.voice.provider === 'openai-audio-speech') {
    variant.voice.locale = 'en'
    variant.voice.rate = null
    variant.voice.pitch = null
    variant.voice.volume = null
  } else if (variant.voice.provider === 'browser-speech-synthesis') {
    variant.voice.locale = null
    variant.voice.rate = 1
    variant.voice.pitch = 1
    variant.voice.volume = 1
  } else {
    variant.voice.locale = null
    variant.voice.rate = null
    variant.voice.pitch = null
    variant.voice.volume = null
  }
}

function syncServerVoice(variant: VariantSettings): void {
  variant.voice.provider = 'openai-audio-speech'
  variant.voice.locale = 'en'
  variant.voice.rate = null
  variant.voice.pitch = null
  variant.voice.volume = null
}

function previewVoice(variant: VariantSettings): void {
  const voice = voices.value.find((candidate) => candidate.voiceURI === variant.voice.voiceId)
  if (!voice || !window.speechSynthesis) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance('This is a patient voice sample.')
  utterance.voice = window.speechSynthesis.getVoices().find((candidate) => candidate.voiceURI === voice.voiceURI) ?? null
  utterance.lang = variant.voice.locale ?? voice.lang
  utterance.rate = variant.voice.rate ?? 1
  utterance.pitch = variant.voice.pitch ?? 1
  utterance.volume = variant.voice.volume ?? 1
  window.speechSynthesis.speak(utterance)
}

async function apiUrl(): Promise<string> {
  const runtimeConfig = useRuntimeConfig()
  return `${String(runtimeConfig.public.apiBase).replace(/\/$/, '')}/api/system-admin`
}

async function loadSettings(): Promise<void> {
  if (!selectedTenantId.value) {
    settingsState.value = 'ready'
    return
  }
  settingsState.value = 'loading'
  try {
    const result = await $fetch<{ settings: VariantSettingsDocument | null }>(
      `${await apiUrl()}/tenants/${encodeURIComponent(selectedTenantId.value)}/patient-variant-settings`,
      { headers: await accessHeaders(false) }
    )
    settings.value = result.settings ?? emptySettings()
    settingsState.value = 'ready'
    settingsMessage.value = `Revision ${settings.value.revision} · ${settings.value.status}`
  } catch (error) {
    if ((error as { statusCode?: number }).statusCode === 403) accessDenied.value = true
    settingsState.value = 'error'
    settingsMessage.value = 'Patient variant settings could not be loaded.'
  }
}

async function saveSettings(status: 'draft' | 'approved'): Promise<void> {
  if (status === 'approved' && !canApprove.value) return
  saving.value = true
  saveStatus.value = status
  settingsMessage.value = ''
  try {
    const result = await $fetch<{ settings: VariantSettingsDocument }>(
      `${await apiUrl()}/tenants/${encodeURIComponent(selectedTenantId.value)}/patient-variant-settings`, {
      method: 'PUT',
      headers: await accessHeaders(false),
      body: { ...settings.value, status }
      }
    )
    settings.value = result.settings
    settingsMessage.value = `Revision ${settings.value.revision} · ${settings.value.status}`
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode
    settingsMessage.value = statusCode === 409
      ? 'Settings changed in another session. Reload before saving again.'
      : status === 'approved'
        ? 'Approval was not saved. Complete every voice profile and variability value first.'
        : 'Draft was not saved. Check the settings and try again.'
  } finally {
    saving.value = false
    saveStatus.value = null
  }
}

async function approveSettings(): Promise<void> {
  if (!window.confirm('Approve all ten voice and variability profiles for this workspace?')) return
  await saveSettings('approved')
}

async function loadTenants(): Promise<void> {
  if (!user.value) {
    return
  }
  try {
    const result = await $fetch<{ tenants: TenantOption[] }>(`${await apiUrl()}/patient-variant-settings/tenants`, {
      headers: await accessHeaders(false)
    })
    tenants.value = result.tenants
    tenantState.value = 'ready'
    tenantMessage.value = tenants.value.length ? '' : 'No workspaces are available.'
  } catch (error) {
    const statusCode = (error as { statusCode?: number }).statusCode
    accessDenied.value = statusCode === 403
    tenantState.value = 'error'
    tenantMessage.value = accessDenied.value
      ? 'GPTMD system administrator access is required.'
      : 'Workspace access could not be loaded.'
  }
}

watch(user, (currentUser) => { if (currentUser) void loadTenants() }, { immediate: true })
watch(selectedTenantId, () => { void loadSettings() })
onMounted(() => {
  speechSynthesisAvailable.value = typeof window !== 'undefined' && Boolean(window.speechSynthesis)
  refreshVoices()
  window.speechSynthesis?.addEventListener('voiceschanged', refreshVoices)
})
onBeforeUnmount(() => {
  window.speechSynthesis?.removeEventListener('voiceschanged', refreshVoices)
  window.speechSynthesis?.cancel()
})
</script>

<style scoped>
.variant-settings-page {
  max-width: 1240px;
  margin: 0 auto;
  padding: 2rem 1.5rem 4rem;
}

.eyebrow {
  margin: 0 0 .5rem;
  color: #53616c;
  font-size: .8rem;
  font-weight: 700;
  text-transform: uppercase;
}

h1 {
  margin: 0 0 1.5rem;
  font-size: 2rem;
}

h2 {
  margin: 0;
  font-size: 1.05rem;
}

.status-message {
  min-height: 1.5rem;
  color: #43515b;
}

.validation-message {
  color: #a33224;
  font-weight: 700;
}

.workspace-picker {
  display: grid;
  max-width: 24rem;
  gap: .4rem;
  margin: 1rem 0 2rem;
}

.settings-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin: 1.5rem 0;
}

.settings-toolbar p {
  margin: .35rem 0 0;
  color: #53616c;
}

.save-actions {
  display: flex;
  gap: .5rem;
}

button, select, textarea { font: inherit; }

button {
  min-height: 2.5rem;
  padding: .4rem .8rem;
  border: 1px solid #63717c;
  border-radius: 4px;
  background: white;
  color: #25313a;
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: .5;
}

.approve-button {
  border-color: #246a56;
  background: #246a56;
  color: white;
}

.variant-row {
  padding: 1.25rem 0 1.5rem;
  border-top: 1px solid #d2d9dd;
}

.variant-heading {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  margin-bottom: 1rem;
}

.profile-ids {
  color: #66737c;
  font-size: .8rem;
}

.profile-grid {
  display: grid;
  grid-template-columns: minmax(17rem, .8fr) minmax(24rem, 1.2fr);
  gap: 1.25rem;
}

fieldset {
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

legend {
  margin-bottom: .75rem;
  font-weight: 700;
}

fieldset > label {
  display: grid;
  gap: .3rem;
  margin: 0 0 .7rem;
  font-weight: 600;
}

select, textarea, input[type="range"] { width: 100%; }

select, textarea {
  border: 1px solid #aeb8be;
  border-radius: 4px;
  padding: .5rem;
  background: #fff;
  color: #202a30;
}

textarea {
  min-height: 4.2rem;
  resize: vertical;
  font-weight: 400;
}

.voice-locale {
  margin: -.3rem 0 .7rem;
  color: #66737c;
  font-size: .85rem;
}

.numeric-settings {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: .75rem;
}

.numeric-settings label {
  display: grid;
  gap: .3rem;
  font-size: .9rem;
}

.preview-button {
  margin-top: .75rem;
}

@media (width <= 760px) {
  .settings-toolbar, .variant-heading {
    align-items: flex-start;
    flex-direction: column;
  }

  .profile-grid {
    grid-template-columns: minmax(0, 1fr);
  }

  .numeric-settings {
    grid-template-columns: minmax(0, 1fr);
  }

  .profile-ids {
    overflow-wrap: anywhere;
  }
}
</style>
