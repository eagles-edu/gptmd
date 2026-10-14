export interface PatientVoiceMapping {
  voiceId: string
  fallbackVoiceId: string
}

export function waitForSpeechSynthesisVoices(
  synthesis: SpeechSynthesis,
  timeoutMs = 750
): Promise<SpeechSynthesisVoice[]> {
  const initialVoices = synthesis.getVoices()
  if (initialVoices.length || timeoutMs <= 0) return Promise.resolve(initialVoices)

  return new Promise((resolve) => {
    let settled = false
    const finish = (voices: SpeechSynthesisVoice[]) => {
      if (settled) return
      settled = true
      synthesis.removeEventListener('voiceschanged', onVoicesChanged)
      clearTimeout(timeout)
      resolve(voices)
    }
    const onVoicesChanged = () => {
      const voices = synthesis.getVoices()
      if (voices.length) finish(voices)
    }

    const timeout = setTimeout(() => finish(synthesis.getVoices()), timeoutMs)
    synthesis.addEventListener('voiceschanged', onVoicesChanged)
    const afterListenVoices = synthesis.getVoices()
    if (afterListenVoices.length) finish(afterListenVoices)
  })
}

export function resolvePatientVoice<T extends { voiceURI: string }>(
  mapping: PatientVoiceMapping,
  availableVoices: readonly T[]
): { voice: T | null; usedFallback: boolean } {
  const preferred = availableVoices.find((voice) => voice.voiceURI === mapping.voiceId)
  if (preferred) return { voice: preferred, usedFallback: false }
  const fallback = availableVoices.find((voice) => voice.voiceURI === mapping.fallbackVoiceId)
  return { voice: fallback ?? null, usedFallback: Boolean(fallback) }
}
