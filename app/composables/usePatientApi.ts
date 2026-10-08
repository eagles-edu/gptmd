import {
  AssessmentDraftResponseSchema,
  CreateSessionResponseSchema,
  CurrentEncounterResponseSchema,
  OwnedSessionResponseSchema,
  LocalTranscriptUtteranceSchema,
  AudioTranscriptionCallSchema,
  AssessmentSubmittedResponseSchema,
  BeginAssessmentResponseSchema,
  SetupResponseSchema,
  TurnResponseSchema,
  type CreateSessionResult,
  type CurrentEncounterResult,
  type OwnedSessionResult,
  type PatientSetupResult,
  type TurnResult
} from '../schemas/patient-api'

export type {
  CreateSessionResult,
  CurrentEncounterResult,
  OwnedSessionResult,
  PatientProfile,
  PatientSetupResult,
  TurnResult
} from '../schemas/patient-api'

function getApiBase(): string {
  const config = useRuntimeConfig()
  return String(config.public.apiBase).replace(/\/$/, '')
}

export function usePatientApi() {
  const auth = useGptmdAuth()

  async function createSession(): Promise<CreateSessionResult> {
    const result = await $fetch<unknown>(`${getApiBase()}/api/sessions`, {
      method: 'POST',
      headers: await auth.accessHeaders()
    })
    const parsed = CreateSessionResponseSchema.safeParse(result)

    if (!parsed.success) {
      throw new Error('The session service returned an invalid session response.')
    }

    return parsed.data
  }

  async function getSession(sessionId: string): Promise<OwnedSessionResult> {
    const result = await $fetch<unknown>(`${getApiBase()}/api/sessions/${encodeURIComponent(sessionId)}`, {
      headers: await auth.accessHeaders()
    })
    const parsed = OwnedSessionResponseSchema.safeParse(result)

    if (!parsed.success || parsed.data.sessionId !== sessionId) {
      throw new Error('The session service returned an invalid session response.')
    }

    return parsed.data
  }

  async function getCurrentEncounter(): Promise<CurrentEncounterResult> {
    const result = await $fetch<unknown>(`${getApiBase()}/api/encounters/current`, {
      headers: await auth.accessHeaders()
    })
    const parsed = CurrentEncounterResponseSchema.safeParse(result)
    if (!parsed.success) throw new Error('The encounter service returned an invalid recovery snapshot.')
    return parsed.data
  }

  async function setupSession(sessionId: string): Promise<PatientSetupResult> {
    const result = await $fetch<unknown>(
      `${getApiBase()}/api/sessions/${encodeURIComponent(sessionId)}/setup`,
      {
        method: 'POST',
        headers: {
          ...await auth.accessHeaders(),
          'Idempotency-Key': `scenario-setup-${sessionId}`
        }
      }
    )
    const parsed = SetupResponseSchema.safeParse(result)

    if (!parsed.success) {
      throw new Error('The setup service returned an invalid patient profile.')
    }

    return parsed.data
  }

  async function sendTurn(
    sessionId: string,
    turnId: string,
    text: string,
    modality: 'typed' | 'realtime_transcription' = 'typed'
  ): Promise<TurnResult> {
    const result = await $fetch<unknown>(
      `${getApiBase()}/api/sessions/${encodeURIComponent(sessionId)}/turns`,
      {
        method: 'POST',
        headers: await auth.accessHeaders(),
        body: { turnId, text, modality }
      }
    )
    const parsed = TurnResponseSchema.safeParse(result)

    if (!parsed.success || parsed.data.turnId !== turnId) {
      throw new Error('The conversation service returned an invalid turn response.')
    }

    return parsed.data
  }

  async function recordLocalUtterance(
    sessionId: string,
    utterance: {
      utteranceId: string
      kind: 'repair' | 'stop' | 'phase_transition' | 'patient_repeat'
      speaker: 'learner' | 'patient'
      content: string
    }
  ): Promise<import('../schemas/patient-api').LocalTranscriptUtterance> {
    const result = await $fetch<unknown>(
      `${getApiBase()}/api/sessions/${encodeURIComponent(sessionId)}/local-utterances`,
      {
        method: 'POST',
        headers: await auth.accessHeaders(),
        body: utterance
      }
    )
    const parsed = LocalTranscriptUtteranceSchema.safeParse(result)
    if (!parsed.success || parsed.data.utteranceId !== utterance.utteranceId) {
      throw new Error('The transcript service returned an invalid local utterance.')
    }
    return parsed.data
  }

  async function createAudioTranscriptionCall(sessionId: string, sdp: string): Promise<import('../schemas/patient-api').AudioTranscriptionCall> {
    const result = await $fetch<unknown>(
      `${getApiBase()}/api/sessions/${encodeURIComponent(sessionId)}/audio-transcription`,
      {
        method: 'POST',
        headers: await auth.accessHeaders(),
        body: { consentVersion: 'gptmd-audio-transcription-v1', sdp }
      }
    )
    const parsed = AudioTranscriptionCallSchema.safeParse(result)
    if (!parsed.success) throw new Error('The speech service returned an invalid transcription connection.')
    return parsed.data
  }

  async function beginAssessment(sessionId: string): Promise<void> {
    const result = await $fetch<unknown>(
      `${getApiBase()}/api/sessions/${encodeURIComponent(sessionId)}/assessment-phase`,
      { method: 'POST', headers: await auth.accessHeaders() }
    )
    if (!BeginAssessmentResponseSchema.safeParse(result).success) {
      throw new Error('The encounter service returned an invalid phase response.')
    }
  }

  async function submitAssessment(
    sessionId: string,
    assessmentId: string,
    fields: import('../schemas/patient-api').AssessmentFields
  ): Promise<import('../schemas/patient-api').AssessmentSubmittedResult> {
    const result = await $fetch<unknown>(
      `${getApiBase()}/api/sessions/${encodeURIComponent(sessionId)}/assessment`,
      {
        method: 'POST',
        headers: await auth.accessHeaders(),
        body: { assessmentId, ...fields }
      }
    )
    const parsed = AssessmentSubmittedResponseSchema.safeParse(result)
    if (!parsed.success || parsed.data.assessmentId !== assessmentId) {
      throw new Error('The encounter service returned an invalid assessment response.')
    }
    return parsed.data
  }

  async function saveAssessmentDraft(
    sessionId: string,
    revision: number,
    fields: import('../schemas/patient-api').AssessmentFields
  ): Promise<import('../schemas/patient-api').AssessmentDraft> {
    const result = await $fetch<unknown>(
      `${getApiBase()}/api/sessions/${encodeURIComponent(sessionId)}/assessment-draft`,
      {
        method: 'PUT',
        headers: await auth.accessHeaders(),
        body: { revision, ...fields }
      }
    )
    const parsed = AssessmentDraftResponseSchema.safeParse(result)
    if (!parsed.success) throw new Error('The encounter service returned an invalid assessment draft.')
    return parsed.data
  }

  return {
    createSession,
    getSession,
    getCurrentEncounter,
    setupSession,
    sendTurn,
    recordLocalUtterance,
    createAudioTranscriptionCall,
    beginAssessment,
    saveAssessmentDraft,
    submitAssessment
  }
}
