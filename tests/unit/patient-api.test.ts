import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePatientApi } from '../../app/composables/usePatientApi'

const fetchMock = vi.fn()

describe('patient API response contracts', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('useRuntimeConfig', () => ({ public: { apiBase: 'https://api.example.test/' } }))
    vi.stubGlobal('$fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('creates a session and normalizes the configured API base', async () => {
    fetchMock.mockResolvedValue({ sessionId: 'session-123' })

    await expect(usePatientApi().createSession()).resolves.toEqual({ sessionId: 'session-123' })
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.test/api/sessions', {
      method: 'POST',
      credentials: 'include'
    })
  })

  it.each([undefined, '', 42, null])('rejects an invalid session response: %s', async (sessionId) => {
    fetchMock.mockResolvedValue({ sessionId })

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
    const profile = {
      fullName: 'Ari Nguyen',
      dateOfBirth: '1990-01-01',
      bodyType: 'average',
      reasonForVisit: 'Pelvic pain'
    }
    fetchMock.mockResolvedValue({ profile })

    await expect(usePatientApi().setupSession('session / one')).resolves.toEqual(profile)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/api/sessions/session%20%2F%20one/setup',
      { method: 'POST', credentials: 'include' }
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
        credentials: 'include',
        body: { turnId: 'turn-1', text: 'Question' }
      }
    )
  })
})
