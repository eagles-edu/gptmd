import {
  CreateSessionResponseSchema,
  SetupResponseSchema,
  TurnResponseSchema,
  type CreateSessionResult,
  type PatientProfile,
  type TurnResult
} from '../schemas/patient-api'

export type { CreateSessionResult, PatientProfile, TurnResult } from '../schemas/patient-api'

function getApiBase(): string {
  const config = useRuntimeConfig()
  return String(config.public.apiBase).replace(/\/$/, '')
}

export function usePatientApi() {
  async function createSession(): Promise<CreateSessionResult> {
    const result = await $fetch<unknown>(`${getApiBase()}/api/sessions`, {
      method: 'POST',
      credentials: 'include'
    })
    const parsed = CreateSessionResponseSchema.safeParse(result)

    if (!parsed.success) {
      throw new Error('The session service returned an invalid session response.')
    }

    return parsed.data
  }

  async function setupSession(sessionId: string): Promise<PatientProfile> {
    const result = await $fetch<unknown>(
      `${getApiBase()}/api/sessions/${encodeURIComponent(sessionId)}/setup`,
      { method: 'POST', credentials: 'include' }
    )
    const parsed = SetupResponseSchema.safeParse(result)

    if (!parsed.success) {
      throw new Error('The setup service returned an invalid patient profile.')
    }

    return parsed.data.profile
  }

  async function sendTurn(sessionId: string, turnId: string, text: string): Promise<TurnResult> {
    const result = await $fetch<unknown>(
      `${getApiBase()}/api/sessions/${encodeURIComponent(sessionId)}/turns`,
      {
        method: 'POST',
        credentials: 'include',
        body: { turnId, text }
      }
    )
    const parsed = TurnResponseSchema.safeParse(result)

    if (!parsed.success || parsed.data.turnId !== turnId) {
      throw new Error('The conversation service returned an invalid turn response.')
    }

    return parsed.data
  }

  return { createSession, setupSession, sendTurn }
}
