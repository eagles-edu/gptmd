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
              <span><strong>Transcript</strong><small>Type each question and read the patient's replies.</small></span>
            </label>
            <label class="mode-option">
              <input v-model="interactionMode" type="radio" name="interaction-mode" value="audio">
              <span><strong>Voice conversation</strong><small>Speak one question at a time, hear the patient reply, and follow the readable transcript.</small></span>
            </label>
          </fieldset>

          <div class="readiness-details">
            <p v-if="interactionMode === 'audio'"><strong>Voice privacy:</strong> the browser may send speech to its recognition service. GPTpatient does not record or store raw audio. The recognized question and patient reply appear in the encounter transcript.</p>
            <p v-else><strong>Typed transcript:</strong> microphone access is not needed. You can choose voice conversation before continuing.</p>
            <p><strong>Browser storage:</strong> local storage is not a secure session vault and has no permission prompt. GPTpatient does not save account or encounter data there. Any browser request for persistent storage would be separate; this app makes no such request.</p>
          </div>

          <div class="preflight-actions">
            <label class="fictional-confirmation">
              <input v-model="fictionalDetailsConfirmed" type="checkbox">
              <span>I understand this is a fictional training scenario and will use fictional details only.</span>
            </label>
            <button type="button" class="continue-button" :disabled="!canContinue" @click="continueWithMode">
              Continue with {{ interactionMode === 'audio' ? 'voice' : 'transcript' }}
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
            <span class="status-dot" :class="`status-${turnLed}`" aria-hidden="true" />
            <span role="status" aria-live="polite">{{ turnStatusLabel }}</span>
          </div>
          <ol class="setup-readiness" aria-label="Patient setup readiness">
            <li :data-ready="backendReady" :class="{ 'is-ready': backendReady }">
              Patient profile and Redis state
            </li>
            <li :data-ready="imageReady" :class="{ 'is-ready': imageReady }">
              Patient portrait loaded
            </li>
            <li :data-ready="inputReady" :class="{ 'is-ready': inputReady }">
              Interview input available
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
            <p class="eyebrow">{{ interactionMode === 'audio' ? 'Voice conversation' : 'Transcript mode' }}</p>
            <h2>Clinical interview</h2>
          </div>
          <span class="phase-chip">{{ phaseLabel }}</span>
        </div>

        <div class="transcript" aria-live="polite" aria-relevant="additions text">
          <p v-if="messages.length === 0" class="transcript-empty">
            Start the session, then ask about the concern that brought the patient in. Let the history unfold through your questions.
          </p>
          <article v-for="(message, index) in messages" :key="`${message.turnId}-${message.role}-${index}`" class="message" :class="`message-${message.role}`">
            <span class="message-label">
              {{ message.role === 'doctor' ? 'You' : message.format === 'written' ? 'Patient · written note' : 'Patient' }}
            </span>
            <p>{{ message.text }}</p>
            <button v-if="message.role === 'patient' && message.format === 'written'" class="download-note-button" type="button" @click="downloadWrittenNote(message.text)">
              Download note to take home
            </button>
          </article>
          <p v-if="status === 'working' && profile" class="working-message">The patient is responding…</p>
        </div>

        <form v-if="interactionMode === 'transcript'" class="question-form" @submit.prevent="sendQuestion">
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
            <span class="mode-note">Use voice conversation for spoken questions and replies.</span>
            <v-btn color="primary" type="submit" :disabled="!roomEntered || !question.trim() || pending" :loading="pending">
              Send question
            </v-btn>
          </div>
        </form>

        <div v-else class="question-form voice-conversation-controls">
          <p class="voice-input-note">Wait for the green light before speaking. Your final question sends automatically after seven seconds of silence; the patient replies aloud.</p>
          <div class="voice-input-row">
            <button type="button" class="voice-input-button" :disabled="!roomEntered" @click="toggleVoiceConversation">
              {{ voiceConversationActive ? 'End voice conversation' : 'Start voice conversation' }}
            </button>
            <span v-if="speechListening" class="voice-listening-indicator">Listening</span>
          </div>
          <section class="repair-phrases" aria-label="Conversation repair sequence">
            <p>Keep the conversation moving: volley one repair request at a time, and move on only if you still do not understand.</p>
            <ol>
              <li>Ask the patient to repeat it. Ask again as many as three or four times if needed.</li>
              <li>Ask them to speak louder, slower, or more simply.</li>
              <li>Ask what an unfamiliar word or phrase means, or ask them to explain it another way.</li>
              <li>Ask them to spell the word or phrase.</li>
              <li>If those steps do not work, ask them to write it down in English. Keep the original wording and download it to take home.</li>
            </ol>
          </section>
          <p v-if="speechMessage" class="speech-message" role="status" aria-live="polite">{{ speechMessage }}</p>
        </div>

        <v-alert v-if="errorMessage" class="api-error" type="warning" variant="tonal" role="status">
          {{ errorMessage }}
        </v-alert>
      </v-card>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef } from 'vue'
import { usePatientApi, type PatientProfile } from '../composables/usePatientApi'
import { classifyVoiceRepair, VoiceTurnBuffer } from '../utils/voice-turn'

type EncounterStatus = 'idle' | 'creating' | 'preloading' | 'ready' | 'active' | 'working' | 'error'
type Message = { turnId: string; role: 'doctor' | 'patient'; text: string; format?: 'written' }
type InteractionMode = 'transcript' | 'audio'
type SpeechResultLike = ArrayLike<{ transcript: string }> & { isFinal: boolean }
type SpeechRecognitionResultEventLike = { resultIndex: number; results: ArrayLike<SpeechResultLike> }
type SpeechRecognitionErrorEventLike = { error: string }
type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  onstart: (() => void) | null
  onresult: ((event: SpeechRecognitionResultEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type SpeechRecognitionConstructor = new() => SpeechRecognitionLike
type SpeechRecognitionWindow = Window & {
  SpeechRecognition?: SpeechRecognitionConstructor
}

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
const interactionMode = ref<InteractionMode>('audio')
const fictionalDetailsConfirmed = ref(false)
const speechRecognition = shallowRef<SpeechRecognitionLike | null>(null)
const speechListening = ref(false)
const speechMessage = ref('')
const voiceConversationActive = ref(false)
const patientSpeaking = ref(false)
const lastPatientReply = ref('')
const speechVolume = ref(0.78)
const speechRate = ref(1)
let restartVoiceTimer: ReturnType<typeof setTimeout> | undefined
const voiceTurnBuffer = new VoiceTurnBuffer((text) => {
  stopRecognition()
  void handleVoiceUtterance(text)
})
const pending = computed(() => ['creating', 'preloading', 'working'].includes(status.value))
const canContinue = computed(() => fictionalDetailsConfirmed.value)
const inputReady = computed(() => true)
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

const turnLed = computed(() => {
  if (status.value === 'error' || !roomEntered.value) return 'inactive'
  if (pending.value || patientSpeaking.value) return 'processing'
  if (interactionMode.value === 'transcript' || voiceConversationActive.value) return 'listening'
  return 'inactive'
})

const turnStatusLabel = computed(() => {
  if (turnLed.value === 'processing') {
    return patientSpeaking.value ? 'Patient speaking · please wait for the green light' : statusLabel.value
  }
  if (turnLed.value === 'listening') {
    return voiceConversationActive.value ? 'Green light · your turn; questions send after seven seconds of silence' : 'Green light · your turn to ask a question'
  }
  if (status.value === 'ready') return 'Red light · enter the room when ready'
  if (status.value === 'error') return 'Red light · session needs attention'
  if (roomEntered.value) return 'Red light · voice conversation inactive'
  return statusLabel.value
})

const phaseLabel = computed(() => profile.value ? 'History taking' : 'Intake')

const patientImage = computed(() => {
  if (!profile.value) return '/assets/images/door.webp'
  const age = calculateAge(profile.value.dateOfBirth)
  const decade = age < 20 ? '1019' : age < 30 ? '2029' : age < 40 ? '3039' : age < 50 ? '4049' : '5059'
  return `/assets/images/${decade}-${profile.value.bodyType}/01.png`
})

function continueWithMode(): void {
  if (!canContinue.value) return
  preflightOpen.value = false
}

function toggleVoiceConversation(): void {
  if (voiceConversationActive.value) {
    stopVoiceConversation()
    return
  }
  if (!(window as SpeechRecognitionWindow).SpeechRecognition) {
    interactionMode.value = 'transcript'
    errorMessage.value = 'Voice recognition is unavailable in this browser, so the transcript input is available instead.'
    return
  }
  speechMessage.value = ''
  voiceConversationActive.value = true
  startVoiceRecognition()
}

function startVoiceRecognition(): void {
  if (!voiceConversationActive.value || pending.value || patientSpeaking.value) return
  const Recognition = (window as SpeechRecognitionWindow).SpeechRecognition
  if (!Recognition) {
    stopVoiceConversation()
    speechMessage.value = 'Voice recognition is unavailable. Choose Transcript mode to continue.'
    return
  }

  const recognition = new Recognition()
  recognition.lang = 'en-US'
  recognition.interimResults = false
  recognition.continuous = false
  recognition.onstart = () => {
    speechListening.value = true
    speechMessage.value = 'Listening. Your question sends after seven seconds of silence.'
  }
  recognition.onresult = (event) => {
    let completedSegment = ''
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index]
      if (result?.isFinal) completedSegment += ` ${result[0]?.transcript ?? ''}`
    }
    if (completedSegment.trim() && voiceConversationActive.value) voiceTurnBuffer.add(completedSegment)
  }
  recognition.onerror = (event) => {
    speechListening.value = false
    speechRecognition.value = null
    if (event.error === 'no-speech') {
      scheduleVoiceRecognition()
      return
    }
    const message = event.error === 'not-allowed' || event.error === 'service-not-allowed'
      ? 'Microphone or speech permission was denied. Transcript input is available instead.'
      : event.error === 'audio-capture'
        ? 'No usable microphone was found. Transcript input is available instead.'
        : 'Voice conversation stopped. Transcript input is available instead.'
    stopVoiceConversation()
    interactionMode.value = 'transcript'
    errorMessage.value = message
  }
  recognition.onend = () => {
    speechListening.value = false
    speechRecognition.value = null
    scheduleVoiceRecognition()
  }

  speechRecognition.value = recognition
  try {
    recognition.start()
  } catch {
    speechRecognition.value = null
    speechListening.value = false
    stopVoiceConversation()
    interactionMode.value = 'transcript'
    errorMessage.value = 'Voice recognition could not start. Transcript input is available instead.'
  }
}

function scheduleVoiceRecognition(): void {
  if (!voiceConversationActive.value || patientSpeaking.value || pending.value) return
  if (restartVoiceTimer) clearTimeout(restartVoiceTimer)
  restartVoiceTimer = setTimeout(() => {
    restartVoiceTimer = undefined
    startVoiceRecognition()
  }, 350)
}

function stopRecognition(): void {
  const recognition = speechRecognition.value
  if (recognition) {
    recognition.onstart = null
    recognition.onresult = null
    recognition.onend = null
    recognition.onerror = null
    recognition.abort()
  }
  speechRecognition.value = null
  speechListening.value = false
}

function stopVoiceConversation(): void {
  voiceConversationActive.value = false
  if (restartVoiceTimer) clearTimeout(restartVoiceTimer)
  restartVoiceTimer = undefined
  voiceTurnBuffer.cancel()
  stopRecognition()
  window.speechSynthesis?.cancel()
  patientSpeaking.value = false
  speechMessage.value = 'Voice conversation ended.'
}

function speakPatientReply(text: string): void {
  if (!voiceConversationActive.value) return
  if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
    speechMessage.value = 'The reply is in the transcript. Spoken replies are unavailable in this browser.'
    status.value = 'active'
    scheduleVoiceRecognition()
    return
  }
  if (restartVoiceTimer) clearTimeout(restartVoiceTimer)
  restartVoiceTimer = undefined
  stopRecognition()
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'en-US'
  utterance.volume = speechVolume.value
  utterance.rate = speechRate.value
  patientSpeaking.value = true
  utterance.onend = () => {
    patientSpeaking.value = false
    status.value = 'active'
    scheduleVoiceRecognition()
  }
  utterance.onerror = () => {
    if (patientSpeaking.value) speechMessage.value = 'The reply is in the transcript. Spoken playback could not start.'
    patientSpeaking.value = false
    status.value = 'active'
    scheduleVoiceRecognition()
  }
  status.value = 'working'
  speechMessage.value = 'The patient is speaking. Wait for the green light before your next turn.'
  window.speechSynthesis.speak(utterance)
}

async function handleVoiceUtterance(text: string): Promise<void> {
  const action = classifyVoiceRepair(text)
  if (/\bsee you next time\b/i.test(text)) {
    messages.value.push({ turnId: createTurnId(), role: 'doctor', text })
    stopVoiceConversation()
    return
  }
  if (action === 'repeat' || action === 'louder' || action === 'slower') {
    messages.value.push({ turnId: createTurnId(), role: 'doctor', text })
    if (action === 'louder') speechVolume.value = 1
    if (action === 'slower') speechRate.value = 0.78
    repeatLastReply(action === 'repeat' ? 'Repeating the last reply.' : action === 'louder' ? 'I’ll speak louder.' : 'I’ll speak more slowly.')
    return
  }
  await submitQuestion(text, true, action === 'write-note')
}

function repeatLastReply(statusText = 'Repeating the last reply.'): void {
  if (!lastPatientReply.value) {
    speechMessage.value = 'There is no patient reply to repeat yet.'
    status.value = 'active'
    scheduleVoiceRecognition()
    return
  }
  if (!voiceConversationActive.value) {
    speechMessage.value = 'Start the voice conversation to hear the reply again.'
    return
  }
  speechMessage.value = statusText
  speakPatientReply(lastPatientReply.value)
}

onBeforeUnmount(() => {
  voiceConversationActive.value = false
  voiceTurnBuffer.cancel()
  if (restartVoiceTimer) clearTimeout(restartVoiceTimer)
  stopRecognition()
  window.speechSynthesis?.cancel()
})

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

function downloadWrittenNote(text: string): void {
  const file = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = 'gptmd-patient-note.txt'
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
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
  await submitQuestion(question.value, false)
}

async function submitQuestion(input: string, voiceReply: boolean, writtenReply = false): Promise<void> {
  const text = input.trim()
  if (!sessionId.value || !profile.value || !roomEntered.value || !text || pending.value) return

  const turnId = createTurnId()
  messages.value.push({ turnId, role: 'doctor', text })
  question.value = ''
  errorMessage.value = ''
  status.value = 'working'

  try {
    const result = await api.sendTurn(sessionId.value, turnId, text)
    lastPatientReply.value = result.text
    messages.value.push({ turnId, role: 'patient', text: result.text, ...(writtenReply ? { format: 'written' as const } : {}) })
    if (voiceReply && writtenReply) {
      status.value = 'active'
      speechMessage.value = 'The patient wrote a note. Listening will resume.'
      scheduleVoiceRecognition()
    } else if (voiceReply) speakPatientReply(result.text)
    else status.value = 'active'
  } catch (error) {
    question.value = text
    status.value = 'error'
    errorMessage.value = readableError(error)
    if (voiceReply) stopVoiceConversation()
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
.readiness-details p {
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

.continue-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
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

.status-listening {
  background: var(--app-success);
  box-shadow: 0 0 0 4px var(--app-success-soft);
}

.status-processing {
  background: var(--app-warning);
  box-shadow: 0 0 0 4px var(--app-warning-soft);
}

.status-inactive, .status-error {
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

.download-note-button {
  background: transparent;
  border: 1px solid var(--app-border);
  border-radius: 0.45rem;
  color: var(--app-accent);
  cursor: pointer;
  font: inherit;
  font-size: 0.82rem;
  font-weight: 700;
  margin-top: 0.55rem;
  min-height: 2.4rem;
  padding: 0.4rem 0.65rem;
}

.download-note-button:focus-visible {
  outline: 3px solid #c27b43;
  outline-offset: 2px;
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

.voice-input-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.65rem;
}

.voice-input-button {
  background: var(--app-surface-accent);
  border: 1px solid var(--app-border);
  border-radius: 0.55rem;
  color: var(--app-accent);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  min-height: 2.75rem;
  padding: 0.6rem 0.9rem;
}

.voice-input-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.voice-input-button:focus-visible {
  outline: 3px solid #c27b43;
  outline-offset: 3px;
}

.voice-listening-indicator {
  color: var(--app-accent);
  font-size: 0.9rem;
  font-weight: 750;
}

.repair-phrases {
  border-top: 1px solid var(--app-border-soft);
  margin: 0.9rem 0 0;
  padding-top: 0.75rem;
  color: var(--app-text-subtle);
  font-size: 0.9rem;
  line-height: 1.45;
}

.repair-phrases p {
  margin: 0;
}

.repair-phrases ol {
  display: grid;
  gap: 0.3rem;
  margin: 0.45rem 0 0;
  padding-left: 1.35rem;
}

.voice-input-note,
.speech-message {
  color: var(--app-text-subtle);
  font-size: 0.82rem;
  line-height: 1.45;
  margin: 0;
}

.speech-message {
  margin-top: 0.45rem;
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
