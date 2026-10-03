import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyVoiceRepair, VoiceTurnBuffer, VOICE_TURN_SILENCE_MS } from '../../app/utils/voice-turn'

afterEach(() => vi.useRealTimers())

describe('VoiceTurnBuffer', () => {
  it('waits for seven seconds of silence, combines speech segments, and submits once', () => {
    vi.useFakeTimers()
    const onReady = vi.fn()
    const turns = new VoiceTurnBuffer(onReady)

    turns.add('Could you repeat')
    vi.advanceTimersByTime(VOICE_TURN_SILENCE_MS - 1)
    expect(onReady).not.toHaveBeenCalled()

    turns.add('that please?')
    vi.advanceTimersByTime(VOICE_TURN_SILENCE_MS - 1)
    expect(onReady).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(onReady).toHaveBeenCalledExactlyOnceWith('Could you repeat that please?')
    expect(turns.pendingText).toBe('')
    vi.advanceTimersByTime(VOICE_TURN_SILENCE_MS)
    expect(onReady).toHaveBeenCalledOnce()
  })

  it('cancels pending speech when the voice conversation ends', () => {
    vi.useFakeTimers()
    const onReady = vi.fn()
    const turns = new VoiceTurnBuffer(onReady)
    turns.add('A partial question')
    turns.cancel()
    vi.advanceTimersByTime(VOICE_TURN_SILENCE_MS)

    expect(onReady).not.toHaveBeenCalled()
    expect(turns.pendingText).toBe('')
  })
})

describe('classifyVoiceRepair', () => {
  it.each([
    ['Excuse me. Repeat that please.', 'repeat'],
    ['Please speak louder.', 'louder'],
    ['Could you speak more slowly?', 'slower'],
    ['Please explain it in simpler words.', 'simpler'],
    ['What does that phrase mean?', 'explain'],
    ['Could you spell that, please?', 'spell'],
    ['Please write that down.', 'write-note'],
    ['When did the pain begin?', 'question']
  ] as const)('classifies %s as %s', (text, expected) => {
    expect(classifyVoiceRepair(text)).toBe(expected)
  })
})
