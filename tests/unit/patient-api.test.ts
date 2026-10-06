import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePatientApi } from '../../app/composables/usePatientApi'

const fetchMock = vi.fn()
const apiAuthHeaders = {
  Authorization: 'Bearer supabase-test-access-token',
  'X-GPTMD-Tenant-ID': 'tenant-test'
}

describe('patient API response contracts', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { apiBase: 'https://api.example.test/' } }))
    vi.stubGlobal('$fetch', fetchMock)
    vi.stubGlobal('useGptmdAuth', () => ({ accessHeaders: vi.fn().mockResolvedValue(apiAuthHeaders) }))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a session and normalizes the configured API base', async () => {
    const session = {
      sessionId: 's'.repeat(43),
      status: 'initializing',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      versions: {
        promptVersion: 'patient-scenario-prompt-v6',
        modelVersion: 'gpt-6-luna',
        schemaVersion: 5,
        policyVersion: 'patient-scenario-policy-v3'
      }
    }
    fetchMock.mockResolvedValue(session)

    await expect(usePatientApi().createSession()).resolves.toEqual(session)
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/api/sessions', {
      method: 'POST',
      headers: apiAuthHeaders
    })
  })

  it.each([undefined, '', 42, null, 'session-123'])('rejects an invalid session response: %s', async (sessionId) => {
    fetchMock.mockResolvedValue({ sessionId })

    await expect(usePatientApi().createSession()).rejects.toThrow(
      'The session service returned an invalid session response.'
    )
  })

  it.each([1, 2, 3, 4, 6])('rejects session responses pinned to unsupported scenario schema version %s', async (schemaVersion) => {
    fetchMock.mockResolvedValue({
      sessionId: 's'.repeat(43),
      status: 'initializing',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      versions: {
        promptVersion: 'patient-scenario-prompt-v6',
        modelVersion: 'gpt-6-luna',
        schemaVersion,
        policyVersion: 'patient-scenario-policy-v3'
      }
    })

    await expect(usePatientApi().createSession()).rejects.toThrow(
      'The session service returned an invalid session response.'
    )
  })

  it.each([
    { fullName: 4, dateOfBirth: '1990-01-01', bodyType: 'average', reasonForVisit: 'Pain' },
    { fullName: 'Ari', dateOfBirth: '1990-01-01', bodyType: 'slim', reasonForVisit: 'Pain' },
    { fullName: 'Ari', dateOfBirth: null, bodyType: 'heavy', reasonForVisit: 'Pain' },
    null
  ])('rejects a malformed patient profile', async (profile) => {
    fetchMock.mockResolvedValue({ profile })

    await expect(usePatientApi().setupSession('session / one')).rejects.toThrow(
      'The setup service returned an invalid patient profile.'
    )
  })

  it('accepts a valid profile and encodes the session identifier', async () => {
    const setup = {
      sessionId: 's'.repeat(43),
      status: 'ready',
      createdAt: '2026-10-01T00:01:00.000Z',
      patient: {
        fullName: 'Ari Nguyen',
        dateOfBirth: '1990-01-01',
        bodyType: 'average',
        reasonForVisit: 'Pelvic pain'
      },
      versions: {
        promptVersion: 'patient-scenario-prompt-v6',
        modelVersion: 'gpt-6-luna',
        schemaVersion: 5,
        policyVersion: 'patient-scenario-policy-v3'
      },
      readiness: { profile: true, redis: true, conversation: true }
    }
    fetchMock.mockResolvedValue(setup)

    await expect(usePatientApi().setupSession('session / one')).resolves.toEqual(setup)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/sessions/session%20%2F%20one/setup',
      {
        method: 'POST',
        headers: { ...apiAuthHeaders, 'Idempotency-Key': 'scenario-setup-session / one' }
      }
    )
  })

  it('rejects a response for the wrong turn and preserves the submitted turn id', async () => {
    fetchMock.mockResolvedValue({ turnId: 'another-turn', text: 'Response' })

    await expect(usePatientApi().sendTurn('session-1', 'turn-1', 'Question')).rejects.toThrow(
      'The conversation service returned an invalid turn response.'
    )
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/sessions/session-1/turns',
      {
        method: 'POST',
        headers: apiAuthHeaders,
        body: { turnId: 'turn-1', text: 'Question', modality: 'typed' }
      }
    )
  })
})
