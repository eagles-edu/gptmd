import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  classifyVoiceRepair,
  isAssessmentTransitionCue,
  MicrophoneSilenceCommitter,
  MICROPHONE_SPEECH_RMS_THRESHOLD,
  MICROPHONE_TURN_SILENCE_MS,
  shouldSpeakPatientReply,
  VoiceTurnBuffer,
  VOICE_TURN_SILENCE_MS
} from '../../app/utils/voice-turn'

afterEach(() => vi.useRealTimers())

describe('VoiceTurnBuffer', () => {
  it('waits for seven seconds of silence, combines speech segments, and submits once', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-06T00:00:00.000Z'))
    const onReady = vi.fn()
    const turns = new VoiceTurnBuffer(onReady)

    turns.add('Could you repeat')
    vi.advanceTimersByTime(1_000)
    expect(onReady).not.toHaveBeenCalled()
    turns.add('that please?')
    vi.advanceTimersByTime(VOICE_TURN_SILENCE_MS - 1)
    expect(onReady).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)

    expect(onReady).toHaveBeenCalledExactlyOnceWith(
      'Could you repeat that please?',
      '2026-10-06T00:00:01.000Z'
    )
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

describe('MicrophoneSilenceCommitter', () => {
  it('commits once after the silence boundary and rearms for the next utterance', () => {
    const onCommit = vi.fn()
    const committer = new MicrophoneSilenceCommitter(onCommit)

    expect(committer.sample(0, 0)).toBe(false)
    expect(committer.sample(MICROPHONE_SPEECH_RMS_THRESHOLD + 0.01, 10)).toBe(false)
    expect(committer.sample(0, 10 + MICROPHONE_TURN_SILENCE_MS - 1)).toBe(false)
    expect(onCommit).not.toHaveBeenCalled()
    expect(committer.sample(0, 10 + MICROPHONE_TURN_SILENCE_MS)).toBe(true)
    expect(committer.sample(0, 10 + MICROPHONE_TURN_SILENCE_MS + 1)).toBe(false)
    expect(onCommit).toHaveBeenCalledOnce()

    committer.sample(MICROPHONE_SPEECH_RMS_THRESHOLD + 0.01, 2_000)
    expect(committer.sample(0, 2_000 + MICROPHONE_TURN_SILENCE_MS)).toBe(true)
    expect(onCommit).toHaveBeenCalledTimes(2)
  })

  it('resets an unfinished utterance when the voice session ends', () => {
    const onCommit = vi.fn()
    const committer = new MicrophoneSilenceCommitter(onCommit)
    committer.sample(MICROPHONE_SPEECH_RMS_THRESHOLD + 0.01, 10)
    committer.reset()

    expect(committer.sample(0, 10 + MICROPHONE_TURN_SILENCE_MS)).toBe(false)
    expect(onCommit).not.toHaveBeenCalled()
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

describe('isAssessmentTransitionCue', () => {
  it.each([
    'Begin assessment.',
    'Could we start the written assessment now?',
    'Move on to the assessment.',
    'I think it is time for assessment.'
  ])('recognizes a phase-change cue that needs confirmation: %s', (text) => {
    expect(isAssessmentTransitionCue(text)).toBe(true)
  })

  it.each([
    'What is your assessment of the pain?',
    'How would you describe the assessment?',
    'When did the pain begin?'
  ])('leaves an ordinary patient question in the history lane: %s', (text) => {
    expect(isAssessmentTransitionCue(text)).toBe(false)
  })
})

describe('shouldSpeakPatientReply', () => {
  it('speaks replies only while the learner explicitly uses an active voice conversation', () => {
    expect(shouldSpeakPatientReply('audio', true)).toBe(true)
    expect(shouldSpeakPatientReply('audio', false)).toBe(false)
    expect(shouldSpeakPatientReply('transcript', true)).toBe(false)
    expect(shouldSpeakPatientReply('transcript', false)).toBe(false)
  })
})
