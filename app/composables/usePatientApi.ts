import {
  CreateSessionResponseSchema,
  SetupResponseSchema,
  TurnResponseSchema,
  type CreateSessionResult,
  type PatientSetupResult,
  type TurnResult
} from '../schemas/patient-api'

export type { CreateSessionResult, PatientProfile, PatientSetupResult, TurnResult } from '../schemas/patient-api'

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

  async function sendTurn(sessionId: string, turnId: string, text: string): Promise<TurnResult> {
    const result = await $fetch<unknown>(
      `${getApiBase()}/api/sessions/${encodeURIComponent(sessionId)}/turns`,
      {
        method: 'POST',
        headers: await auth.accessHeaders(),
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
