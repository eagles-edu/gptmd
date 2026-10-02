<template>
  <section class="encounter-page" aria-labelledby="encounter-title">
    <v-dialog v-model="preflightOpen" persistent max-width="46rem" aria-labelledby="preflight-title">
      <v-card class="preflight-card" rounded="xl" variant="elevated">
        <v-card-text class="preflight-content">
          <p class="eyebrow">Visit readiness</p>
          <h2 id="preflight-title" class="preflight-title">Before you begin</h2>
          <p class="preflight-intro">
            This is a fictional training encounter, not medical care. Use fictional details only; never enter real patient identifiers or private health information.
          </p>

          <fieldset class="mode-options">
            <legend>Choose how you will interact</legend>
            <label class="mode-option">
              <input v-model="interactionMode" type="radio" name="interaction-mode" value="transcript">
              <span><strong>Transcript only</strong><small>Available now. Microphone access is not needed.</small></span>
            </label>
            <label class="mode-option">
              <input v-model="interactionMode" type="radio" name="interaction-mode" value="audio">
              <span><strong>Audio</strong><small>Audio conversations are not connected yet. You can check microphone permission, then continue by transcript.</small></span>
            </label>
          </fieldset>

          <div v-if="interactionMode === 'audio'" class="microphone-check">
            <button type="button" class="permission-button" :disabled="microphoneStatus === 'requesting'" @click="requestMicrophoneAccess">
              {{ microphoneStatus === 'requesting' ? 'Checking microphone…' : 'Allow microphone access' }}
            </button>
            <p class="permission-hint">This request happens only after you select audio and press the button. The check stops the microphone immediately and does not record.</p>
          </div>
          <p v-if="microphoneMessage" class="permission-message" role="status" aria-live="polite">{{ microphoneMessage }}</p>

          <div class="readiness-details">
            <p><strong>Transcript readiness:</strong> available without microphone permission.</p>
            <p><strong>Browser storage:</strong> local storage is not a secure session vault and has no permission prompt. GPTpatient does not save account or encounter data there. Any browser request for persistent storage would be separate; this app makes no such request.</p>
          </div>

          <div class="preflight-actions">
            <label class="fictional-confirmation">
              <input v-model="fictionalDetailsConfirmed" type="checkbox">
              <span>I understand this is a fictional training scenario and will use fictional details only.</span>
            </label>
            <button type="button" class="continue-button" :disabled="!canContinue" @click="continueWithTranscript">
              Continue with transcript
            </button>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>

    <div class="intro">
      <p class="eyebrow">OBGYN clinical English communication</p>
      <h1 id="encounter-title">A patient history, one question at a time</h1>
      <p>Practice a natural clinical interview in English with a fictional patient whose history stays consistent as details emerge.</p>
    </div>

    <div class="encounter-grid">
      <v-card class="profile-card" rounded="xl" variant="flat">
        <div class="profile-image-wrap">
          <v-img height="100%" :src="patientImage" :alt="profile ? `Portrait representing ${profile.fullName}` : 'Closed examination-room door'" cover />
        </div>
        <v-card-text>
          <div class="status-row">
            <span class="status-dot" :class="`status-${status}`" aria-hidden="true" />
            <span>{{ statusLabel }}</span>
          </div>
          <ol class="setup-readiness" aria-label="Patient setup readiness">
            <li :data-ready="backendReady" :class="{ 'is-ready': backendReady }">
              Patient profile and Redis state
            </li>
            <li :data-ready="imageReady" :class="{ 'is-ready': imageReady }">
              Patient portrait loaded
            </li>
            <li :data-ready="inputReady" :class="{ 'is-ready': inputReady }">
              Transcript input available
            </li>
          </ol>
          <h2>Patient profile</h2>
          <template v-if="profile">
            <dl class="profile-fields">
              <div><dt>Name</dt><dd>{{ profile.fullName }}</dd></div>
              <div><dt>Date of birth</dt><dd>{{ profile.dateOfBirth }}</dd></div>
              <div><dt>Body type</dt><dd>{{ profile.bodyType }}</dd></div>
              <div><dt>Reason for visit</dt><dd>{{ profile.reasonForVisit }}</dd></div>
            </dl>
            <p class="privacy-note">The diagnosis and educator answer key stay hidden during the interview.</p>
          </template>
          <p v-else class="empty-profile">Create a session to receive the patient’s initial profile.</p>

          <v-btn v-if="!profile" color="primary" :loading="pending" :disabled="pending" block @click="beginSession">
            Create patient session
          </v-btn>
          <v-btn v-else color="primary" :disabled="!canEnterRoom" block @click="enterRoom">
            {{ status === 'error' ? 'Retry readiness' : 'Enter Room' }}
          </v-btn>
        </v-card-text>
      </v-card>

      <v-card class="conversation-card" rounded="xl" variant="flat">
        <div class="conversation-heading">
          <div>
            <p class="eyebrow">Transcript mode</p>
            <h2>Clinical interview</h2>
          </div>
          <span class="phase-chip">{{ phaseLabel }}</span>
        </div>

        <div class="transcript" aria-live="polite" aria-relevant="additions text">
          <p v-if="messages.length === 0" class="transcript-empty">
            Start the session, then ask about the concern that brought the patient in. Let the history unfold through your questions.
          </p>
          <article v-for="(message, index) in messages" :key="`${message.turnId}-${message.role}-${index}`" class="message" :class="`message-${message.role}`">
            <span class="message-label">{{ message.role === 'doctor' ? 'You' : 'Patient' }}</span>
            <p>{{ message.text }}</p>
          </article>
          <p v-if="status === 'working' && profile" class="working-message">The patient is responding…</p>
        </div>

        <form class="question-form" @submit.prevent="sendQuestion">
          <label for="doctor-question">Your next question</label>
          <v-textarea
            id="doctor-question"
            v-model="question"
            auto-grow
            :disabled="!roomEntered || pending"
            hide-details
            maxlength="2000"
            placeholder="Ask one natural follow-up question…"
            rows="2"
            variant="outlined"
          />
          <div class="form-actions">
            <span class="mode-note">Voice capture and spoken replies follow after the API audio lane is connected.</span>
            <v-btn color="primary" type="submit" :disabled="!roomEntered || !question.trim() || pending" :loading="pending">
              Send question
            </v-btn>
          </div>
        </form>

        <v-alert v-if="errorMessage" class="api-error" type="warning" variant="tonal" role="status">
          {{ errorMessage }}
        </v-alert>
      </v-card>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { usePatientApi, type PatientProfile } from '../composables/usePatientApi'

type EncounterStatus = 'idle' | 'creating' | 'preloading' | 'ready' | 'active' | 'working' | 'error'
type Message = { turnId: string; role: 'doctor' | 'patient'; text: string }
type InteractionMode = 'transcript' | 'audio'
type MicrophoneStatus = 'not-requested' | 'requesting' | 'granted' | 'denied' | 'unavailable'

const api = usePatientApi()
const sessionId = ref<string | null>(null)
const profile = ref<PatientProfile | null>(null)
const backendReady = ref(false)
const imageReady = ref(false)
const roomEntered = ref(false)
const question = ref('')
const messages = ref<Message[]>([])
const status = ref<EncounterStatus>('idle')
const errorMessage = ref('')
const preflightOpen = ref(true)
const interactionMode = ref<InteractionMode>('transcript')
const fictionalDetailsConfirmed = ref(false)
const microphoneStatus = ref<MicrophoneStatus>('not-requested')
const microphoneMessage = ref('')
const pending = computed(() => ['creating', 'preloading', 'working'].includes(status.value))
const canContinue = computed(() => fictionalDetailsConfirmed.value && interactionMode.value === 'transcript')
const inputReady = computed(() => interactionMode.value === 'transcript')
const canEnterRoom = computed(() =>
  status.value === 'ready' && backendReady.value && imageReady.value && inputReady.value
)

const statusLabel = computed(() => ({
  idle: 'Awaiting session',
  creating: 'Creating patient',
  preloading: 'Loading patient portrait',
  ready: 'Ready for interview',
  active: 'Ready for interview',
  working: 'Patient responding',
  error: 'Session needs attention'
})[status.value])

const phaseLabel = computed(() => profile.value ? 'History taking' : 'Intake')

const patientImage = computed(() => {
  if (!profile.value) return '/assets/images/door.webp'
  const age = calculateAge(profile.value.dateOfBirth)
  const decade = age < 20 ? '1019' : age < 30 ? '2029' : age < 40 ? '3039' : age < 50 ? '4049' : '5059'
  return `/assets/images/${decade}-${profile.value.bodyType}/01.png`
})

function continueWithTranscript(): void {
  if (!canContinue.value) return
  preflightOpen.value = false
}

async function requestMicrophoneAccess(): Promise<void> {
  if (interactionMode.value !== 'audio' || microphoneStatus.value === 'requesting') return
  microphoneMessage.value = ''
  if (!navigator.mediaDevices?.getUserMedia) {
    microphoneStatus.value = 'unavailable'
    microphoneMessage.value = 'Microphone access is unavailable in this browser or page context. Transcript mode remains available without it.'
    interactionMode.value = 'transcript'
    return
  }

  microphoneStatus.value = 'requesting'
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const track of stream.getTracks()) track.stop()
    microphoneStatus.value = 'granted'
    microphoneMessage.value = 'Permission granted. Audio conversations are not connected yet, so continue with transcript; the microphone check has stopped.'
  } catch {
    microphoneStatus.value = 'denied'
    microphoneMessage.value = 'Microphone permission was denied. No microphone is needed for transcript mode; you can continue without it.'
  }
  interactionMode.value = 'transcript'
}

async function beginSession(): Promise<void> {
  errorMessage.value = ''
  status.value = 'creating'
  backendReady.value = false
  imageReady.value = false
  roomEntered.value = false

  try {
    sessionId.value ??= (await api.createSession()).sessionId
    const setup = await api.setupSession(sessionId.value)
    profile.value = setup.patient
    backendReady.value = setup.readiness.profile && setup.readiness.redis && setup.readiness.conversation
    status.value = 'preloading'
    await preloadImage(patientImage.value)
    imageReady.value = true
    status.value = 'ready'
  } catch (error) {
    status.value = 'error'
    errorMessage.value = readableError(error)
  }
}

function enterRoom(): void {
  if (!canEnterRoom.value) return
  roomEntered.value = true
  status.value = 'active'
}

function preloadImage(source: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('The patient portrait could not be loaded. Retry readiness to try again.'))
    image.src = source
  })
}

async function sendQuestion(): Promise<void> {
  const text = question.value.trim()
  if (!sessionId.value || !profile.value || !roomEntered.value || !text || pending.value) return

  const turnId = createTurnId()
  messages.value.push({ turnId, role: 'doctor', text })
  question.value = ''
  errorMessage.value = ''
  status.value = 'working'

  try {
    const result = await api.sendTurn(sessionId.value, turnId, text)
    messages.value.push({ turnId, role: 'patient', text: result.text })
    status.value = 'ready'
  } catch (error) {
    question.value = text
    status.value = 'error'
    errorMessage.value = readableError(error)
  }
}

function createTurnId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error('A secure browser context is required to create a turn identifier.')
  }
  return globalThis.crypto.randomUUID()
}

function calculateAge(dateOfBirth: string): number {
  const birthDate = new Date(`${dateOfBirth}T00:00:00`)
  if (Number.isNaN(birthDate.getTime())) return 30
  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  if (today.getMonth() < birthDate.getMonth() || (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())) age -= 1
  return Math.max(0, age)
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The patient service could not complete the request.'
  if (message.includes('404') || message.includes('Not Found')) {
    return 'The patient session or setup route is unavailable. Check the GPTMD API and confirm that its database migrations are applied.'
  }
  return message
}
</script>

<style scoped>
.preflight-card {
  display: flex;
  flex-direction: column;
  color: var(--app-text, #183c43);
  max-height: calc(100dvh - 2rem);
  overflow: hidden;
}

.preflight-content {
  min-height: 0;
  overflow-y: auto;
}

.preflight-title {
  font-size: clamp(1.8rem, 4vw, 2.35rem);
  margin: 0.25rem 0 0.6rem;
}

.preflight-intro,
.readiness-details p,
.permission-hint,
.permission-message {
  color: var(--app-muted-text, #59696a);
  line-height: 1.55;
}

.mode-options {
  border: 0;
  display: grid;
  gap: 0.65rem;
  margin: 1.3rem 0;
  padding: 0;
}

.mode-options legend {
  font-weight: 800;
  margin-bottom: 0.65rem;
}

.mode-option {
  align-items: flex-start;
  background: var(--app-surface, #fff);
  border: 1px solid rgb(31 74 77 / 20%);
  border-radius: 0.8rem;
  cursor: pointer;
  display: flex;
  gap: 0.75rem;
  padding: 0.9rem;
}

.mode-option input,
.fictional-confirmation input {
  accent-color: #176d70;
  flex: 0 0 auto;
  height: 1.1rem;
  margin-top: 0.15rem;
  width: 1.1rem;
}

.mode-option span {
  display: grid;
  gap: 0.25rem;
}

.mode-option small {
  color: var(--app-muted-text, #59696a);
  line-height: 1.45;
}

.microphone-check {
  margin: 0.9rem 0 1.1rem;
}

.permission-button,
.continue-button {
  background: #176d70;
  border: 0;
  border-radius: 0.55rem;
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-weight: 750;
  min-height: 2.9rem;
  padding: 0.7rem 1rem;
}

.permission-button:disabled,
.continue-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.permission-hint,
.permission-message {
  font-size: 0.9rem;
  margin: 0.65rem 0 0;
}

.readiness-details {
  background: #eff6f3;
  border-radius: 0.8rem;
  margin: 1.2rem 0;
  padding: 0.8rem 1rem;
}

.readiness-details p {
  margin: 0.35rem 0;
}

.fictional-confirmation {
  align-items: flex-start;
  cursor: pointer;
  display: flex;
  gap: 0.7rem;
  line-height: 1.5;
  margin: 0.15rem 0 0.5rem;
}

.preflight-actions {
  background: rgb(var(--v-theme-surface));
  bottom: 0;
  display: grid;
  gap: 0.35rem;
  padding: 0.7rem 0 0.15rem;
  position: sticky;
}

.continue-button {
  justify-self: end;
}

.permission-button:focus-visible,
.continue-button:focus-visible,
.mode-option:focus-within,
.fictional-confirmation:focus-within {
  outline: 3px solid #c27b43;
  outline-offset: 3px;
}

.encounter-page {
  margin: 0 auto;
  max-width: 1280px;
  padding: clamp(1.25rem, 4vw, 3rem) 1rem;
}

.intro {
  margin: 0 auto 1.5rem;
  max-width: 820px;
  text-align: center;
}

.intro h1 {
  color: var(--app-text-strong);
  font-size: clamp(1.9rem, 4vw, 3rem);
  line-height: 1.1;
  margin: 0.35rem 0 0.7rem;
}

.intro > p:last-child {
  color: var(--app-text-muted);
  font-size: 1.06rem;
  margin: 0 auto;
  max-width: 680px;
}

.eyebrow {
  color: var(--app-accent);
  font-size: 0.77rem;
  font-weight: 750;
  letter-spacing: 0.09em;
  margin: 0;
  text-transform: uppercase;
}

.encounter-grid {
  align-items: start;
  display: grid;
  gap: 1.25rem;
  grid-template-columns: minmax(270px, 0.8fr) minmax(0, 1.4fr);
}

.profile-card, .conversation-card {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  box-shadow: 0 14px 36px var(--app-shadow);
}

.profile-image-wrap {
  background: var(--app-surface-muted);
  height: 290px;
  overflow: hidden;
}

.status-row {
  align-items: center;
  color: var(--app-text-muted);
  display: flex;
  font-size: 0.86rem;
  gap: 0.55rem;
  margin-bottom: 1.2rem;
}

.setup-readiness {
  color: var(--app-text-muted);
  display: grid;
  font-size: 0.86rem;
  gap: 0.4rem;
  list-style: none;
  margin: 0 0 1.2rem;
  padding: 0;
}

.setup-readiness li::before {
  color: #9a641b;
  content: '◷';
  display: inline-block;
  font-weight: 800;
  margin-right: 0.5rem;
  width: 1rem;
}

.setup-readiness li.is-ready::before {
  color: #187247;
  content: '✓';
}

.status-dot {
  background: #94a3b8;
  border-radius: 50%;
  height: 0.66rem;
  width: 0.66rem;
}

.status-ready {
  background: var(--app-success);
  box-shadow: 0 0 0 4px var(--app-success-soft);
}

.status-active {
  background: var(--app-success);
  box-shadow: 0 0 0 4px var(--app-success-soft);
}

.status-creating, .status-preloading, .status-working {
  background: var(--app-warning);
  box-shadow: 0 0 0 4px var(--app-warning-soft);
}

.status-error {
  background: var(--app-error);
  box-shadow: 0 0 0 4px var(--app-error-soft);
}

.status-complete {
  background: #456a8c;
}

.profile-card h2, .conversation-card h2 {
  color: var(--app-text-strong);
  font-size: 1.3rem;
  margin: 0 0 1rem;
}

.profile-fields {
  display: grid;
  gap: 0.8rem;
  margin: 0 0 1rem;
}

.profile-fields div {
  border-bottom: 1px solid var(--app-border-soft);
  padding-bottom: 0.55rem;
}

.profile-fields dt {
  color: var(--app-text-subtle);
  font-size: 0.78rem;
}

.profile-fields dd {
  color: var(--app-text);
  font-weight: 600;
  margin: 0.12rem 0 0;
}

.privacy-note, .empty-profile {
  color: var(--app-text-muted);
  font-size: 0.86rem;
  line-height: 1.5;
  margin: 0 0 1rem;
}

.conversation-card {
  min-height: 650px;
  padding: clamp(1rem, 2.5vw, 1.6rem);
}

.conversation-heading {
  align-items: start;
  border-bottom: 1px solid var(--app-border-soft);
  display: flex;
  justify-content: space-between;
  padding-bottom: 1rem;
}

.conversation-heading h2 {
  margin: 0.3rem 0 0;
}

.phase-chip {
  background: var(--app-surface-accent);
  border-radius: 999px;
  color: var(--app-accent);
  font-size: 0.8rem;
  font-weight: 700;
  padding: 0.45rem 0.75rem;
}

.transcript {
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  min-height: 340px;
  max-height: 440px;
  overflow-y: auto;
  padding: 1rem 0;
}

.transcript-empty {
  align-self: center;
  color: var(--app-text-subtle);
  line-height: 1.6;
  margin: auto;
  max-width: 450px;
  text-align: center;
}

.message {
  border-radius: 0.8rem;
  max-width: 88%;
  padding: 0.65rem 0.9rem;
}

.message-doctor {
  align-self: flex-end;
  background: var(--app-surface-doctor);
}

.message-patient {
  align-self: flex-start;
  background: var(--app-surface-patient);
}

.message-label {
  color: var(--app-text-muted);
  font-size: 0.72rem;
  font-weight: 750;
}

.message p {
  color: var(--app-text);
  line-height: 1.5;
  margin: 0.2rem 0 0;
  white-space: pre-wrap;
}

.working-message {
  color: var(--app-text-subtle);
  font-size: 0.9rem;
  font-style: italic;
}

.question-form {
  border-top: 1px solid var(--app-border-soft);
  padding-top: 1rem;
}

.question-form > label {
  color: var(--app-text-muted);
  display: block;
  font-size: 0.9rem;
  font-weight: 700;
  margin-bottom: 0.45rem;
}

.form-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: space-between;
  margin-top: 0.75rem;
}

.mode-note {
  color: var(--app-text-subtle);
  font-size: 0.78rem;
  max-width: 390px;
}

.api-error {
  margin-top: 1rem;
}

@media (width <= 760px) {
  .encounter-grid {
    grid-template-columns: 1fr;
  }

  .profile-image-wrap {
    height: min(65vw, 360px);
  }

  .conversation-card {
    min-height: 560px;
  }

  .transcript {
    min-height: 280px;
  }
}
</style>
