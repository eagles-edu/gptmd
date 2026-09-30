<template>
  <section class="encounter-page" aria-labelledby="encounter-title">
    <div class="intro">
      <p class="eyebrow">OBGYN clinical English communication</p>
      <h1 id="encounter-title">A patient history, one question at a time</h1>
      <p>Practice a natural clinical interview in English with a fictional patient whose history stays consistent as details emerge.</p>
    </div>

    <div class="encounter-grid">
      <v-card class="profile-card" rounded="xl" variant="flat">
        <div class="profile-image-wrap">
          <v-img height="100%" :src="patientImage" :alt="profile ? `Portrait representing ${profile.patientName}` : 'Closed examination-room door'" cover />
        </div>
        <v-card-text>
          <div class="status-row">
            <span class="status-dot" :class="`status-${status}`" aria-hidden="true" />
            <span>{{ statusLabel }}</span>
          </div>
          <h2>Patient profile</h2>
          <template v-if="profile">
            <dl class="profile-fields">
              <div><dt>Name</dt><dd>{{ profile.patientName }}</dd></div>
              <div><dt>Date of birth</dt><dd>{{ profile.patientDob }}</dd></div>
              <div><dt>Body type</dt><dd>{{ profile.patientBodytype }}</dd></div>
              <div><dt>Reason for visit</dt><dd>{{ profile.patientReason }}</dd></div>
            </dl>
            <p class="privacy-note">The diagnosis and educator answer key stay hidden during the interview.</p>
          </template>
          <p v-else class="empty-profile">Create a session to receive the patient’s initial profile.</p>

          <v-btn v-if="!profile" color="primary" :loading="pending" :disabled="pending" block @click="beginSession">
            Create patient session
          </v-btn>
          <v-btn v-else color="primary" disabled block>
            Assessment submission not connected
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
          <p v-if="pending && profile" class="working-message">The patient is responding…</p>
        </div>

        <form class="question-form" @submit.prevent="sendQuestion">
          <label for="doctor-question">Your next question</label>
          <v-textarea
            id="doctor-question"
            v-model="question"
            auto-grow
            :disabled="!profile || pending"
            hide-details
            maxlength="2000"
            placeholder="Ask one natural follow-up question…"
            rows="2"
            variant="outlined"
          />
          <div class="form-actions">
            <span class="mode-note">Voice capture and spoken replies follow after the API audio lane is connected.</span>
            <v-btn color="primary" type="submit" :disabled="!profile || !question.trim() || pending" :loading="pending">
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

type EncounterStatus = 'idle' | 'creating' | 'ready' | 'working' | 'error'
type Message = { turnId: string; role: 'doctor' | 'patient'; text: string }

const api = usePatientApi()
const sessionId = ref<string | null>(null)
const profile = ref<PatientProfile | null>(null)
const question = ref('')
const messages = ref<Message[]>([])
const status = ref<EncounterStatus>('idle')
const errorMessage = ref('')
const pending = computed(() => status.value === 'creating' || status.value === 'working')

const statusLabel = computed(() => ({
  idle: 'Awaiting session',
  creating: 'Creating patient',
  ready: 'Ready for interview',
  working: 'Patient responding',
  error: 'Session needs attention'
})[status.value])

const phaseLabel = computed(() => profile.value ? 'History taking' : 'Intake')

const patientImage = computed(() => {
  if (!profile.value) return '/assets/images/door.webp'
  const age = calculateAge(profile.value.patientDob)
  const decade = age < 20 ? '1019' : age < 30 ? '2029' : age < 40 ? '3039' : age < 50 ? '4049' : '5059'
  return `/assets/images/${decade}-${profile.value.patientBodytype}/01.png`
})

async function beginSession(): Promise<void> {
  errorMessage.value = ''
  status.value = 'creating'

  try {
    sessionId.value ??= (await api.createSession()).sessionId
    profile.value = await api.setupSession(sessionId.value)
    status.value = 'ready'
  } catch (error) {
    status.value = 'error'
    errorMessage.value = readableError(error)
  }
}

async function sendQuestion(): Promise<void> {
  const text = question.value.trim()
  if (!sessionId.value || !profile.value || !text || pending.value) return

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

function calculateAge(dob: string): number {
  const birthDate = new Date(`${dob}T00:00:00`)
  if (Number.isNaN(birthDate.getTime())) return 30
  const today = new Date()
  let age = today.getFullYear() - birthDate.getFullYear()
  if (today.getMonth() < birthDate.getMonth() || (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())) age -= 1
  return Math.max(0, age)
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The patient service could not complete the request.'
  if (message.includes('404') || message.includes('Not Found')) {
    return 'The GPTMD API is still a health-check scaffold. Patient session and setup endpoints have not been migrated yet.'
  }
  return message
}
</script>

<style scoped>
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

.status-creating, .status-working {
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
