import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { parseRealtimeAudioDurationUsageEvent } from '../../services/api/src/realtime-transcription-usage.ts'
import { createRealtimeTranscriptionUsageObserver } from '../../services/api/src/realtime-transcription-usage-observer.ts'

class FakeSocket extends EventEmitter {
  readyState = WebSocket.CONNECTING
  terminate = vi.fn(() => {
    this.readyState = WebSocket.CLOSED
    this.emit('close')
  })
  close = vi.fn(() => {
    this.readyState = WebSocket.CLOSED
    this.emit('close')
  })
}

describe('Realtime transcription provider usage', () => {
  it('accepts only completed provider duration events and excludes transcript text', () => {
    expect(parseRealtimeAudioDurationUsageEvent(JSON.stringify({
      type: 'conversation.item.input_audio_transcription.completed',
      event_id: 'event_1', transcript: 'private patient words', usage: { type: 'duration', seconds: 2.75 }
    }))).toEqual({ eventId: 'event_1', seconds: 2.75 })
    expect(parseRealtimeAudioDurationUsageEvent(JSON.stringify({
      type: 'conversation.item.input_audio_transcription.completed',
      event_id: 'event_2', transcript: 'private patient words', usage: { type: 'tokens', total_tokens: 4 }
    }))).toBeNull()
    expect(parseRealtimeAudioDurationUsageEvent('{broken')).toBeNull()
    expect(parseRealtimeAudioDurationUsageEvent({
      type: 'conversation.item.input_audio_transcription.completed', event_id: 'event_3',
      usage: { type: 'duration', seconds: Number.POSITIVE_INFINITY }
    })).toBeNull()
    expect(parseRealtimeAudioDurationUsageEvent({
      type: 'conversation.item.input_audio_transcription.completed', event_id: 'event_4',
      usage: { type: 'duration', seconds: 901 }
    })).toBeNull()
  })

  it('attaches with server credentials and persists provider usage from the sideband only', async () => {
    const socket = new FakeSocket()
    const connect = vi.fn(() => socket as unknown as WebSocket)
    const onUsage = vi.fn().mockResolvedValue(undefined)
    const onDisconnect = vi.fn().mockResolvedValue(undefined)
    const observer = createRealtimeTranscriptionUsageObserver('server-secret', connect)
    const opening = observer('rtc_call_1', onUsage, onDisconnect)
    expect(connect).toHaveBeenCalledWith(
      'wss://api.openai.com/v1/realtime?call_id=rtc_call_1',
      { headers: { Authorization: 'Bearer server-secret' } }
    )
    socket.readyState = WebSocket.OPEN
    socket.emit('open')
    const stop = await opening

    socket.emit('message', Buffer.from(JSON.stringify({
      type: 'conversation.item.input_audio_transcription.completed', event_id: 'event_1',
      transcript: 'do not persist this transcript', usage: { type: 'duration', seconds: 3.125 }
    })))
    await vi.waitFor(() => expect(onUsage).toHaveBeenCalledWith({ eventId: 'event_1', seconds: 3.125 }))
    expect(onUsage.mock.calls[0]?.[0]).not.toHaveProperty('transcript')
    expect(onDisconnect).not.toHaveBeenCalled()

    await stop()
    expect(socket.close).toHaveBeenCalledOnce()
    expect(onDisconnect).toHaveBeenCalledOnce()
  })

  it('rejects a call when the sideband closes before it opens', async () => {
    const socket = new FakeSocket()
    const observer = createRealtimeTranscriptionUsageObserver('server-secret', () => socket as unknown as WebSocket, 100)
    const opening = observer('rtc_call_1', vi.fn(), vi.fn())
    socket.emit('close')
    await expect(opening).rejects.toThrow('closed before connecting')
  })
})
