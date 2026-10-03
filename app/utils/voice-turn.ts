export const VOICE_TURN_SILENCE_MS = 7_000

export type VoiceRepairAction = 'repeat' | 'louder' | 'slower' | 'simpler' | 'explain' | 'spell' | 'write-note' | 'question'

const normalizeSpeech = (text: string): string => text
  .toLocaleLowerCase('en-US')
  .replace(/[^a-z\s']/g, ' ')
  .replace(/\s+/g, ' ')
  .trim()

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

  constructor(
    private readonly onReady: (transcript: string) => void,
    private readonly silenceMs = VOICE_TURN_SILENCE_MS
  ) {}

  add(segment: string): void {
    const text = segment.trim()
    if (!text) return
    this.transcript = [this.transcript, text].filter(Boolean).join(' ').trim()
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      const completed = this.flush()
      if (completed) this.onReady(completed)
    }, this.silenceMs)
  }

  flush(): string {
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
    const completed = this.transcript
    this.transcript = ''
    return completed
  }

  cancel(): void {
    this.flush()
  }

  get pendingText(): string {
    return this.transcript
  }
}
