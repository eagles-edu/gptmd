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
            <p v-if="interactionMode === 'audio'"><strong>Voice privacy:</strong> microphone audio is streamed to OpenAI for live transcription. GPTpatient does not record or store raw audio; finalized text is sent through GPTpatient and appears in the encounter transcript. OpenAI processes the audio under the account’s API terms and data controls.</p>
            <p v-else><strong>Typed transcript:</strong> microphone access is not needed. You can choose voice conversation before continuing.</p>
            <p><strong>Browser storage:</strong> local storage is not a secure session vault and has no permission prompt. GPTpatient does not save account or encounter data there. Any browser request for persistent storage would be separate; this app makes no such request.</p>
          </div>

          <div class="preflight-actions">
            <label class="fictional-confirmation">
              <input v-model="fictionalDetailsConfirmed" type="checkbox">
              <span>I understand this is a fictional training scenario and will use fictional details only.</span>
            </label>
            <label v-if="interactionMode === 'audio'" class="fictional-confirmation">
              <input v-model="audioTranscriptionConsent" type="checkbox">
              <span>I agree to send my microphone audio to OpenAI for live transcription during this visit.</span>
            </label>
            <button type="button" class="continue-button" :disabled="!canContinue" @click="continueWithMode">
              Continue with {{ interactionMode === 'audio' ? 'voice' : 'transcript' }}
            </button>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog v-model="assessmentConfirmationOpen" max-width="36rem" aria-labelledby="assessment-confirmation-title">
      <v-card rounded="xl">
        <v-card-text>
          <p class="eyebrow">Change encounter phase</p>
          <h2 id="assessment-confirmation-title">Begin assessment?</h2>
          <p>This ends history taking and opens the written assessment. You can review and correct the assessment before submitting it.</p>
          <div class="assessment-actions">
            <v-btn variant="text" @click="cancelAssessmentConfirmation">Keep interviewing</v-btn>
            <v-btn color="primary" :loading="pending" @click="confirmBeginAssessment">Begin assessment</v-btn>
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
        <div class="patient-presentation">
          <section class="patient-chart" aria-labelledby="patient-chart-title">
            <div class="chart-header">
              <p>GPTpatient · New patient</p>
              <span>CHART</span>
            </div>
            <h2 id="patient-chart-title">New patient chart</h2>
            <template v-if="profile">
              <dl class="profile-fields">
                <div><dt>Name</dt><dd>{{ profile.fullName }}</dd></div>
                <div><dt>Date of birth</dt><dd>{{ profile.dateOfBirth }}</dd></div>
                <div><dt>Reason for visit</dt><dd>{{ profile.reasonForVisit }}</dd></div>
              </dl>
            </template>
            <p v-else class="empty-profile">Create a session to load the patient chart.</p>
          </section>
          <div class="profile-image-wrap">
            <v-img height="100%" :src="patientImage" :alt="profile ? `Portrait representing ${profile.fullName}` : 'Closed examination-room door'" cover />
          </div>
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
          <p v-if="profile" class="privacy-note">The diagnosis and educator answer key stay hidden during the interview.</p>

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

        <div v-if="phase === 'history' && roomEntered && messages.some((message) => message.role === 'patient')" class="phase-actions">
          <p>Ready to move from history taking to your written assessment?</p>
          <v-btn color="secondary" :disabled="pending" @click="openAssessmentConfirmation">Begin assessment</v-btn>
        </div>

        <form v-if="phase === 'history' && interactionMode === 'transcript'" class="question-form" @submit.prevent="sendQuestion">
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

        <div v-else-if="phase === 'history'" class="question-form voice-conversation-controls">
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

        <form v-else-if="phase === 'assessment'" class="question-form assessment-form" @submit.prevent="submitAssessment">
          <p>Write your clinical assessment from the information gathered in this encounter. This submission is recorded without a score; no approved case rubric is configured.</p>
          <label for="assessment-summary">Summary</label>
          <v-textarea id="assessment-summary" v-model="assessmentFields.summary" auto-grow maxlength="4000" rows="3" variant="outlined" :error-messages="assessmentFieldErrors.summary" @update:model-value="clearAssessmentFieldError('summary')" />
          <label for="assessment-differential">Differential diagnosis</label>
          <v-textarea id="assessment-differential" v-model="assessmentFields.differential" auto-grow maxlength="4000" rows="3" variant="outlined" :error-messages="assessmentFieldErrors.differential" @update:model-value="clearAssessmentFieldError('differential')" />
          <label for="assessment-rationale">Clinical rationale</label>
          <v-textarea id="assessment-rationale" v-model="assessmentFields.rationale" auto-grow maxlength="8000" rows="3" variant="outlined" :error-messages="assessmentFieldErrors.rationale" @update:model-value="clearAssessmentFieldError('rationale')" />
          <label for="assessment-plan">Plan</label>
          <v-textarea id="assessment-plan" v-model="assessmentFields.plan" auto-grow maxlength="4000" rows="3" variant="outlined" :error-messages="assessmentFieldErrors.plan" @update:model-value="clearAssessmentFieldError('plan')" />
          <p v-if="assessmentError" class="speech-message" role="alert">{{ assessmentError }}</p>
          <div class="assessment-actions">
            <v-btn color="primary" type="submit" :loading="pending" :disabled="pending">Submit unscored assessment</v-btn>
          </div>
        </form>
        <section v-else-if="phase === 'debrief'" class="question-form" aria-labelledby="assessment-complete-title">
          <h3 id="assessment-complete-title">Assessment submitted</h3>
          <p role="status" aria-live="polite">Your assessment was recorded without a score. Scoring and educator feedback are unavailable until an approved case rubric is configured.</p>
          <dl class="submitted-assessment">
            <div><dt>Summary</dt><dd>{{ assessmentFields.summary }}</dd></div>
            <div><dt>Differential diagnosis</dt><dd>{{ assessmentFields.differential }}</dd></div>
            <div><dt>Clinical rationale</dt><dd>{{ assessmentFields.rationale }}</dd></div>
            <div><dt>Plan</dt><dd>{{ assessmentFields.plan }}</dd></div>
          </dl>
        </section>

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
import type { AssessmentFields } from '../schemas/patient-api'
import { classifyVoiceRepair, isAssessmentTransitionCue, shouldSpeakPatientReply, VoiceTurnBuffer } from '../utils/voice-turn'

type EncounterStatus = 'idle' | 'creating' | 'preloading' | 'ready' | 'active' | 'working' | 'error'
type Message = { turnId: string; role: 'doctor' | 'patient'; text: string; format?: 'written' }
type InteractionMode = 'transcript' | 'audio'
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
const audioTranscriptionConsent = ref(false)
const phase = ref<'history' | 'assessment' | 'debrief'>('history')
const assessmentConfirmationOpen = ref(false)
const assessmentId = ref<string | null>(null)
const assessmentFields = ref<AssessmentFields>({ summary: '', differential: '', rationale: '', plan: '' })
const assessmentFieldErrors = ref<Partial<Record<keyof AssessmentFields, string>>>({})
const assessmentError = ref('')
const realtimeConnection = shallowRef<RTCPeerConnection | null>(null)
const realtimeEvents = shallowRef<RTCDataChannel | null>(null)
const microphoneStream = shallowRef<MediaStream | null>(null)
const microphoneContext = shallowRef<AudioContext | null>(null)
const microphoneAnalyser = shallowRef<AnalyserNode | null>(null)
const speechListening = ref(false)
const speechMessage = ref('')
const voiceConversationActive = ref(false)
const patientSpeaking = ref(false)
const lastPatientReply = ref('')
const speechVolume = ref(0.78)
const speechRate = ref(1)
let restartVoiceTimer: ReturnType<typeof setTimeout> | undefined
let voiceLimitTimer: ReturnType<typeof setTimeout> | undefined
let silenceMonitor: number | undefined
let lastAudioAt = 0
let audioSpeechDetected = false
let audioCommitSent = false
const voiceTurnBuffer = new VoiceTurnBuffer((text) => {
  stopRecognition()
  void handleVoiceUtterance(text)
})
const pending = computed(() => ['creating', 'preloading', 'working'].includes(status.value))
const canContinue = computed(() => fictionalDetailsConfirmed.value &&
  (interactionMode.value === 'transcript' || audioTranscriptionConsent.value))
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
  if (phase.value !== 'history') return 'inactive'
  if (status.value === 'error' || !roomEntered.value) return 'inactive'
  if (pending.value || patientSpeaking.value) return 'processing'
  if (interactionMode.value === 'transcript' || voiceConversationActive.value) return 'listening'
  return 'inactive'
})

const turnStatusLabel = computed(() => {
  if (phase.value === 'assessment') return 'Assessment phase · interview input is closed'
  if (phase.value === 'debrief') return 'Assessment submitted · unscored'
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

const phaseLabel = computed(() => ({
  history: profile.value ? 'History taking' : 'Intake',
  assessment: 'Assessment',
  debrief: 'Submitted · unscored'
})[phase.value])

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

function openAssessmentConfirmation(): void {
  assessmentConfirmationOpen.value = true
  if (voiceConversationActive.value) stopRecognition()
}

function cancelAssessmentConfirmation(): void {
  assessmentConfirmationOpen.value = false
  if (voiceConversationActive.value) scheduleVoiceRecognition()
}

async function confirmBeginAssessment(): Promise<void> {
  if (!sessionId.value || phase.value !== 'history' || pending.value) return
  assessmentConfirmationOpen.value = false
  stopVoiceConversation()
  status.value = 'working'
  errorMessage.value = ''
  try {
    await api.beginAssessment(sessionId.value)
    phase.value = 'assessment'
    status.value = 'active'
  } catch (error) {
    status.value = 'active'
    errorMessage.value = readableError(error)
  }
}

function clearAssessmentFieldError(field: keyof AssessmentFields): void {
  assessmentFieldErrors.value = { ...assessmentFieldErrors.value, [field]: undefined }
}

async function submitAssessment(): Promise<void> {
  if (!sessionId.value || phase.value !== 'assessment' || pending.value) return
  assessmentId.value ??= createTurnId()
  assessmentFieldErrors.value = {}
  assessmentError.value = ''
  status.value = 'working'
  try {
    await api.submitAssessment(sessionId.value, assessmentId.value, assessmentFields.value)
    phase.value = 'debrief'
    status.value = 'active'
  } catch (error) {
    const fieldErrors = readAssessmentFieldErrors(error)
    if (fieldErrors) {
      assessmentFieldErrors.value = fieldErrors
      assessmentError.value = 'Review the highlighted fields. Your draft is still here.'
    } else {
      assessmentError.value = readableError(error)
    }
    status.value = 'active'
  }
}

function readAssessmentFieldErrors(error: unknown): Partial<Record<keyof AssessmentFields, string>> | null {
  if (!error || typeof error !== 'object' || !('data' in error)) return null
  const data = (error as { data?: unknown }).data
  if (!data || typeof data !== 'object' || !('fieldErrors' in data)) return null
  const raw = (data as { fieldErrors?: unknown }).fieldErrors
  if (!raw || typeof raw !== 'object') return null
  const fields: (keyof AssessmentFields)[] = ['summary', 'differential', 'rationale', 'plan']
  const result: Partial<Record<keyof AssessmentFields, string>> = {}
  for (const field of fields) {
    const message = (raw as Record<string, unknown>)[field]
    if (typeof message === 'string') result[field] = message
  }
  return Object.keys(result).length ? result : null
}

function toggleVoiceConversation(): void {
  if (voiceConversationActive.value) {
    stopVoiceConversation()
    return
  }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
    interactionMode.value = 'transcript'
    errorMessage.value = 'Live voice transcription is unavailable in this browser. Transcript mode is available instead.'
    return
  }
  if (!audioTranscriptionConsent.value || !sessionId.value) {
    interactionMode.value = 'transcript'
    errorMessage.value = 'Accept voice transcription consent before starting. Transcript mode is available instead.'
    return
  }
  speechMessage.value = ''
  voiceConversationActive.value = true
  void startRealtimeTranscription()
}

async function startRealtimeTranscription(): Promise<void> {
  if (!voiceConversationActive.value || !sessionId.value) return
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    microphoneStream.value = stream
    const grant = await api.createAudioTranscriptionGrant(sessionId.value)
    const peer = new RTCPeerConnection()
    realtimeConnection.value = peer
    for (const track of stream.getAudioTracks()) peer.addTrack(track, stream)
    const events = peer.createDataChannel('oai-events')
    realtimeEvents.value = events
    events.onopen = () => {
      if (!voiceConversationActive.value) return
      speechListening.value = true
      speechMessage.value = 'Listening. Final questions send after seven seconds of silence.'
      monitorMicrophoneSilence()
    }
    events.onmessage = (message) => {
      if (typeof message.data !== 'string') return
      try {
        const event = JSON.parse(message.data) as { type?: string; transcript?: string }
        if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript?.trim()) {
          voiceTurnBuffer.add(event.transcript)
        } else if (event.type === 'error') {
          fallbackToTranscript('Live transcription could not process the microphone audio.')
        }
      } catch {
        if (voiceConversationActive.value) fallbackToTranscript('Live transcription returned an unreadable event.')
      }
    }
    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    await waitForIceGathering(peer)
    const sdp = peer.localDescription?.sdp
    if (!sdp) throw new Error('The browser could not prepare a secure audio connection.')
    const response = await fetch('https://api.openai.com/v1/realtime/calls', {
      method: 'POST',
      headers: { Authorization: `Bearer ${grant.clientSecret}`, 'Content-Type': 'application/sdp' },
      body: sdp
    })
    if (!response.ok) throw new Error('OpenAI could not start live transcription for this browser.')
    await peer.setRemoteDescription({ type: 'answer', sdp: await response.text() })
    voiceLimitTimer = setTimeout(() => {
      stopVoiceConversation()
      speechMessage.value = 'The 15-minute voice limit was reached. Start another voice session or use Transcript mode.'
    }, grant.maxDurationSeconds * 1_000)
  } catch (error) {
    fallbackToTranscript(error instanceof Error ? error.message : 'Live transcription is unavailable.')
  }
}

function waitForIceGathering(peer: RTCPeerConnection): Promise<void> {
  if (peer.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('The secure audio connection timed out.')), 8_000)
    peer.addEventListener('icegatheringstatechange', () => {
      if (peer.iceGatheringState !== 'complete') return
      window.clearTimeout(timeout)
      resolve()
    }, { once: true })
  })
}

function monitorMicrophoneSilence(): void {
  const stream = microphoneStream.value
  if (!stream || !voiceConversationActive.value) return
  const context = new AudioContext()
  microphoneContext.value = context
  const analyser = context.createAnalyser()
  analyser.fftSize = 512
  microphoneAnalyser.value = analyser
  context.createMediaStreamSource(stream).connect(analyser)
  const samples = new Uint8Array(analyser.fftSize)
  const sample = () => {
    if (!voiceConversationActive.value) return
    analyser.getByteTimeDomainData(samples)
    let energy = 0
    for (const value of samples) energy += (value - 128) ** 2
    const rms = Math.sqrt(energy / samples.length) / 128
    if (rms > 0.025) {
      lastAudioAt = Date.now()
      audioSpeechDetected = true
      audioCommitSent = false
    } else if (audioSpeechDetected && !audioCommitSent && Date.now() - lastAudioAt >= 700) {
      if (realtimeEvents.value?.readyState === 'open') {
        realtimeEvents.value.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
      }
      audioCommitSent = true
      audioSpeechDetected = false
    }
    silenceMonitor = requestAnimationFrame(sample)
  }
  silenceMonitor = requestAnimationFrame(sample)
}

function fallbackToTranscript(message: string): void {
  stopVoiceConversation()
  interactionMode.value = 'transcript'
  errorMessage.value = `${message} Transcript mode is available instead.`
}

function setMicrophoneEnabled(enabled: boolean): void {
  for (const track of microphoneStream.value?.getAudioTracks() ?? []) track.enabled = enabled
  speechListening.value = enabled && voiceConversationActive.value
}

function scheduleVoiceRecognition(): void {
  if (!voiceConversationActive.value) return
  if (restartVoiceTimer) clearTimeout(restartVoiceTimer)
  restartVoiceTimer = setTimeout(() => {
    restartVoiceTimer = undefined
    if (!patientSpeaking.value && !pending.value) setMicrophoneEnabled(true)
  }, 350)
}

function stopRecognition(): void {
  setMicrophoneEnabled(false)
}

function stopVoiceConversation(): void {
  voiceConversationActive.value = false
  if (restartVoiceTimer) clearTimeout(restartVoiceTimer)
  restartVoiceTimer = undefined
  if (voiceLimitTimer) clearTimeout(voiceLimitTimer)
  voiceLimitTimer = undefined
  if (silenceMonitor !== undefined) cancelAnimationFrame(silenceMonitor)
  silenceMonitor = undefined
  voiceTurnBuffer.cancel()
  stopRecognition()
  realtimeEvents.value?.close()
  realtimeConnection.value?.close()
  realtimeEvents.value = null
  realtimeConnection.value = null
  for (const track of microphoneStream.value?.getTracks() ?? []) track.stop()
  microphoneStream.value = null
  void microphoneContext.value?.close()
  microphoneContext.value = null
  microphoneAnalyser.value = null
  window.speechSynthesis?.cancel()
  patientSpeaking.value = false
  speechMessage.value = 'Voice conversation ended.'
}

function speakPatientReply(text: string): void {
  if (!shouldSpeakPatientReply(interactionMode.value, voiceConversationActive.value)) return
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
  if (phase.value === 'history' && isAssessmentTransitionCue(text)) {
    messages.value.push({ turnId: createTurnId(), role: 'doctor', text })
    openAssessmentConfirmation()
    speechMessage.value = 'Confirm whether you want to end history taking and begin the written assessment.'
    return
  }
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
  stopVoiceConversation()
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
    const result = await api.sendTurn(
      sessionId.value, turnId, text, voiceReply ? 'realtime_transcription' : 'typed'
    )
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

.patient-presentation {
  align-items: stretch;
  display: grid;
  gap: 0.85rem;
  grid-template-columns: minmax(0, 1.15fr) minmax(130px, 0.85fr);
  padding: 1rem 1rem 0;
}

.patient-chart {
  background: var(--app-surface-muted);
  border: 1px solid var(--app-border-soft);
  border-radius: 0.8rem;
  min-width: 0;
  padding: 0.9rem;
}

.chart-header {
  align-items: center;
  border-bottom: 1px solid var(--app-border-soft);
  color: var(--app-text-subtle);
  display: flex;
  font-size: 0.64rem;
  font-weight: 750;
  justify-content: space-between;
  letter-spacing: 0.06em;
  padding-bottom: 0.55rem;
  text-transform: uppercase;
}

.chart-header p {
  margin: 0;
}

.chart-header span {
  color: var(--app-accent);
}

.profile-image-wrap {
  background: var(--app-surface-muted);
  border-radius: 0.8rem;
  height: 100%;
  min-height: 260px;
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

.patient-chart h2 {
  font-size: 1.05rem;
  margin: 0.7rem 0 1rem;
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
  overflow-wrap: anywhere;
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

.phase-actions,
.assessment-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  justify-content: space-between;
}

.phase-actions {
  border-top: 1px solid var(--app-border-soft);
  margin-top: 0.75rem;
  padding-top: 0.85rem;
}

.phase-actions p,
.assessment-form > p {
  color: var(--app-text-muted);
  line-height: 1.5;
  margin: 0;
}

.assessment-form {
  display: grid;
  gap: 0.55rem;
}

.assessment-form .assessment-actions {
  justify-content: flex-end;
  margin-top: 0.5rem;
}

.submitted-assessment {
  display: grid;
  gap: 0.75rem;
  margin-top: 1rem;
}

.submitted-assessment dt {
  color: var(--app-text-muted);
  font-size: 0.84rem;
  font-weight: 700;
}

.submitted-assessment dd {
  margin: 0.2rem 0 0;
  white-space: pre-wrap;
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

  .patient-presentation {
    grid-template-columns: minmax(0, 1fr);
  }

  .profile-image-wrap {
    height: min(65vw, 360px);
    min-height: 220px;
  }

  .conversation-card {
    min-height: 560px;
  }

  .transcript {
    min-height: 280px;
  }
}
</style>
