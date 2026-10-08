<template>
  <section
    class="encounter-page"
    aria-label="Patient encounter"
    :data-tts-requested-at="ttsRequestedAt"
    :data-tts-started-at="ttsStartedAt"
    :data-tts-ended-at="ttsEndedAt"
  >
    <v-dialog v-model="restorePromptOpen" persistent max-width="36rem" aria-labelledby="restore-encounter-title">
      <v-card rounded="xl">
        <v-card-text>
          <p class="eyebrow">Encounter recovery</p>
          <h2 id="restore-encounter-title">A visit is in progress</h2>
          <p v-if="recoverableEncounter?.patient">
            Resume this visit with {{ recoverableEncounter.transcript.length }} saved question-and-answer {{ recoverableEncounter.transcript.length === 1 ? 'pair' : 'pairs' }}, or start a new patient visit.
          </p>
          <p v-else>
            A patient setup is already in progress. Resume it to keep its session and setup request together.
          </p>
          <v-alert v-if="errorMessage" class="api-error" type="warning" variant="tonal" role="status">
            {{ errorMessage }}
          </v-alert>
          <div class="assessment-actions">
            <v-btn variant="text" :disabled="pending" @click="startNewVisit">Start a new visit</v-btn>
            <v-btn color="primary" :disabled="pending" :loading="pending" @click="resumeCurrentEncounter">Resume visit</v-btn>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>

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
              <span><strong>Transcript</strong><small>Type questions and read written replies. The browser never requests microphone access.</small></span>
            </label>
            <label class="mode-option">
              <input v-model="interactionMode" type="radio" name="interaction-mode" value="audio">
              <span><strong>Voice conversation</strong><small>OpenAI transcribes your microphone audio; the patient replies in text, which this browser reads aloud.</small></span>
            </label>
          </fieldset>

          <div class="readiness-details">
            <p v-if="interactionMode === 'audio'"><strong>Voice data flow:</strong> your microphone audio goes to OpenAI Realtime for transcription only. GPTpatient sends the finalized words to the patient model; its text reply is read aloud by your browser. Patient reply audio is not sent to OpenAI. GPTpatient does not record or store raw microphone audio. OpenAI processes your audio under the account’s API terms and data controls.</p>
            <p v-else><strong>Typed transcript:</strong> type each question and read the patient's written reply. No microphone access or audio processing is used. You can choose voice conversation before continuing.</p>
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
            <button
              v-if="interactionMode === 'audio'"
              type="button"
              class="permission-button"
              :disabled="!audioTranscriptionConsent || checkingMicrophone"
              @click="checkMicrophoneAccess"
            >
              {{ checkingMicrophone ? 'Checking microphone…' : microphoneAccessGranted ? 'Microphone access ready' : 'Allow microphone access' }}
            </button>
            <p v-if="microphoneAccessGranted && interactionMode === 'audio'" class="permission-status" role="status">
              Microphone access is ready. Audio will only be sent for transcription after you enter the room.
            </p>
            <p v-if="preflightError" class="permission-error" role="alert">{{ preflightError }}</p>
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

    <div class="encounter-grid">
      <v-card class="conversation-card" rounded="xl" variant="flat">
        <div class="patient-tabs" role="tablist" aria-label="Encounter workspace">
          <button
            id="interview-tab"
            type="button"
            role="tab"
            :aria-selected="patientPanel === 'interview'"
            aria-controls="interview-panel"
            @click="patientPanel = 'interview'"
          >Interview</button>
          <button
            id="patient-chart-tab"
            type="button"
            role="tab"
            :aria-selected="patientPanel === 'chart'"
            aria-controls="patient-chart-panel"
            @click="patientPanel = 'chart'"
          >Chart</button>
        </div>
        <section v-if="patientPanel === 'chart'" id="patient-chart-panel" class="patient-chart" role="tabpanel" aria-labelledby="patient-chart-tab">
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
            <h3 class="chart-section-title">Vital signs</h3>
            <dl class="profile-fields chart-vital-fields">
              <div><dt>Pulse</dt><dd data-testid="chart-current-pulse">{{ profile.vitalSigns.currentPulse }} bpm</dd></div>
              <div><dt>Blood pressure · sitting</dt><dd>{{ formatBloodPressure(profile.vitalSigns.bpSitting) }}</dd></div>
              <div><dt>Respiratory rate</dt><dd>{{ profile.vitalSigns.respiratoryRate }} breaths/min</dd></div>
              <div v-for="reading in temperatureReadings(profile.vitalSigns)" :key="reading.site">
                <dt>Temperature · {{ reading.site }}</dt><dd>{{ reading.value }} °C</dd>
              </div>
            </dl>
          </template>
          <p v-else class="empty-profile">Preparing the patient chart…</p>
        </section>
        <section v-else id="interview-panel" class="interview-panel" role="tabpanel" aria-labelledby="interview-tab">
        <div class="conversation-heading">
          <div>
            <p class="eyebrow">{{ interactionMode === 'audio' ? 'Voice conversation' : 'Transcript mode' }}</p>
            <h1>Clinical interview</h1>
          </div>
          <span class="phase-chip">{{ phaseLabel }}</span>
        </div>

        <div class="transcript" aria-live="polite" aria-relevant="additions text">
          <p v-if="messages.length === 0" class="transcript-empty">
            Start the session, then ask about the concern that brought the patient in. Let the history unfold through your questions.
          </p>
          <article v-for="(message, index) in messages" :key="`${message.turnId}-${message.role}-${index}`" class="message" :class="`message-${message.role}`" :data-captured-at="message.capturedAt" :data-displayed-at="message.displayedAt">
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
        <v-alert v-if="pendingLocalUtterances.length" class="api-error" type="warning" variant="tonal" role="status" aria-live="polite">
          {{ localUtteranceError || `${pendingLocalUtterances.length} voice transcript item${pendingLocalUtterances.length === 1 ? '' : 's'} still need saving.` }}
          <v-btn class="local-transcript-retry" variant="text" :disabled="savingLocalUtterances" @click="flushPendingLocalUtterances">
            {{ savingLocalUtterances ? 'Saving…' : 'Retry transcript save' }}
          </v-btn>
        </v-alert>

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
            :disabled="!roomEntered || pending || Boolean(retryableTurn)"
            hide-details
            maxlength="2000"
            placeholder="Ask one natural follow-up question…"
            rows="2"
            variant="outlined"
          />
          <div class="form-actions">
            <span class="mode-note">Use voice conversation for spoken questions and replies.</span>
            <v-btn color="primary" type="submit" :disabled="!roomEntered || !question.trim() || pending" :loading="pending">
              {{ retryableTurn ? 'Retry question' : 'Send question' }}
            </v-btn>
          </div>
        </form>

        <div v-else-if="phase === 'history'" class="question-form voice-conversation-controls">
          <p class="voice-input-note">Wait for the green light before speaking. Your final question sends automatically after seven seconds of silence; the patient replies aloud.</p>
          <div class="voice-input-row">
            <button type="button" class="voice-input-button" :disabled="!roomEntered || Boolean(retryableTurn)" @click="toggleVoiceConversation">
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
          <p v-if="assessmentDraftMessage" class="assessment-draft-status" role="status" aria-live="polite">{{ assessmentDraftMessage }}</p>
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

        <v-alert v-if="errorMessage && !roomEntered" class="api-error" type="warning" variant="tonal" role="status">
          {{ errorMessage }}
        </v-alert>
        </section>
      </v-card>

      <v-card class="profile-card" rounded="xl" variant="flat">
        <div class="profile-image-wrap">
          <v-img height="100%" :src="patientImage" :alt="profile ? `Portrait representing ${profile.fullName}` : 'Closed examination-room door'" position="center 20%" cover />
        </div>
        <v-card-text>
          <div class="status-row">
            <span class="status-dot" :class="`status-${turnLed}`" aria-hidden="true" />
            <span role="status" aria-live="polite">{{ turnStatusLabel }}</span>
          </div>
          <v-alert v-if="roomEntered && errorMessage" class="api-error" type="warning" variant="tonal" role="status">
            {{ errorMessage }}
          </v-alert>
          <div v-if="roomEntered && retryableTurn" class="turn-retry-actions">
            <p role="status">The last question is still awaiting its reply. Retry it to continue; the retry keeps the same turn ID and appears once in the transcript.</p>
            <v-btn color="primary" :disabled="pending" :loading="pending" @click="retryPendingTurn">
              {{ retryableTurn.modality === 'realtime_transcription' ? 'Retry last spoken question' : 'Retry question' }}
            </v-btn>
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

          <v-btn v-if="!profile" color="primary" :loading="pending" :disabled="status !== 'error'" block @click="retryReadiness">
            {{ status === 'error' ? 'Retry patient setup' : 'Preparing patient' }}
          </v-btn>
          <v-btn v-else-if="!roomEntered" color="primary" :disabled="status !== 'error' && !canEnterRoom" block @click="status === 'error' ? retryReadiness() : enterRoom()">
            {{ status === 'error' ? 'Retry readiness' : 'Enter Room' }}
          </v-btn>
        </v-card-text>
      </v-card>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { usePatientApi, type CurrentEncounterResult, type PatientProfile } from '../composables/usePatientApi'
import type { AssessmentFields } from '../schemas/patient-api'
import { classifyVoiceRepair, isAssessmentTransitionCue, MicrophoneSilenceCommitter, shouldSpeakPatientReply, VoiceTurnBuffer } from '../utils/voice-turn'

type EncounterStatus = 'idle' | 'creating' | 'preloading' | 'ready' | 'active' | 'working' | 'error'
type Message = {
  turnId: string
  role: 'doctor' | 'patient'
  text: string
  format?: 'written'
  capturedAt: string
  displayedAt?: string
}
type RetryableTurn = {
  turnId: string
  text: string
  modality: 'typed' | 'realtime_transcription'
  capturedAt: string
  writtenReply: boolean
}
type PendingLocalUtterance = {
  utteranceId: string
  kind: 'repair' | 'stop' | 'phase_transition' | 'patient_repeat'
  speaker: 'learner' | 'patient'
  content: string
  capturedAt: string
}
type InteractionMode = 'transcript' | 'audio'
const api = usePatientApi()
const sessionId = ref<string | null>(null)
const recoverableEncounter = ref<CurrentEncounterResult['encounter']>(null)
const restorePromptOpen = ref(false)
const profile = ref<PatientProfile | null>(null)
const backendReady = ref(false)
const imageReady = ref(false)
const roomEntered = ref(false)
const question = ref('')
const messages = ref<Message[]>([])
const pendingLocalUtterances = ref<PendingLocalUtterance[]>([])
const localUtteranceError = ref('')
const savingLocalUtterances = ref(false)
const retryableTurn = ref<RetryableTurn | null>(null)
const status = ref<EncounterStatus>('idle')
const errorMessage = ref('')
const preflightOpen = ref(false)
const interactionMode = ref<InteractionMode>('audio')
const fictionalDetailsConfirmed = ref(false)
const audioTranscriptionConsent = ref(false)
const preflightComplete = ref(false)
const microphoneAccessGranted = ref(false)
const checkingMicrophone = ref(false)
const preflightError = ref('')
const phase = ref<'history' | 'assessment' | 'debrief'>('history')
const assessmentConfirmationOpen = ref(false)
const assessmentId = ref<string | null>(null)
const assessmentFields = ref<AssessmentFields>({ summary: '', differential: '', rationale: '', plan: '' })
const assessmentDraftRevision = ref(0)
const assessmentDraftMessage = ref('')
const assessmentDraftHydrating = ref(false)
const assessmentFieldErrors = ref<Partial<Record<keyof AssessmentFields, string>>>({})
const assessmentError = ref('')
const realtimeConnection = shallowRef<RTCPeerConnection | null>(null)
const realtimeEvents = shallowRef<RTCDataChannel | null>(null)
const realtimeReady = ref(false)
const microphoneStream = shallowRef<MediaStream | null>(null)
const microphoneContext = shallowRef<AudioContext | null>(null)
const microphoneAnalyser = shallowRef<AnalyserNode | null>(null)
const speechListening = ref(false)
const speechMessage = ref('')
const voiceConversationActive = ref(false)
const patientSpeaking = ref(false)
const ttsRequestedAt = ref<number | null>(null)
const ttsStartedAt = ref<number | null>(null)
const ttsEndedAt = ref<number | null>(null)
const lastPatientReply = ref('')
const speechVolume = ref(0.78)
const speechRate = ref(1)
const patientPanel = ref<'interview' | 'chart'>('interview')
let restartVoiceTimer: ReturnType<typeof setTimeout> | undefined
let voiceLimitTimer: ReturnType<typeof setTimeout> | undefined
let voiceDisconnectTimer: ReturnType<typeof setTimeout> | undefined
let assessmentDraftTimer: ReturnType<typeof setTimeout> | undefined
let assessmentDraftWrite = Promise.resolve()
let flushingLocalUtterances = false
let voiceAttemptSequence = 0
let silenceMonitor: number | undefined
const microphoneSilenceCommitter = new MicrophoneSilenceCommitter(() => {
  if (realtimeEvents.value?.readyState === 'open') {
    realtimeEvents.value.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
  }
})
const voiceTurnBuffer = new VoiceTurnBuffer((text, capturedAt) => {
  stopRecognition()
  void handleVoiceUtterance(text, capturedAt)
})
const checkingSetupRetry = ref(false)
const pending = computed(() => checkingSetupRetry.value || ['creating', 'preloading', 'working'].includes(status.value))
const canContinue = computed(() => fictionalDetailsConfirmed.value &&
  (interactionMode.value === 'transcript' || (audioTranscriptionConsent.value && microphoneAccessGranted.value)))
const inputReady = computed(() => interactionMode.value === 'transcript' || microphoneAccessGranted.value)
const canEnterRoom = computed(() =>
  status.value === 'ready' && backendReady.value && imageReady.value && inputReady.value && preflightComplete.value
)

watch(assessmentFields, () => {
  if (assessmentDraftHydrating.value || phase.value !== 'assessment' || !sessionId.value || assessmentId.value) return
  assessmentDraftRevision.value += 1
  assessmentDraftMessage.value = 'Draft not saved yet.'
  if (assessmentDraftTimer) clearTimeout(assessmentDraftTimer)
  assessmentDraftTimer = setTimeout(() => {
    assessmentDraftTimer = undefined
    enqueueAssessmentDraftSave()
  }, 500)
}, { deep: true })

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
  if (assessmentConfirmationOpen.value) return 'inactive'
  if (status.value === 'error' || !roomEntered.value) return 'inactive'
  if (retryableTurn.value && !pending.value) return 'inactive'
  if (
    pending.value || patientSpeaking.value ||
    (voiceConversationActive.value && (!realtimeReady.value || !speechListening.value))
  ) return 'processing'
  if (
    interactionMode.value === 'transcript' ||
    (voiceConversationActive.value && realtimeReady.value && speechListening.value)
  ) return 'listening'
  return 'inactive'
})

const turnStatusLabel = computed(() => {
  if (phase.value === 'assessment') return 'Assessment phase · interview input is closed'
  if (phase.value === 'debrief') return 'Assessment submitted · unscored'
  if (assessmentConfirmationOpen.value) return 'Red light · confirm or cancel assessment to continue'
  if (turnLed.value === 'processing') {
    if (patientSpeaking.value) return 'Patient speaking · please wait for the green light'
    if (voiceConversationActive.value && !realtimeReady.value) return 'Connecting microphone · waiting for the green light'
    if (voiceConversationActive.value && !speechListening.value) return 'Microphone paused · waiting for the green light'
    return statusLabel.value
  }
  if (turnLed.value === 'listening') {
    return voiceConversationActive.value ? 'Green light · your turn; questions send after seven seconds of silence' : 'Green light · your turn to ask a question'
  }
  if (retryableTurn.value) return 'Red light · retry your last question to continue'
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
  if (!profile.value) return '/assets/images/exam-room-entry-hallway-v3.webp'
  const age = calculateAge(profile.value.dateOfBirth)
  const decade = age < 20 ? '1019' : age < 30 ? '2029' : age < 40 ? '3039' : age < 50 ? '4049' : '5059'
  return `/assets/images/${decade}-${profile.value.bodyType}/portrait-prototype.webp`
})

function continueWithMode(): void {
  if (!canContinue.value) return
  preflightError.value = ''
  preflightComplete.value = true
  preflightOpen.value = false
}

function formatBloodPressure(reading: PatientProfile['vitalSigns']['bpSitting'] | null): string {
  return reading ? `${reading.systolic}/${reading.diastolic} mmHg` : 'Not measured'
}

function temperatureReadings(vitals: PatientProfile['vitalSigns']): Array<{ site: string; value: number }> {
  return [
    ['axillary', vitals.axillaryTemp],
    ['oral', vitals.oralTemp],
    ['rectal', vitals.analTemp],
    ['dermal', vitals.dermalTemp],
    ['aural', vitals.auralTemp]
  ].flatMap(([site, value]) => typeof value === 'number' ? [{ site: String(site), value }] : [])
}

async function checkMicrophoneAccess(): Promise<void> {
  preflightError.value = ''
  microphoneAccessGranted.value = false
  if (!audioTranscriptionConsent.value) {
    preflightError.value = 'Agree to live transcription before requesting microphone access.'
    return
  }
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    preflightError.value = 'This browser cannot grant secure microphone access. Choose Transcript mode instead.'
    return
  }
  checkingMicrophone.value = true
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const track of stream.getTracks()) track.stop()
    microphoneAccessGranted.value = true
  } catch (error) {
    preflightError.value = error instanceof DOMException && error.name === 'NotAllowedError'
      ? 'Microphone access was denied. Allow it in browser settings or choose Transcript mode.'
      : `Microphone access is unavailable. Choose Transcript mode instead. ${readableError(error)}`
  } finally {
    checkingMicrophone.value = false
  }
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
  await flushPendingLocalUtterances()
  if (pendingLocalUtterances.value.length) return
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
  assessmentFieldErrors.value = {}
  assessmentError.value = ''
  status.value = 'working'
  try {
    await flushAssessmentDraft()
    assessmentId.value ??= createTurnId()
    await api.submitAssessment(sessionId.value, assessmentId.value, assessmentFields.value)
    phase.value = 'debrief'
    assessmentDraftMessage.value = ''
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

function enqueueAssessmentDraftSave(): void {
  const id = sessionId.value
  if (!id || phase.value !== 'assessment' || assessmentId.value) return
  const revision = assessmentDraftRevision.value
  const fields = { ...assessmentFields.value }
  assessmentDraftMessage.value = 'Saving draft…'
  assessmentDraftWrite = assessmentDraftWrite.then(async () => {
    const saved = await api.saveAssessmentDraft(id, revision, fields)
    if (saved.revision === revision) {
      if (assessmentDraftRevision.value === revision) assessmentDraftMessage.value = 'Draft saved.'
    } else {
      assessmentDraftRevision.value = Math.max(assessmentDraftRevision.value, saved.revision)
      assessmentDraftMessage.value = 'A newer draft exists on this visit. Reload the visit to restore it.'
    }
  }).catch((error: unknown) => {
    assessmentDraftMessage.value = `Draft could not be saved. ${readableError(error)}`
  })
}

async function flushAssessmentDraft(): Promise<void> {
  if (assessmentDraftTimer) {
    clearTimeout(assessmentDraftTimer)
    assessmentDraftTimer = undefined
  }
  if (phase.value === 'assessment' && !assessmentId.value && assessmentDraftRevision.value > 0) {
    enqueueAssessmentDraftSave()
  }
  await assessmentDraftWrite
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
  void startRealtimeTranscription(++voiceAttemptSequence)
}

async function startRealtimeTranscription(attempt: number): Promise<void> {
  const isCurrentAttempt = () => voiceConversationActive.value && attempt === voiceAttemptSequence
  const activeSessionId = sessionId.value
  if (!isCurrentAttempt() || !activeSessionId) return
  let stream: MediaStream | null = null
  let pendingPeer: RTCPeerConnection | null = null
  try {
    const localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    stream = localStream
    if (!isCurrentAttempt()) {
      for (const track of localStream.getTracks()) track.stop()
      return
    }
    microphoneStream.value = localStream
    const peer = new RTCPeerConnection()
    pendingPeer = peer
    realtimeConnection.value = peer
    peer.addEventListener('connectionstatechange', () => {
      if (!isCurrentAttempt()) return
      if (peer.connectionState === 'connected') {
        if (voiceDisconnectTimer) clearTimeout(voiceDisconnectTimer)
        voiceDisconnectTimer = undefined
      } else if (peer.connectionState === 'failed' || peer.connectionState === 'closed') {
        fallbackToTranscript('The live voice connection ended.')
      } else if (peer.connectionState === 'disconnected' && !voiceDisconnectTimer) {
        voiceDisconnectTimer = setTimeout(() => {
          voiceDisconnectTimer = undefined
          if (isCurrentAttempt() && peer.connectionState !== 'connected') {
            fallbackToTranscript('The live voice connection was lost.')
          }
        }, 3_000)
      } else if (peer.connectionState !== 'disconnected' && voiceDisconnectTimer) {
        clearTimeout(voiceDisconnectTimer)
        voiceDisconnectTimer = undefined
      }
    })
    for (const track of localStream.getAudioTracks()) {
      track.addEventListener('ended', () => {
        if (isCurrentAttempt()) fallbackToTranscript('Microphone capture ended.')
      })
      peer.addTrack(track, localStream)
    }
    const events = peer.createDataChannel('oai-events')
    realtimeEvents.value = events
    events.addEventListener('close', () => {
      if (isCurrentAttempt()) fallbackToTranscript('The live transcription channel closed.')
    })
    events.addEventListener('error', () => {
      if (isCurrentAttempt()) fallbackToTranscript('The live transcription channel failed.')
    })
    events.onopen = () => {
      if (!isCurrentAttempt()) return
      realtimeReady.value = true
      speechListening.value = true
      speechMessage.value = 'Listening. Final questions send after seven seconds of silence.'
      monitorMicrophoneSilence()
    }
    events.onmessage = (message) => {
      if (!isCurrentAttempt() || typeof message.data !== 'string') return
      try {
        const event = JSON.parse(message.data) as { type?: string; transcript?: string }
        if (event.type === 'conversation.item.input_audio_transcription.completed' && event.transcript?.trim()) {
          voiceTurnBuffer.add(event.transcript)
        } else if (event.type === 'error') {
          fallbackToTranscript('Live transcription could not process the microphone audio.')
        }
      } catch {
        if (isCurrentAttempt()) fallbackToTranscript('Live transcription returned an unreadable event.')
      }
    }
    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    await waitForIceGathering(peer)
    const sdp = peer.localDescription?.sdp
    if (!sdp) throw new Error('The browser could not prepare a secure audio connection.')
    if (!isCurrentAttempt()) return
    const call = await api.createAudioTranscriptionCall(activeSessionId, sdp)
    if (!isCurrentAttempt()) {
      await peer.setRemoteDescription({ type: 'answer', sdp: call.answerSdp }).catch(() => undefined)
      peer.close()
      for (const track of localStream.getTracks()) track.stop()
      return
    }
    await peer.setRemoteDescription({ type: 'answer', sdp: call.answerSdp })
    if (!isCurrentAttempt()) {
      peer.close()
      for (const track of localStream.getTracks()) track.stop()
      return
    }
    voiceLimitTimer = setTimeout(() => {
      stopVoiceConversation()
      speechMessage.value = 'The 15-minute voice limit was reached. Start another voice session or use Transcript mode.'
    }, call.maxDurationSeconds * 1_000)
  } catch (error) {
    if (isCurrentAttempt()) {
      fallbackToTranscript(error instanceof Error ? error.message : 'Live transcription is unavailable.')
    } else {
      pendingPeer?.close()
      for (const track of stream?.getTracks() ?? []) track.stop()
    }
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
    microphoneSilenceCommitter.sample(rms, Date.now())
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

function stopVoiceConversation(flushFinalizedUtterance = true): void {
  const pendingUtterance = flushFinalizedUtterance
    ? voiceTurnBuffer.flushPending()
    : (voiceTurnBuffer.cancel(), null)
  voiceAttemptSequence += 1
  voiceConversationActive.value = false
  realtimeReady.value = false
  if (restartVoiceTimer) clearTimeout(restartVoiceTimer)
  restartVoiceTimer = undefined
  if (voiceLimitTimer) clearTimeout(voiceLimitTimer)
  voiceLimitTimer = undefined
  if (voiceDisconnectTimer) clearTimeout(voiceDisconnectTimer)
  voiceDisconnectTimer = undefined
  if (silenceMonitor !== undefined) cancelAnimationFrame(silenceMonitor)
  silenceMonitor = undefined
  microphoneSilenceCommitter.reset()
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
  if (pendingUtterance && roomEntered.value && phase.value === 'history') {
    void handleVoiceUtterance(pendingUtterance.transcript, pendingUtterance.capturedAt)
  }
}

function speakPatientReply(text: string, onPlaybackComplete?: () => void | Promise<void>): void {
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
  ttsRequestedAt.value = performance.now()
  ttsStartedAt.value = null
  ttsEndedAt.value = null
  patientSpeaking.value = true
  utterance.onstart = () => {
    ttsStartedAt.value = performance.now()
  }
  utterance.onend = () => {
    ttsEndedAt.value = performance.now()
    patientSpeaking.value = false
    status.value = 'active'
    if (onPlaybackComplete) {
      void Promise.resolve(onPlaybackComplete()).catch(() => undefined)
    } else {
      scheduleVoiceRecognition()
    }
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

function appendTranscriptMessage(
  message: Omit<Message, 'capturedAt' | 'displayedAt'>,
  capturedAt = new Date().toISOString()
): void {
  messages.value.push({ ...message, capturedAt })
  void nextTick().then(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      const renderedMessage = messages.value.find((candidate) =>
        candidate.turnId === message.turnId && candidate.role === message.role)
      if (renderedMessage) renderedMessage.displayedAt = new Date().toISOString()
      resolve()
    })
  }))
}

async function saveLocalUtterance(
  kind: PendingLocalUtterance['kind'],
  speaker: PendingLocalUtterance['speaker'],
  content: string,
  capturedAt: string
): Promise<boolean> {
  if (!sessionId.value) {
    localUtteranceError.value = 'The encounter is not available to save this voice transcript item.'
    return false
  }
  const item: PendingLocalUtterance = {
    utteranceId: createTurnId(), kind, speaker, content, capturedAt
  }
  pendingLocalUtterances.value.push(item)
  appendTranscriptMessage({
    turnId: item.utteranceId,
    role: speaker === 'learner' ? 'doctor' : 'patient',
    text: content
  }, capturedAt)
  await flushPendingLocalUtterances()
  return !pendingLocalUtterances.value.some((candidate) => candidate.utteranceId === item.utteranceId)
}

async function flushPendingLocalUtterances(): Promise<void> {
  if (flushingLocalUtterances || !sessionId.value || pendingLocalUtterances.value.length === 0) return
  flushingLocalUtterances = true
  savingLocalUtterances.value = true
  localUtteranceError.value = ''
  try {
    while (pendingLocalUtterances.value.length > 0) {
      const item = pendingLocalUtterances.value[0]
      if (!item) break
      await api.recordLocalUtterance(sessionId.value, {
        utteranceId: item.utteranceId,
        kind: item.kind,
        speaker: item.speaker,
        content: item.content
      })
      pendingLocalUtterances.value.shift()
    }
    if (voiceConversationActive.value && roomEntered.value && phase.value === 'history' &&
        !patientSpeaking.value && !assessmentConfirmationOpen.value && status.value === 'active') {
      scheduleVoiceRecognition()
    }
  } catch (error) {
    localUtteranceError.value = `A voice transcript item could not be saved. Retry using the same item ID. ${readableError(error)}`
  } finally {
    savingLocalUtterances.value = false
    flushingLocalUtterances = false
  }
}

async function handleVoiceUtterance(text: string, capturedAt: string): Promise<void> {
  if (phase.value === 'history' && isAssessmentTransitionCue(text)) {
    await saveLocalUtterance('phase_transition', 'learner', text, capturedAt)
    openAssessmentConfirmation()
    speechMessage.value = 'Confirm whether you want to end history taking and begin the written assessment.'
    return
  }
  const action = classifyVoiceRepair(text)
  if (/\bsee you next time\b/i.test(text)) {
    await saveLocalUtterance('stop', 'learner', text, capturedAt)
    stopVoiceConversation()
    return
  }
  if (action === 'repeat' || action === 'louder' || action === 'slower') {
    await saveLocalUtterance('repair', 'learner', text, capturedAt)
    if (action === 'louder') speechVolume.value = 1
    if (action === 'slower') speechRate.value = 0.78
    repeatLastReply(action === 'repeat' ? 'Repeating the last reply.' : action === 'louder' ? 'I’ll speak louder.' : 'I’ll speak more slowly.')
    return
  }
  await submitQuestion(text, true, action === 'write-note', capturedAt)
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
  const repeatedReply = lastPatientReply.value
  speakPatientReply(repeatedReply, async () => {
    await saveLocalUtterance('patient_repeat', 'patient', repeatedReply, new Date().toISOString())
  })
}

onBeforeUnmount(() => {
  void flushPendingLocalUtterances()
  void flushAssessmentDraft()
  stopVoiceConversation(false)
})

onMounted(() => {
  void beginSession()
})

async function beginSession(): Promise<void> {
  if (pending.value) return
  errorMessage.value = ''
  preflightError.value = ''
  preflightOpen.value = false
  preflightComplete.value = false
  microphoneAccessGranted.value = false
  status.value = 'creating'
  backendReady.value = false
  imageReady.value = false
  roomEntered.value = false

  try {
    const current = await api.getCurrentEncounter()
    if (current.encounter) {
      recoverableEncounter.value = current.encounter
      status.value = 'idle'
      restorePromptOpen.value = true
      return
    }
    recoverableEncounter.value = null
    await startNewPatientSession()
  } catch (error) {
    status.value = 'error'
    errorMessage.value = readableError(error)
  }
}

async function startNewVisit(): Promise<void> {
  if (pending.value) return
  await flushPendingLocalUtterances()
  if (pendingLocalUtterances.value.length) return
  restorePromptOpen.value = false
  await startNewPatientSession()
  if (status.value === 'error' && recoverableEncounter.value) restorePromptOpen.value = true
}

async function startNewPatientSession(): Promise<void> {
  resetEncounterForNewVisit()
  status.value = 'creating'
  errorMessage.value = ''
  try {
    sessionId.value = (await api.createSession()).sessionId
    await preparePatientSession(sessionId.value)
    recoverableEncounter.value = null
  } catch (error) {
    status.value = 'error'
    errorMessage.value = readableError(error)
  }
}

function resetEncounterForNewVisit(): void {
  stopVoiceConversation(false)
  sessionId.value = null
  profile.value = null
  backendReady.value = false
  imageReady.value = false
  roomEntered.value = false
  question.value = ''
  messages.value = []
  pendingLocalUtterances.value = []
  localUtteranceError.value = ''
  retryableTurn.value = null
  preflightOpen.value = false
  interactionMode.value = 'audio'
  fictionalDetailsConfirmed.value = false
  audioTranscriptionConsent.value = false
  preflightComplete.value = false
  microphoneAccessGranted.value = false
  preflightError.value = ''
  phase.value = 'history'
  assessmentId.value = null
  assessmentDraftRevision.value = 0
  assessmentDraftMessage.value = ''
  if (assessmentDraftTimer) clearTimeout(assessmentDraftTimer)
  assessmentDraftTimer = undefined
  assessmentDraftWrite = Promise.resolve()
  assessmentFields.value = { summary: '', differential: '', rationale: '', plan: '' }
  assessmentFieldErrors.value = {}
  assessmentError.value = ''
  lastPatientReply.value = ''
  patientPanel.value = 'interview'
}

async function preparePatientSession(id: string): Promise<void> {
  const setup = await api.setupSession(id)
  backendReady.value = setup.readiness.profile && setup.readiness.redis && setup.readiness.conversation
  if (!backendReady.value) throw new Error('Patient setup is incomplete. Retry setup before entering the room.')
  profile.value = setup.patient
  status.value = 'preloading'
  await preloadImage(patientImage.value)
  imageReady.value = true
  status.value = 'ready'
  preflightOpen.value = true
}

async function resumeCurrentEncounter(): Promise<void> {
  const encounter = recoverableEncounter.value
  if (!encounter || pending.value) return
  restorePromptOpen.value = false
  status.value = 'creating'
  errorMessage.value = ''
  try {
    sessionId.value = encounter.sessionId
    backendReady.value = false
    imageReady.value = false
    roomEntered.value = false
    patientPanel.value = 'chart'
    phase.value = encounter.phase ?? 'history'
    assessmentId.value = encounter.assessment?.assessmentId ?? null
    assessmentDraftHydrating.value = true
    assessmentDraftRevision.value = encounter.assessmentDraft?.revision ?? 0
    assessmentFields.value = encounter.assessment?.fields ?? encounter.assessmentDraft?.fields ?? {
      summary: '', differential: '', rationale: '', plan: ''
    }
    assessmentDraftMessage.value = encounter.assessmentDraft ? 'Draft restored.' : ''
    await nextTick()
    assessmentDraftHydrating.value = false
    const restoredMessages: Array<{ sequence: number; position: number; message: Message }> = encounter.transcript.flatMap((turn) => [
      {
        sequence: turn.sequence,
        position: 1,
        message: {
          turnId: turn.turnId, role: 'doctor' as const, text: turn.learnerMessage,
          capturedAt: turn.acceptedAt, displayedAt: new Date().toISOString()
        }
      },
      {
        sequence: turn.sequence,
        position: 2,
        message: {
          turnId: turn.turnId, role: 'patient' as const, text: turn.patientResponse,
          capturedAt: turn.acceptedAt, displayedAt: new Date().toISOString()
        }
      }
    ])
    for (const utterance of encounter.localUtterances) {
      restoredMessages.push({
        sequence: utterance.sequence,
        position: 2 + utterance.ordinal,
        message: {
          turnId: utterance.utteranceId,
          role: utterance.speaker === 'learner' ? 'doctor' : 'patient',
          text: utterance.content,
          capturedAt: utterance.occurredAt,
          displayedAt: new Date().toISOString()
        }
      })
    }
    messages.value = restoredMessages
      .sort((left, right) => left.sequence - right.sequence || left.position - right.position)
      .map(({ message }) => message)
    pendingLocalUtterances.value = []
    localUtteranceError.value = ''
    lastPatientReply.value = encounter.transcript.at(-1)?.patientResponse ?? ''
    if (!encounter.patient) {
      await preparePatientSession(encounter.sessionId)
      backendReady.value = true
    } else {
      profile.value = encounter.patient
      backendReady.value = true
      status.value = 'preloading'
      await preloadImage(patientImage.value)
      imageReady.value = true
      status.value = 'ready'
      preflightOpen.value = true
    }
    recoverableEncounter.value = null
  } catch (error) {
    status.value = 'error'
    errorMessage.value = readableError(error)
  }
}

async function retryReadiness(): Promise<void> {
  if (pending.value) return
  if (!profile.value) {
    let retryCurrentSession = false
    if (sessionId.value) {
      checkingSetupRetry.value = true
      try {
        const existingSession = await api.getSession(sessionId.value)
        if (existingSession.status === 'initializing' || existingSession.status === 'ready') {
          retryCurrentSession = true
        } else {
          sessionId.value = null
        }
      } catch (error) {
        errorMessage.value = readableError(error)
        return
      } finally {
        checkingSetupRetry.value = false
      }
    }
    if (retryCurrentSession && sessionId.value) {
      status.value = 'creating'
      errorMessage.value = ''
      try {
        await preparePatientSession(sessionId.value)
      } catch (error) {
        status.value = 'error'
        errorMessage.value = readableError(error)
      }
    } else {
      await beginSession()
    }
    return
  }

  errorMessage.value = ''
  status.value = 'preloading'
  imageReady.value = false
  try {
    await preloadImage(patientImage.value)
    imageReady.value = true
    status.value = 'ready'
    preflightOpen.value = true
  } catch (error) {
    status.value = 'error'
    errorMessage.value = readableError(error)
  }
}

function enterRoom(): void {
  if (!canEnterRoom.value) return
  patientPanel.value = 'chart'
  roomEntered.value = true
  status.value = 'active'
  if (interactionMode.value === 'audio') toggleVoiceConversation()
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
  if (retryableTurn.value) {
    await retryPendingTurn()
    return
  }
  await submitQuestion(question.value, false)
}

async function retryPendingTurn(): Promise<void> {
  const retry = retryableTurn.value
  if (!retry) return
  await submitQuestion(retry.text, retry.modality === 'realtime_transcription', retry.writtenReply, retry.capturedAt)
}

async function submitQuestion(
  input: string,
  voiceReply: boolean,
  writtenReply = false,
  capturedAt = new Date().toISOString()
): Promise<void> {
  const text = input.trim()
  if (!sessionId.value || !profile.value || !roomEntered.value || !text || pending.value) return

  const modality = voiceReply ? 'realtime_transcription' : 'typed'
  const existingRetry = retryableTurn.value
  if (existingRetry && (existingRetry.text !== text || existingRetry.modality !== modality)) return

  const turn = existingRetry ?? {
    turnId: createTurnId(),
    text,
    modality,
    capturedAt,
    writtenReply
  }
  if (!existingRetry) {
    retryableTurn.value = turn
    appendTranscriptMessage({ turnId: turn.turnId, role: 'doctor', text }, turn.capturedAt)
  }
  question.value = ''
  errorMessage.value = ''
  status.value = 'working'

  try {
    const result = await api.sendTurn(
      sessionId.value, turn.turnId, text, turn.modality
    )
    retryableTurn.value = null
    lastPatientReply.value = result.text
    appendTranscriptMessage({
      turnId: turn.turnId,
      role: 'patient',
      text: result.text,
      ...(turn.writtenReply ? { format: 'written' as const } : {})
    })
    if (voiceReply && turn.writtenReply) {
      status.value = 'active'
      if (voiceConversationActive.value) {
        speechMessage.value = 'The patient wrote a note. Listening will resume.'
        scheduleVoiceRecognition()
      } else if (interactionMode.value === 'audio') {
        speechMessage.value = 'The patient wrote a note. Start voice conversation to continue listening.'
      } else {
        speechMessage.value = 'The patient wrote a note. Continue in Transcript mode.'
      }
    } else if (voiceReply && voiceConversationActive.value) speakPatientReply(result.text)
    else if (voiceReply) {
      status.value = 'active'
      speechMessage.value = interactionMode.value === 'audio'
        ? 'The patient reply is in the transcript. Start voice conversation to continue.'
        : 'The patient reply is in the transcript. Continue by typing your next question.'
    }
    else status.value = 'active'
  } catch (error) {
    question.value = text
    status.value = 'active'
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

.permission-button {
  background: var(--app-surface, #fff);
  border: 1px solid var(--app-border, #809494);
  border-radius: 0.55rem;
  color: var(--app-text-strong, #183c43);
  cursor: pointer;
  font: inherit;
  font-weight: 700;
  justify-self: start;
  min-height: 2.7rem;
  padding: 0.55rem 0.85rem;
}

.permission-button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.permission-status,
.permission-error {
  font-size: 0.88rem;
  line-height: 1.45;
  margin: 0;
}

.permission-status {
  color: #187247;
}

.permission-error {
  color: #a32929;
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
.permission-button:focus-visible,
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
  gap: 1rem;
  grid-template-areas: "conversation profile";
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.profile-card, .conversation-card {
  background: var(--app-surface);
  border: 1px solid var(--app-border);
  box-shadow: 0 14px 36px var(--app-shadow);
}

.profile-card {
  grid-area: profile;
}

.conversation-card {
  grid-area: conversation;
}

.patient-tabs {
  border-bottom: 1px solid var(--app-border-soft);
  display: flex;
  gap: 0.35rem;
  padding: 0.75rem 0.85rem 0;
}

.patient-tabs button {
  background: transparent;
  border: 0;
  border-bottom: 2px solid transparent;
  color: var(--app-text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 0.9rem;
  font-weight: 700;
  min-height: 2.7rem;
  padding: 0 0.9rem;
}

.patient-tabs button[aria-selected="true"] {
  border-bottom-color: var(--app-accent);
  color: var(--app-text-strong);
}

.patient-tabs button:focus-visible {
  border-radius: 0.25rem;
  outline: 2px solid var(--app-accent);
  outline-offset: -3px;
}

.patient-chart {
  background: var(--app-surface-muted);
  border: 1px solid var(--app-border-soft);
  border-radius: 0.8rem;
  margin: 1rem;
  min-height: 440px;
  min-width: 0;
  padding: 1rem;
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
  height: clamp(420px, 60vh, 680px);
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
  height: 0.82rem;
  width: 0.82rem;
}

.status-listening {
  background: var(--app-success);
  box-shadow: 0 0 0 5px var(--app-success-soft);
}

.status-processing {
  background: var(--app-warning);
  box-shadow: 0 0 0 5px var(--app-warning-soft);
}

.status-inactive, .status-error {
  background: var(--app-error);
  box-shadow: 0 0 0 5px var(--app-error-soft);
}

.status-complete {
  background: #456a8c;
}

.profile-card h2, .conversation-card h1 {
  color: var(--app-text-strong);
  font-size: 1.3rem;
  margin: 0 0 1rem;
}

.conversation-card h1 {
  margin: 0.3rem 0 0;
}

.patient-chart h2 {
  font-size: 1.05rem;
  margin: 0.7rem 0 1rem;
}

.chart-section-title {
  border-top: 1px solid var(--app-border-soft);
  color: var(--app-text);
  font-size: 0.9rem;
  margin: 1rem 0 0.75rem;
  padding-top: 0.85rem;
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
  min-height: 100%;
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
    grid-template-areas: "profile" "conversation";
    grid-template-columns: minmax(0, 1fr);
  }

  .profile-image-wrap {
    height: min(112vw, 500px);
    min-height: 320px;
  }

  .patient-chart {
    min-height: 320px;
  }

  .conversation-card {
    min-height: 560px;
  }

  .transcript {
    min-height: 280px;
  }
}
</style>
