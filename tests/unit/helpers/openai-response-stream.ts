import { vi } from 'vitest'

type ResponseEvent = 'response.output_text.delta' | 'response.completed'
type ResponseListener = (event: Record<string, unknown>) => void

export function createMockResponsesStream<T>(responseOrFactory: T | (() => T)) {
  let listeners = new Map<ResponseEvent, ResponseListener[]>()
  let stream: {
    on: ReturnType<typeof vi.fn>
    finalResponse: ReturnType<typeof vi.fn>
  }

  const streamFactory = vi.fn((_request: unknown) => {
    listeners = new Map()
    stream = {
      on: vi.fn((event: ResponseEvent, listener: ResponseListener) => {
        const registered = listeners.get(event) ?? []
        registered.push(listener)
        listeners.set(event, registered)
        return stream
      }),
      finalResponse: vi.fn(async () => {
        const firstDelta = { type: 'response.output_text.delta', delta: '{', snapshot: '{' }
        const secondDelta = { type: 'response.output_text.delta', delta: '}', snapshot: '{}' }
        for (const listener of listeners.get('response.output_text.delta') ?? []) {
          listener(firstDelta)
          listener(secondDelta)
        }
        for (const listener of listeners.get('response.completed') ?? []) {
          listener({ type: 'response.completed' })
        }
        const response = typeof responseOrFactory === 'function'
          ? (responseOrFactory as () => T)()
          : responseOrFactory
        if (typeof response !== 'object' || response === null) return response
        const value = response as Record<string, unknown>
        const usage = value.usage
        return {
          model: 'gpt-6-luna',
          service_tier: 'default',
          ...value,
          ...(typeof usage === 'object' && usage !== null
            ? {
                usage: {
                  ...(usage as Record<string, unknown>),
                  input_tokens_details: {
                    cached_tokens: 0, cache_write_tokens: 0,
                    ...((usage as Record<string, unknown>).input_tokens_details as Record<string, unknown> | undefined)
                  }
                }
              }
            : {})
        } as T
      })
    }
    return stream
  })

  return { streamFactory }
}
