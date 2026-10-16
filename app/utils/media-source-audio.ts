export type MediaSourceAudioPlayback = {
  firstChunk: Promise<void>
  completed: Promise<void>
  url: string
  cancel(): void
}

type AudioStreamTiming = {
  onFirstByte(): void
  onComplete(): void
}

type MediaSourceConstructor = {
  new(): MediaSource
  isTypeSupported(mimeType: string): boolean
}

type PlaybackOptions = {
  audio: HTMLAudioElement
  body: ReadableStream<Uint8Array>
  contentType: string
  MediaSourceType?: MediaSourceConstructor
  createObjectURL?: (source: MediaSource) => string
  revokeObjectURL?: (url: string) => void
}

export function observeAudioStream(
  body: ReadableStream<Uint8Array>,
  timing: AudioStreamTiming
): ReadableStream<Uint8Array> {
  const reader = body.getReader()
  let receivedBytes = false

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) {
          timing.onComplete()
          controller.close()
          reader.releaseLock()
          return
        }
        if (!receivedBytes && result.value.byteLength > 0) {
          receivedBytes = true
          timing.onFirstByte()
        }
        controller.enqueue(result.value)
      } catch (error) {
        controller.error(error)
        reader.releaseLock()
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        reader.releaseLock()
      }
    }
  })
}

function waitForSourceOpen(source: MediaSource): Promise<void> {
  if (source.readyState === 'open') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const onOpen = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('The browser could not open a streaming audio source.'))
    }
    const cleanup = () => {
      source.removeEventListener('sourceopen', onOpen)
      source.removeEventListener('error', onError)
    }
    source.addEventListener('sourceopen', onOpen, { once: true })
    source.addEventListener('error', onError, { once: true })
  })
}

function appendChunk(sourceBuffer: SourceBuffer, chunk: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    const onUpdateEnd = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error('The browser could not decode a streamed audio chunk.'))
    }
    const cleanup = () => {
      sourceBuffer.removeEventListener('updateend', onUpdateEnd)
      sourceBuffer.removeEventListener('error', onError)
    }
    sourceBuffer.addEventListener('updateend', onUpdateEnd, { once: true })
    sourceBuffer.addEventListener('error', onError, { once: true })
    try {
      const stableChunk = new Uint8Array(chunk.byteLength)
      stableChunk.set(chunk)
      sourceBuffer.appendBuffer(stableChunk.buffer)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

export function supportsMediaSourceAudio(
  contentType: string,
  MediaSourceType: Pick<typeof MediaSource, 'isTypeSupported'> | undefined =
    typeof MediaSource === 'undefined' ? undefined : MediaSource
): boolean {
  const mimeType = contentType.split(';', 1)[0]?.trim()
  return Boolean(mimeType && MediaSourceType?.isTypeSupported(mimeType))
}

export function streamAudioToMediaSource(options: PlaybackOptions): MediaSourceAudioPlayback {
  const MediaSourceType = options.MediaSourceType ?? MediaSource
  if (!supportsMediaSourceAudio(options.contentType, MediaSourceType)) {
    throw new Error('Streaming playback is not supported for this audio format.')
  }

  const source = new MediaSourceType()
  const url = (options.createObjectURL ?? URL.createObjectURL.bind(URL))(source)
  const reader = options.body.getReader()
  let cancelled = false
  let firstChunkSettled = false
  let completedSettled = false
  let resolveFirstChunk!: () => void
  let rejectFirstChunk!: (error: unknown) => void
  let resolveCompleted!: () => void
  let rejectCompleted!: (error: unknown) => void
  const firstChunk = new Promise<void>((resolve, reject) => {
    resolveFirstChunk = resolve
    rejectFirstChunk = reject
  })
  const completed = new Promise<void>((resolve, reject) => {
    resolveCompleted = resolve
    rejectCompleted = reject
  })
  void completed.catch(() => undefined)
  options.audio.src = url

  void (async () => {
    try {
      await waitForSourceOpen(source)
      if (cancelled) return
      const sourceBuffer = source.addSourceBuffer(options.contentType)
      let appended = false
      while (!cancelled) {
        const result = await reader.read()
        if (result.done) break
        if (result.value.byteLength === 0) continue
        await appendChunk(sourceBuffer, result.value)
        if (!appended) {
          appended = true
          firstChunkSettled = true
          resolveFirstChunk()
        }
      }
      if (cancelled) return
      if (!appended) throw new Error('The speech service returned an empty audio stream.')
      if (source.readyState === 'open') source.endOfStream()
      completedSettled = true
      resolveCompleted()
    } catch (error) {
      if (!firstChunkSettled) rejectFirstChunk(error)
      if (!cancelled) {
        if (source.readyState === 'open') {
          try { source.endOfStream('decode') } catch { /* The browser may already be closing the source. */ }
        }
        completedSettled = true
        rejectCompleted(error)
      }
    } finally {
      reader.releaseLock()
    }
  })()

  return {
    firstChunk,
    completed,
    url,
    cancel() {
      if (cancelled) return
      cancelled = true
      void reader.cancel().catch(() => undefined)
      if (!firstChunkSettled) rejectFirstChunk(new Error('Streaming audio playback was cancelled.'))
      if (!completedSettled) {
        completedSettled = true
        rejectCompleted(new Error('Streaming audio playback was cancelled.'))
      }
      if (source.readyState === 'open') {
        try { source.endOfStream() } catch { /* The browser may already be closing the source. */ }
      }
      ;(options.revokeObjectURL ?? URL.revokeObjectURL.bind(URL))(url)
    }
  }
}
