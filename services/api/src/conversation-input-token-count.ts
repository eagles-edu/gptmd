import type OpenAI from 'openai'

export async function countConversationInputTokens(
  client: OpenAI,
  request: {
    model: string
    conversationId: string
    input: OpenAI.Responses.ResponseInput
    text?: OpenAI.Responses.InputTokenCountParams['text']
  }
): Promise<OpenAI.Responses.InputTokenCountResponse> {
  const conversationItems: OpenAI.Responses.ResponseInput = []
  for await (const item of client.conversations.items.list(request.conversationId, {
    order: 'asc',
    limit: 100,
    include: ['reasoning.encrypted_content']
  })) {
    conversationItems.push(item as unknown as OpenAI.Responses.ResponseInput[number])
  }

  return client.responses.inputTokens.count({
    model: request.model,
    input: [...conversationItems, ...request.input],
    text: request.text
  }, { maxRetries: 0 })
}
