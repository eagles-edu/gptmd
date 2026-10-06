export const VOICE_TURN_SILENCE_MS = 7_000
export const MICROPHONE_TURN_SILENCE_MS = 700
export const MICROPHONE_SPEECH_RMS_THRESHOLD = 0.025

/** Commits one Realtime input-audio buffer after client-detected speech ends. */
export class MicrophoneSilenceCommitter {
  private lastSpeechAt: number | null = null

  constructor(
    private readonly onCommit: () => void,
    private readonly silenceMs = MICROPHONE_TURN_SILENCE_MS,
    private readonly speechRmsThreshold = MICROPHONE_SPEECH_RMS_THRESHOLD
  ) {}

  sample(rms: number, nowMs: number): boolean {
    if (rms > this.speechRmsThreshold) {
      this.lastSpeechAt = nowMs
      return false
    }
    if (this.lastSpeechAt === null || nowMs - this.lastSpeechAt < this.silenceMs) return false
    this.lastSpeechAt = null
    this.onCommit()
    return true
  }

  reset(): void {
    this.lastSpeechAt = null
  }
}

export type VoiceRepairAction = 'repeat' | 'louder' | 'slower' | 'simpler' | 'explain' | 'spell' | 'write-note' | 'question'
export type VoiceInteractionMode = 'transcript' | 'audio'

/** Browser TTS is enabled only during an explicitly started voice conversation. */
export function shouldSpeakPatientReply(mode: VoiceInteractionMode, voiceConversationActive: boolean): boolean {
  return mode === 'audio' && voiceConversationActive
}

const normalizeSpeech = (text: string): string => text
  .toLocaleLowerCase('en-US')
  .replace(/[^a-z\s']/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

/** Identify spoken requests that may change the encounter phase and need confirmation. */
export function isAssessmentTransitionCue(text: string): boolean {
  const normalized = normalizeSpeech(text)
  return /\b(?:begin|start) (?:the )?(?:written )?assessment\b/.test(normalized) ||
    /\bmove on to (?:the )?(?:written )?assessment\b/.test(normalized) ||
    /\b(?:ready|time) for (?:the )?(?:written )?assessment\b/.test(normalized)
}

export function classifyVoiceRepair(text: string): VoiceRepairAction {
  const normalized = normalizeSpeech(text)
  if (/\bwrite (?:that|it) down\b|\bwrite (?:that|it) for me\b/.test(normalized)) return 'write-note'
  if (/\bspell (?:that|it|the word)\b/.test(normalized)) return 'spell'
  if (/\b(?:speak|talk) louder\b/.test(normalized)) return 'louder'
  if (/\b(?:speak|talk) (?:slower|more slowly)\b/.test(normalized)) return 'slower'
  if (/\b(?:speak|say|explain) (?:it )?(?:more simply|in simpler words|simpler)\b/.test(normalized)) return 'simpler'
  if (/\bwhat does .+ mean\b|\bwhat do you mean\b|\bexplain .+ another way\b|\bexplain .+ differently\b/.test(normalized)) return 'explain'
  if (/\b(?:repeat|say) (?:that|it|the question)\b|\bcould you repeat\b/.test(normalized)) return 'repeat'
  return 'question'
}

/** Collect finalized recognition segments and submit once after the configured quiet period. */
export class VoiceTurnBuffer {
  private transcript = ''
  private timer: ReturnType<typeof setTimeout> | undefined
  private capturedAt = ''

  constructor(
    private readonly onReady: (transcript: string, capturedAt: string) => void,
    private readonly silenceMs = VOICE_TURN_SILENCE_MS
  ) {}

  add(segment: string): void {
    const text = segment.trim()
    if (!text) return
    this.transcript = [this.transcript, text].filter(Boolean).join(' ').trim()
    this.capturedAt = new Date().toISOString()
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      const capturedAt = this.capturedAt
      const completed = this.flush()
      if (completed) this.onReady(completed, capturedAt)
    }, this.silenceMs)
  }

  flush(): string {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const completed = this.transcript
    this.transcript = ''
    this.capturedAt = ''
    return completed
  }

  cancel(): void {
    this.flush()
  }

  get pendingText(): string {
    return this.transcript
  }
}
