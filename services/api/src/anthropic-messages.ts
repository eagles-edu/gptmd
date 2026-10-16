import { z } from 'zod'

export const ANTHROPIC_API_VERSION = '2023-06-01'
export const ANTHROPIC_HAIKU_FAILOVER_MODEL = 'claude-haiku-5-5'

const AnthropicMessageSchema = z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  stop_reason: z.string().nullable(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).passthrough()),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }).passthrough()
}).passthrough()

export type AnthropicMessage = z.infer<typeof AnthropicMessageSchema>
export type AnthropicMessageContent = { role: 'user' | 'assistant'; content: string }
export type AnthropicStructuredOutput = { type: 'json_schema'; schema: Record<string, unknown> }

export type AnthropicMessagesInput = {
  model: string
  system: string
  messages: AnthropicMessageContent[]
  outputConfig?: { format: AnthropicStructuredOutput }
}

export class AnthropicApiError extends Error {
  readonly status: number
  readonly type: string | null
  readonly code: string | null

  constructor(status: number, type: string | null, code: string | null) {
    super(`Anthropic Messages API returned HTTP ${status}`)
    this.name = 'AnthropicApiError'
    this.status = status
    this.type = type
    this.code = code
  }
}

export class AnthropicMessagesClient {
  constructor(
    private readonly apiKey: string,
    private readonly fetcher: typeof fetch = fetch,
    private readonly timeoutMs = 120_000
  ) {
    if (!apiKey.trim()) throw new Error('Anthropic API key is required')
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
      throw new Error('Anthropic request timeout is outside the supported range')
    }
  }

  async countInputTokens(input: AnthropicMessagesInput): Promise<number> {
    const body = await this.request('/v1/messages/count_tokens', {
      ...this.requestBody(input),
      ...(input.outputConfig ? { output_config: input.outputConfig } : {})
    })
    const count = z.object({ input_tokens: z.number().int().nonnegative() }).passthrough().parse(body)
    return count.input_tokens
  }

  async createMessage(input: AnthropicMessagesInput & { maxTokens: number }): Promise<AnthropicMessage> {
    const body = await this.request('/v1/messages', {
      ...this.requestBody(input),
      max_tokens: input.maxTokens,
      ...(input.outputConfig ? { output_config: input.outputConfig } : {})
    })
    return AnthropicMessageSchema.parse(body)
  }

  private requestBody(input: AnthropicMessagesInput): Record<string, unknown> {
    return {
      model: input.model,
      system: input.system,
      messages: input.messages
    }
  }

  private async request(path: string, body: Record<string, unknown>): Promise<unknown> {
    const response = await this.fetcher(`https://api.anthropic.com${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': ANTHROPIC_API_VERSION,
        'x-api-key': this.apiKey
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs)
    })

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as {
        error?: { type?: unknown; message?: unknown; code?: unknown }
      } | null
      throw new AnthropicApiError(
        response.status,
        typeof payload?.error?.type === 'string' ? payload.error.type : null,
        typeof payload?.error?.code === 'string' ? payload.error.code : null
      )
    }
    return response.json()
  }
}

export function isAnthropicAvailabilityError(error: unknown): boolean {
  if (error instanceof AnthropicApiError) {
    return error.status === 408 || error.status === 429 || error.status === 529 || error.status >= 500
  }
  return error instanceof TypeError || (error instanceof Error && error.name === 'TimeoutError')
}
