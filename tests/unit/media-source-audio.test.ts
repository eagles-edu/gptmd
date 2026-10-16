import { describe, expect, it } from 'vitest'
import { observeAudioStream, streamAudioToMediaSource, supportsMediaSourceAudio } from '../../app/utils/media-source-audio'

class FakeSourceBuffer extends EventTarget {
  chunks: Uint8Array[] = []
  updating = false

  appendBuffer(chunk: BufferSource): void {
    const view = chunk instanceof ArrayBuffer
      ? new Uint8Array(chunk)
      : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
    this.chunks.push(view.slice())
    this.updating = true
    queueMicrotask(() => {
      this.updating = false
      this.dispatchEvent(new Event('updateend'))
    })
  }
}

class FakeMediaSource extends EventTarget {
  static isTypeSupported(mimeType: string): boolean { return mimeType === 'audio/mpeg' }
  static latest: FakeMediaSource
  readyState: MediaSourceReadyState = 'closed'
  readonly buffer = new FakeSourceBuffer()

  constructor() {
    super()
    FakeMediaSource.latest = this
    queueMicrotask(() => {
      this.readyState = 'open'
      this.dispatchEvent(new Event('sourceopen'))
    })
  }

  addSourceBuffer(): SourceBuffer { return this.buffer as unknown as SourceBuffer }
  endOfStream(): void { this.readyState = 'ended' }
}

describe('MediaSource audio playback', () => {
  it('supports only media types advertised by MediaSource', () => {
    expect(supportsMediaSourceAudio('audio/mpeg', FakeMediaSource)).toBe(true)
    expect(supportsMediaSourceAudio('audio/wav', FakeMediaSource)).toBe(false)
    expect(supportsMediaSourceAudio('audio/mpeg', undefined)).toBe(false)
  })

  it('appends the first audio chunk before the response stream reaches EOF', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    const audio = { src: '' } as HTMLAudioElement
    const playback = streamAudioToMediaSource({
      audio,
      body,
      contentType: 'audio/mpeg',
      MediaSourceType: FakeMediaSource,
      createObjectURL: () => 'blob:stream-test',
      revokeObjectURL: () => undefined
    })

    controller.enqueue(new Uint8Array([1, 2]))
    await playback.firstChunk

    expect(audio.src).toBe('blob:stream-test')
    expect(FakeMediaSource.latest.buffer.chunks).toEqual([new Uint8Array([1, 2])])
    controller.enqueue(new Uint8Array([3, 4]))
    controller.close()
    await playback.completed

    expect(FakeMediaSource.latest.buffer.chunks).toEqual([new Uint8Array([1, 2]), new Uint8Array([3, 4])])
    expect(FakeMediaSource.latest.readyState).toBe('ended')
  })

  it('settles the active read and completion promise when playback is cancelled', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    const playback = streamAudioToMediaSource({
      audio: { src: '' } as HTMLAudioElement,
      body,
      contentType: 'audio/mpeg',
      MediaSourceType: FakeMediaSource,
      createObjectURL: () => 'blob:cancel-test',
      revokeObjectURL: () => undefined
    })
    controller.enqueue(new Uint8Array([1, 2]))
    await playback.firstChunk
    playback.cancel()

    await expect(playback.completed).rejects.toThrow('cancelled')
    expect(body.locked).toBe(false)
  })

  it('marks the first non-empty response chunk and body completion in order', async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value } })
    const timings: string[] = []
    const reader = observeAudioStream(body, {
      onFirstByte: () => timings.push('first-byte'),
      onComplete: () => timings.push('complete')
    }).getReader()

    const emptyRead = reader.read()
    controller.enqueue(new Uint8Array())
    expect(await emptyRead).toEqual({ done: false, value: new Uint8Array() })
    expect(timings).toEqual([])

    const byteRead = reader.read()
    controller.enqueue(new Uint8Array([1, 2]))
    expect(await byteRead).toEqual({ done: false, value: new Uint8Array([1, 2]) })
    expect(timings).toEqual(['first-byte'])

    controller.close()
    expect(await reader.read()).toEqual({ done: true, value: undefined })
    expect(timings).toEqual(['first-byte', 'complete'])
  })

  it('does not report response completion when the observed body is cancelled', async () => {
    const body = new ReadableStream<Uint8Array>()
    const timings: string[] = []
    const reader = observeAudioStream(body, {
      onFirstByte: () => timings.push('first-byte'),
      onComplete: () => timings.push('complete')
    }).getReader()

    const pendingRead = reader.read()
    await reader.cancel()
    await expect(pendingRead).resolves.toEqual({ done: true, value: undefined })
    expect(timings).toEqual([])
    expect(body.locked).toBe(false)
  })
})
