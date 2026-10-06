import type OpenAI from 'openai'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  clearPatientSetupConversation,
  generatePatientScenario,
  PATIENT_PROFILE_FIELDS
} from '../../services/api/src/patient-profile.ts'
import { createMockResponsesStream } from './helpers/openai-response-stream.ts'

describe('patient setup Conversation isolation', () => {
  it('deletes every setup item and verifies that hidden setup context is gone', async () => {
    const remaining = [{ id: 'setup-input' }, { id: 'setup-answer-key' }]
    const deleted: string[] = []
    const list = vi.fn(async function* (_conversationId: string, query: { limit: number }) {
      for (const item of remaining.slice(0, query.limit)) yield item
    })
    const deleteItem = vi.fn(async (itemId: string) => {
      deleted.push(itemId)
      const index = remaining.findIndex((item) => item.id === itemId)
      if (index >= 0) remaining.splice(index, 1)
      return { id: 'conv-1', object: 'conversation' }
    })
    const client = { conversations: { items: { list, delete: deleteItem } } } as unknown as OpenAI

    await clearPatientSetupConversation(client, 'conv-1')

    expect(deleted).toEqual(['setup-answer-key', 'setup-input'])
    expect(list).toHaveBeenCalledTimes(2)
    expect(remaining).toEqual([])
  })

  it('fails closed when setup items remain in the Conversation', async () => {
    const list = vi.fn(async function* () { yield { id: 'answer-key' } })
    const deleteItem = vi.fn(async () => ({ id: 'conv-1', object: 'conversation' }))
    const client = { conversations: { items: { list, delete: deleteItem } } } as unknown as OpenAI

    await expect(clearPatientSetupConversation(client, 'conv-1'))
      .rejects.toThrow('remains in the patient turn context')
    expect(deleteItem).toHaveBeenCalledWith('answer-key', { conversation_id: 'conv-1' })
  })

  it('clears setup input and answer-key output before returning the validated scenario', async () => {
    const history = [{ id: 'setup-input' }, { id: 'setup-answer-key' }]
    const deleted: string[] = []
    const profile = {
      fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average',
      reasonForVisit: 'Pelvic pain', diagnosis: 'Endometriosis', history: [],
      currentPregnancyStatus: 'unknown', currentMenopausalStatus: 'unknown',
      patientBeliefs: [], supportedExamFindings: [], supportedTestResults: [],
      persona: {
        mood: 'concerned', maturity: 'adult', verbosity: 'moderate',
        educationLevel: 'college', willingnessToDisclose: 'gradual'
      }
    }
    const { streamFactory } = createMockResponsesStream({
      id: 'resp-1', status: 'completed', output_text: JSON.stringify(profile),
      usage: { input_tokens: 20, output_tokens: 30, total_tokens: 50 }
    })
    const client = {
      conversations: {
        create: vi.fn().mockResolvedValue({ id: 'conv-1' }),
        items: {
          list: vi.fn(async function* (_conversationId: string, query: { limit: number }) {
            for (const item of history.slice(0, query.limit)) yield item
          }),
          delete: vi.fn(async (itemId: string) => {
            deleted.push(itemId)
            const index = history.findIndex((item) => item.id === itemId)
            if (index >= 0) history.splice(index, 1)
            return { id: 'conv-1', object: 'conversation' }
          })
        }
      },
      responses: { stream: streamFactory }
    } as unknown as OpenAI

    const timings: string[] = []
    const scenario = await generatePatientScenario(client, 'gpt-6-luna', {
      asOf: new Date('2026-10-01T00:00:00.000Z'), maxAttempts: 1,
      scenarioSeed: 's'.repeat(43),
      recordTiming: (stage) => timings.push(stage)
    })

    expect(scenario.profile.diagnosis).toBe('Endometriosis')
    expect(scenario.conversationId).toBe('conv-1')
    const request = streamFactory.mock.calls[0]?.[0] as {
      instructions?: string
      prompt_cache_options?: { mode: string; ttl: string }
      input?: Array<
        | {
            role: 'developer'
            content: Array<{ type: string; text: string; prompt_cache_breakpoint?: { mode: string } }>
          }
        | { role: 'user'; content: string }
      >
      text?: { format?: unknown }
    }
    const canonicalCatalog = readFileSync(
      new URL('../../services/api/catalog/patient-profile.json', import.meta.url), 'utf8'
    )
    const parsedCatalog = JSON.parse(canonicalCatalog) as { patientProfileFields: string[] }
    const setupInput = request.input?.[0]
    const scenarioInput = request.input?.[1]
    const catalogBlock = setupInput?.role === 'developer' ? setupInput.content[1] : undefined
    expect(request.instructions).toBeUndefined()
    expect(request.prompt_cache_options).toEqual({ mode: 'explicit', ttl: '30m' })
    expect(setupInput?.role).toBe('developer')
    expect(setupInput?.role === 'developer' ? setupInput.content[0]?.text : '')
      .toContain('complete canonical patient-profile parameter catalog')
    expect(catalogBlock?.text).toBe(`Complete canonical patient-profile parameter catalog (intact JSON):\n${canonicalCatalog}`)
    expect(parsedCatalog.patientProfileFields).toEqual(PATIENT_PROFILE_FIELDS)
    expect(catalogBlock?.prompt_cache_breakpoint).toEqual({ mode: 'explicit' })
    expect((setupInput?.role === 'developer' ? setupInput.content[0]?.text.length ?? 0 : 0) +
      (catalogBlock?.text.length ?? 0)).toBeGreaterThan(4096)
    expect(scenarioInput?.role).toBe('user')
    expect(scenarioInput?.role === 'user' ? scenarioInput.content : '')
      .toContain(`Stable scenario variation seed: ${'s'.repeat(43)}`)
    expect(request.text?.format).toEqual(expect.any(Object))
    expect(scenario.usage).toEqual({
      responseId: 'resp-1', model: 'gpt-6-luna', serviceTier: 'default',
      inputTokens: 20, cachedInputTokens: 0, cacheWriteTokens: 0, outputTokens: 30,
      totalTokens: 50, durationMs: expect.any(Number),
      pricingVersion: 'openai-api-pricing-2026-10-06', estimatedCostUsd: '0.000017000000'
    })
    expect(timings).toEqual(['first_token', 'completed'])
    expect(deleted).toEqual(['setup-answer-key', 'setup-input'])
    expect(history).toEqual([])
  })

  it('reuses the same persisted variation seed when validation retries in a fresh Conversation', async () => {
    const seed = 'r'.repeat(43)
    let responseNumber = 0
    let conversationNumber = 0
    const recordProviderUsage = vi.fn(async () => undefined)
    const profile = {
      fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average',
      reasonForVisit: 'Pelvic pain', diagnosis: 'Endometriosis', history: [],
      currentPregnancyStatus: 'unknown', currentMenopausalStatus: 'unknown',
      patientBeliefs: [], supportedExamFindings: [], supportedTestResults: [],
      persona: {
        mood: 'concerned', maturity: 'adult', verbosity: 'moderate',
        educationLevel: 'college', willingnessToDisclose: 'gradual'
      }
    }
    const { streamFactory } = createMockResponsesStream(() => {
      responseNumber += 1
      return {
        id: `response-${responseNumber}`, status: 'completed',
        output_text: responseNumber === 1 ? '{"invalid":true}' : JSON.stringify(profile),
        usage: {
          input_tokens: responseNumber === 1 ? 310 : 420,
          input_tokens_details: { cached_tokens: responseNumber === 1 ? 30 : 40 },
          output_tokens: responseNumber === 1 ? 12 : 24,
          total_tokens: responseNumber === 1 ? 322 : 444
        }
      }
    })
    const client = {
      conversations: {
        create: vi.fn(async () => ({ id: `conv-${++conversationNumber}` })),
        items: {
          list: vi.fn(async function* () {}),
          delete: vi.fn(async () => ({ id: 'conv' }))
        }
      },
      responses: { stream: streamFactory }
    } as unknown as OpenAI

    const scenario = await generatePatientScenario(client, 'gpt-6-luna', {
      asOf: new Date('2026-10-01T00:00:00.000Z'), maxAttempts: 2, scenarioSeed: seed,
      recordProviderUsage
    })

    const responseInputs = streamFactory.mock.calls.map(([rawRequest]) => {
      const request = rawRequest as { input: unknown }
      return JSON.stringify(request.input)
    })
    expect(scenario.conversationId).toBe('conv-2')
    expect(recordProviderUsage).toHaveBeenCalledTimes(2)
    expect(recordProviderUsage.mock.calls.map(([usage]) => usage)).toEqual([
      expect.objectContaining({
        responseId: 'response-1', inputTokens: 310, cachedInputTokens: 30,
        outputTokens: 12, totalTokens: 322, durationMs: expect.any(Number)
      }),
      expect.objectContaining({
        responseId: 'response-2', inputTokens: 420, cachedInputTokens: 40,
        outputTokens: 24, totalTokens: 444, durationMs: expect.any(Number)
      })
    ])
    expect(responseInputs).toHaveLength(2)
    expect(responseInputs[0]).toBe(responseInputs[1])
    expect(responseInputs[0]).toContain(`Stable scenario variation seed: ${seed}`)
    expect(responseInputs[0]).toContain('dedicated fields for quality, location and radiation, severity, onset, pattern, duration')
    expect(responseInputs[0]).toContain('include miscellaneousDetailsNos as unknown')
    expect(responseInputs[0]).toContain('numberPregnanciesWithLiveBirth counts pregnancies resulting in one or more live-born infants')
    expect(responseInputs[0]).toContain('a multiple pregnancy counts once in the former and once per live-born infant in the latter')
    expect(responseInputs[0]).toContain('numberPriorPregnanciesReaching20Weeks is the patient-reported parity count')
    expect(responseInputs[0]).toContain('numberChildren is the current living-child count and must not be inferred from births')
  })
})
