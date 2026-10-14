import { describe, expect, it, vi } from 'vitest'
import { resolvePatientVoice, waitForSpeechSynthesisVoices } from '../../app/utils/patient-variant-voice'

type MockVoice = Pick<SpeechSynthesisVoice, 'voiceURI'>

class MockSynthesis extends EventTarget {
  voices: MockVoice[] = []

  getVoices(): MockVoice[] {
    return this.voices
  }
}

describe('patient variant voice resolution', () => {
  it('waits briefly for asynchronous browser voice enumeration', async () => {
    const synthesis = new MockSynthesis()
    const waiting = waitForSpeechSynthesisVoices(synthesis as unknown as SpeechSynthesis, 750)
    synthesis.voices = [{ voiceURI: 'preferred' }]
    synthesis.dispatchEvent(new Event('voiceschanged'))

    await expect(waiting).resolves.toEqual([{ voiceURI: 'preferred' }])
  })

  it('returns an empty voice list after the bounded wait expires', async () => {
    vi.useFakeTimers()
    try {
      const synthesis = new MockSynthesis()
      const waiting = waitForSpeechSynthesisVoices(synthesis as unknown as SpeechSynthesis, 750)
      await vi.advanceTimersByTimeAsync(750)
      await expect(waiting).resolves.toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })

  it('uses the configured voice first, then only the configured fallback', () => {
    const mapping = { voiceId: 'preferred', fallbackVoiceId: 'fallback' }
    const preferred = { voiceURI: 'preferred' }
    const fallback = { voiceURI: 'fallback' }

    expect(resolvePatientVoice(mapping, [preferred, fallback])).toEqual({ voice: preferred, usedFallback: false })
    expect(resolvePatientVoice(mapping, [fallback])).toEqual({ voice: fallback, usedFallback: true })
    expect(resolvePatientVoice(mapping, [])).toEqual({ voice: null, usedFallback: false })
  })
})
