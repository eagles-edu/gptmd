export interface PatientProfile {
  patientName: string
  patientDob: string
  patientBodytype: 'average' | 'heavy'
  patientReason: string
}

export interface CreateSessionResult {
  sessionId: string
}

interface SetupResult {
  profile: PatientProfile
}

interface TurnResult {
  turnId: string
  text: string
}

function isPatientProfile(value: unknown): value is PatientProfile {
  if (typeof value !== 'object' || value === null) return false
  const profile = value as Record<string, unknown>
  return typeof profile.patientName === 'string'
    && typeof profile.patientDob === 'string'
    && (profile.patientBodytype === 'average' || profile.patientBodytype === 'heavy')
    && typeof profile.patientReason === 'string'
}

function getApiBase(): string {
  const config = useRuntimeConfig()
  return String(config.public.apiBase).replace(/\/$/, '')
}

export function usePatientApi() {
  async function createSession(): Promise<CreateSessionResult> {
    const result = await $fetch<{ sessionId?: unknown }>(`${getApiBase()}/api/sessions`, {
      method: 'POST',
      credentials: 'include'
    })

    if (typeof result.sessionId !== 'string' || result.sessionId.length === 0) {
      throw new Error('The session service returned an invalid session response.')
    }

    return { sessionId: result.sessionId }
  }

  async function setupSession(sessionId: string): Promise<PatientProfile> {
    const result = await $fetch<SetupResult>(
      `${getApiBase()}/api/sessions/${encodeURIComponent(sessionId)}/setup`,
      { method: 'POST', credentials: 'include' }
    )

    if (!isPatientProfile(result.profile)) {
      throw new Error('The setup service returned an invalid patient profile.')
    }

    return result.profile
  }

  async function sendTurn(sessionId: string, turnId: string, text: string): Promise<TurnResult> {
    const result = await $fetch<TurnResult>(
      `${getApiBase()}/api/sessions/${encodeURIComponent(sessionId)}/turns`,
      {
        method: 'POST',
        credentials: 'include',
        body: { turnId, text }
      }
    )

    if (typeof result.text !== 'string' || result.turnId !== turnId) {
      throw new Error('The conversation service returned an invalid turn response.')
    }

    return result
  }

  return { createSession, setupSession, sendTurn }
}
