import type OpenAI from 'openai'
import { describe, expect, it, vi } from 'vitest'
import { clearPatientSetupConversation, generatePatientScenario } from '../../services/api/src/patient-profile.ts'

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
      responses: { create: vi.fn().mockResolvedValue({
        id: 'resp-1', status: 'completed', output_text: JSON.stringify(profile),
        usage: { input_tokens: 20, output_tokens: 30, total_tokens: 50 }
      }) }
    } as unknown as OpenAI

    const scenario = await generatePatientScenario(client, 'gpt-6-luna', {
      asOf: new Date('2026-10-01T00:00:00.000Z'), maxAttempts: 1,
      scenarioSeed: 's'.repeat(43)
    })

    expect(scenario.profile.diagnosis).toBe('Endometriosis')
    expect(scenario.conversationId).toBe('conv-1')
    expect(deleted).toEqual(['setup-answer-key', 'setup-input'])
    expect(history).toEqual([])
  })

  it('reuses the same persisted variation seed when validation retries in a fresh Conversation', async () => {
    const seed = 'r'.repeat(43)
    const responseInputs: string[] = []
    let conversationNumber = 0
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
    const client = {
      conversations: {
        create: vi.fn(async () => ({ id: `conv-${++conversationNumber}` })),
        items: {
          list: vi.fn(async function* () {}),
          delete: vi.fn(async () => ({ id: 'conv' }))
        }
      },
      responses: {
        create: vi.fn(async (request: { input: string; instructions: string }) => {
          responseInputs.push(`${request.instructions}\n${request.input}`)
          return {
            id: `response-${responseInputs.length}`, status: 'completed',
            output_text: responseInputs.length === 1 ? '{"invalid":true}' : JSON.stringify(profile),
            usage: null
          }
        })
      }
    } as unknown as OpenAI

    const scenario = await generatePatientScenario(client, 'gpt-6-luna', {
      asOf: new Date('2026-10-01T00:00:00.000Z'), maxAttempts: 2, scenarioSeed: seed
    })

    expect(scenario.conversationId).toBe('conv-2')
    expect(responseInputs).toHaveLength(2)
    expect(responseInputs[0]).toBe(responseInputs[1])
    expect(responseInputs[0]).toContain(`Stable scenario variation seed: ${seed}`)
    expect(responseInputs[0]).toContain('dedicated fields for quality, location and radiation, severity, onset, pattern, duration')
    expect(responseInputs[0]).toContain('include miscellaneousDetailsNos as unknown')
  })
})
