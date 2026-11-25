import type OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'
import { countConversationInputTokens } from '../../services/api/src/conversation-input-token-count.ts'

describe('conversation-aware input token counting', () => {
  it('counts existing conversation items and new input without locking the Conversation', async () => {
    const history = [
      { id: 'prior-user', type: 'message', role: 'user', status: 'completed', content: [] },
      { id: 'prior-assistant', type: 'message', role: 'assistant', status: 'completed', content: [] }
    ]
    const list = vi.fn(async function* () { yield* history })
    const count = vi.fn().mockResolvedValue({ object: 'response.input_tokens', input_tokens: 42 })
    const client = {
      conversations: { items: { list } },
      responses: { inputTokens: { count } }
    } as unknown as OpenAI
    const input = [{ role: 'user', content: 'New learner question.' }] as OpenAI.Responses.ResponseInput
    const text = { format: { type: 'json_object' } } as OpenAI.Responses.InputTokenCountParams['text']

    await expect(countConversationInputTokens(client, {
      model: 'gpt-6-luna', conversationId: 'conv-private', input, text
    })).resolves.toEqual({ object: 'response.input_tokens', input_tokens: 42 })

    expect(list).toHaveBeenCalledWith('conv-private', {
      order: 'asc', limit: 100, include: ['reasoning.encrypted_content']
    })
    expect(count).toHaveBeenCalledWith({
      model: 'gpt-6-luna', input: [...history, ...input], text
    }, { maxRetries: 0 })
    expect(count.mock.calls[0]?.[0]).not.toHaveProperty('conversation')
  })

  it('does not request a token count when conversation history cannot be read', async () => {
    const list = vi.fn(async function* () {
      yield* []
      throw new Error('conversation read failed')
    })
    const count = vi.fn()
    const client = {
      conversations: { items: { list } },
      responses: { inputTokens: { count } }
    } as unknown as OpenAI

    await expect(countConversationInputTokens(client, {
      model: 'gpt-6-luna', conversationId: 'conv-private', input: [], text: null
    })).rejects.toThrow('conversation read failed')
    expect(count).not.toHaveBeenCalled()
  })
})
