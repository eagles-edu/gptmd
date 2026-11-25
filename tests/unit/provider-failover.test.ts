import { describe, expect, it, vi } from 'vitest'
import {
  AnthropicApiError,
  AnthropicMessagesClient,
  isAnthropicAvailabilityError
} from '../../services/api/src/anthropic-messages.ts'
import { isOpenAiAvailabilityError } from '../../services/api/src/provider-availability.ts'
import { generateAnthropicPatientTurn } from '../../services/api/src/anthropic-patient-turn.ts'
import { generateAnthropicPatientScenario } from '../../services/api/src/anthropic-patient-scenario.ts'
import { PatientScenarioProviderError } from '../../services/api/src/patient-profile.ts'
import { generateScenarioWithFailover } from '../../services/api/src/scenario-provider-failover.ts'
import { TEST_PATIENT_PHYSICAL_EXAM_FINDINGS, TEST_PATIENT_VITAL_SIGNS } from '../fixtures/patient-vital-signs.ts'

function apiError(properties: { name?: string; status?: number; type?: string; code?: string }): Error {
  return Object.assign(new Error('provider error'), properties)
}

describe('provider failover boundaries', () => {
  it('generates a catalog-grounded Anthropic scenario with canonical validation and actual token settlement', async () => {
    const profile = {
      fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average',
      reasonForVisit: 'Pelvic pain', diagnosis: null, painHistoryStatus: 'absent', painEpisodes: [], history: [],
      vitalSigns: TEST_PATIENT_VITAL_SIGNS,
      physicalExamFindings: TEST_PATIENT_PHYSICAL_EXAM_FINDINGS,
      currentPregnancyStatus: 'unknown', currentMenopausalStatus: 'unknown',
      patientBeliefs: [], supportedExamFindings: [], supportedTestResults: [],
      persona: {
        mood: 'concerned', maturity: 'adult', verbosity: 'moderate',
        educationLevel: 'college', willingnessToDisclose: 'gradual'
      }
    }
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ input_tokens: 5_100 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'msg_scenario_setup', model: 'claude-haiku-5-5', stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(profile) }],
        usage: { input_tokens: 5_100, output_tokens: 620 }
      })))
    const client = new AnthropicMessagesClient('secret-test-key', fetcher)
    const settle = vi.fn().mockResolvedValue(true)
    const hold = vi.fn().mockResolvedValue(undefined)
    const reserve = vi.fn().mockResolvedValue({ settle, hold })
    const recordUsage = vi.fn().mockResolvedValue(undefined)
    const versions = {
      promptVersion: 'patient-scenario-prompt-v15', modelVersion: 'gpt-6-luna',
      schemaVersion: 8, policyVersion: 'patient-scenario-policy-v3'
    } as const

    const generated = await generateAnthropicPatientScenario(
      client, versions, new Date('2026-10-17T00:00:00.000Z'), 's'.repeat(43), recordUsage, reserve
    )

    expect(generated).toMatchObject({ provider: 'anthropic', conversationId: null, profile })
    expect(generated.usage).toMatchObject({
      provider: 'anthropic', responseId: 'msg_scenario_setup', model: 'claude-haiku-5-5',
      inputTokens: 5_100, outputTokens: 620, totalTokens: 5_720
    })
    expect(reserve).toHaveBeenCalledWith(5_100, 8_192)
    expect(settle).toHaveBeenCalledWith('msg_scenario_setup', 5_720)
    expect(hold).not.toHaveBeenCalled()
    expect(recordUsage).toHaveBeenCalledWith(generated.usage)
    const countRequest = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))
    const generationRequest = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))
    expect(generationRequest.system).toContain('one fictional OB-GYN training patient')
    expect(generationRequest.messages[0].content).toContain('Complete canonical patient-profile parameter catalog')
    expect(generationRequest.messages[0].content).toContain('Approved OBGYN educator-input reference')
    expect(generationRequest.messages[0].content).toContain('Seed-selected primary case focus')
    expect(generationRequest.output_config.format.type).toBe('json_schema')
    expect(countRequest).toEqual(expect.objectContaining({
      model: 'claude-haiku-5-5', output_config: generationRequest.output_config
    }))
  })

  it('falls back only for availability-classified scenario failures and preserves abandoned OpenAI IDs', async () => {
    const primary = vi.fn().mockRejectedValue(new PatientScenarioProviderError(['conv-abandoned'], true))
    const fallback = vi.fn().mockResolvedValue({
      provider: 'anthropic', conversationId: null, responseId: 'msg-fallback', profile: {},
      usage: null, abandonedConversationIds: []
    })

    await expect(generateScenarioWithFailover(primary, fallback)).resolves.toMatchObject({
      provider: 'anthropic', abandonedConversationIds: ['conv-abandoned']
    })
    expect(fallback).toHaveBeenCalledOnce()
    expect(fallback).toHaveBeenCalledWith(expect.objectContaining({ availabilityFailure: true }))
  })

  it.each([
    new PatientScenarioProviderError([], false),
    new Error('invalid scenario request')
  ])('does not invoke scenario fallback for non-availability failure %s', async (error) => {
    const fallback = vi.fn()
    await expect(generateScenarioWithFailover(() => Promise.reject(error), fallback)).rejects.toBe(error)
    expect(fallback).not.toHaveBeenCalled()
  })

  it('generates a patient-safe structured turn, reserves and reconciles actual Anthropic usage', async () => {
    const output = {
      patientResponse: 'I have had the pain for a few days.',
      proposedFacts: [], historyCoverage: [], disclosedHistoryFields: [],
      painHistoryCoverage: [], painDisclosures: [], proposedPainFacts: []
    }
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ input_tokens: 87 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'msg_patient_turn', model: 'claude-haiku-5-5', stop_reason: 'end_turn',
        content: [{ type: 'text', text: JSON.stringify(output) }],
        usage: { input_tokens: 87, output_tokens: 14 }
      })))
    const client = new AnthropicMessagesClient('secret-test-key', fetcher)
    const settle = vi.fn().mockResolvedValue(true)
    const hold = vi.fn().mockResolvedValue(undefined)
    const reserve = vi.fn().mockResolvedValue({
      settle, hold
    })
    const result = await generateAnthropicPatientTurn(client, {
      scenarioId: 'scenario-1', conversationId: 'private-conversation',
      versions: { promptVersion: 'prompt', modelVersion: 'gpt-6-luna', schemaVersion: 4, policyVersion: 'policy', rubricVersion: null },
      phase: 'history', learnerMessage: 'How long have you had pain?', acceptedTurns: [],
      profile: {
        fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', reasonForVisit: 'Pelvic pain',
        currentPregnancyStatus: 'unknown', currentMenopausalStatus: 'unknown',
        diagnosis: 'PRIVATE DIAGNOSIS', vitalSigns: { hidden: 'PRIVATE VITALS' },
        physicalExamFindings: { hidden: 'PRIVATE EXAM' }, supportedExamFindings: ['PRIVATE EXAM KEY'],
        supportedTestResults: [{ testName: 'PRIVATE TEST', result: 'PRIVATE RESULT' }],
        persona: { mood: 'concerned', maturity: 'adult', verbosity: 'moderate', educationLevel: 'college', willingnessToDisclose: 'gradual' },
        history: [], painHistoryStatus: 'absent', painEpisodes: [], patientBeliefs: [], bodyType: 'average'
      }
    } as never, reserve)

    expect(result).toMatchObject({
      provider: 'anthropic', responseId: 'msg_patient_turn', output,
      providerUsage: { provider: 'anthropic', model: 'claude-haiku-5-5', inputTokens: 87, outputTokens: 14, totalTokens: 101 }
    })
    expect(reserve).toHaveBeenCalledWith(87, 1_024)
    expect(settle).toHaveBeenCalledWith('msg_patient_turn', 101)
    expect(hold).not.toHaveBeenCalled()
    const serializedRequest = String(fetcher.mock.calls[1]?.[1]?.body)
    expect(serializedRequest).not.toContain('PRIVATE DIAGNOSIS')
    expect(serializedRequest).not.toContain('PRIVATE VITALS')
    expect(serializedRequest).not.toContain('PRIVATE EXAM')
    expect(serializedRequest).not.toContain('PRIVATE RESULT')
    expect(serializedRequest).toContain('json_schema')
  })

  it('counts Anthropic input with the same system, transcript, and output schema used by generation', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ input_tokens: 87 })))
    const client = new AnthropicMessagesClient('secret-test-key', fetcher)
    const request = {
      model: 'claude-haiku-5-5',
      system: 'Respond as the fictional patient.',
      messages: [{ role: 'user' as const, content: 'How long have you had pain?' }],
      outputConfig: {
        format: { type: 'json_schema' as const, schema: { type: 'object', properties: {} } }
      }
    }

    await expect(client.countInputTokens(request)).resolves.toBe(87)

    expect(fetcher).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledWith('https://api.anthropic.com/v1/messages/count_tokens', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'anthropic-version': '2023-06-01',
        'x-api-key': 'secret-test-key'
      }),
      body: JSON.stringify({
        model: request.model,
        system: request.system,
        messages: request.messages,
        output_config: request.outputConfig
      })
    }))
  })

  it('parses native Anthropic response usage while keeping response text out of error metadata', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({
      id: 'msg_123', model: 'claude-haiku-5-5', stop_reason: 'end_turn',
      content: [{ type: 'text', text: '{"patientResponse":"I feel pain."}' }],
      usage: { input_tokens: 20, output_tokens: 10 }
    })))
    const client = new AnthropicMessagesClient('secret-test-key', fetcher)

    await expect(client.createMessage({
      model: 'claude-haiku-5-5', system: 'system',
      messages: [{ role: 'user', content: 'user' }], maxTokens: 1024
    })).resolves.toMatchObject({ id: 'msg_123', usage: { input_tokens: 20, output_tokens: 10 } })

    const unavailable = new AnthropicApiError(529, 'overloaded_error', null)
    expect(isAnthropicAvailabilityError(unavailable)).toBe(true)
    expect(unavailable.message).not.toContain('secret-test-key')
  })

  it.each([
    [apiError({ name: 'APIConnectionError' }), true],
    [apiError({ name: 'APIConnectionTimeoutError' }), true],
    [apiError({ status: 503, type: 'server_error' }), true],
    [apiError({ status: 429, type: 'rate_limit_error', code: 'rate_limit_exceeded' }), true],
    [apiError({ status: 429, type: 'insufficient_quota', code: 'credit_balance_exhausted' }), false],
    [apiError({ status: 401, type: 'authentication_error' }), false],
    [apiError({ status: 400, type: 'invalid_request_error' }), false]
  ])('classifies OpenAI outage signal %s as availability=%s', (error, expected) => {
    expect(isOpenAiAvailabilityError(error)).toBe(expected)
  })
})
