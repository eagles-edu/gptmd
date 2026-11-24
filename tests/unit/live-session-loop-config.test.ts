import { describe, expect, it, vi } from 'vitest'
import {
  resolveLiveSessionLoopRedisUrl,
  seedLiveSessionLoopTokenGrant,
  summarizeLiveProviderFailure,
  summarizeLiveSetupFailure
} from '../../scripts/live-session-loop-config.mjs'

describe('live session-loop Redis configuration', () => {
  it('uses the explicit disposable loopback URL without changing the configured URL', () => {
    const url = resolveLiveSessionLoopRedisUrl(
      'redis://127.0.0.1:6379/0',
      'redis://127.0.0.1:16379/0'
    )

    expect(url.toString()).toBe('redis://127.0.0.1:16379/0')
  })

  it('falls back to the configured URL when no override is supplied', () => {
    const url = resolveLiveSessionLoopRedisUrl('redis://localhost:6379/0', undefined)

    expect(url.hostname).toBe('localhost')
  })

  it.each([
    'redis://redis.example:6379/0',
    'redis://192.168.1.20:6379/0',
    'https://127.0.0.1:6379/0'
  ])('rejects non-loopback or unsupported Redis URLs: %s', (override) => {
    expect(() => resolveLiveSessionLoopRedisUrl('redis://127.0.0.1:6379/0', override))
      .toThrow('Live session verification only runs against loopback Redis URLs.')
  })

  it('supports the bracketed IPv6 loopback hostname', () => {
    const url = resolveLiveSessionLoopRedisUrl(undefined, 'redis://[::1]:16379/0')

    expect(url.hostname).toBe('[::1]')
  })

  it('requires a configured or explicit Redis URL', () => {
    expect(() => resolveLiveSessionLoopRedisUrl(undefined, undefined))
      .toThrow('A Redis URL is required for isolated live verification.')
  })

  it('seeds only a synthetic learner addon allowance for the disposable run', async () => {
    const query = vi.fn(async () => undefined)
    const grantedAt = new Date('2026-10-17T00:00:00.000Z')

    await seedLiveSessionLoopTokenGrant(query, 'synthetic-subject', 'synthetic-grant', grantedAt)

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1, 'consumer', $2, 'addon', 'verified_purchase'"),
      ['synthetic-grant', 'synthetic-subject', 'verification-fixture:synthetic-grant', grantedAt]
    )
    const [sql] = query.mock.calls[0]!
    expect(sql).toContain('10000000')
    expect(sql).toContain("interval '365 days'")
    expect(sql).toContain('gptmd-live-verification')
  })

  it('captures only known setup errors and bounded capacity diagnostics', () => {
    expect(summarizeLiveSetupFailure(
      503,
      { error: 'Patient setup capacity is unavailable; retry with the same Idempotency-Key.' },
      '1',
      'setup_queue_wait;dur=2.500, setup_provider_capacity_wait;dur=10'
    )).toEqual({
      status: 503,
      apiError: 'Patient setup capacity is unavailable; retry with the same Idempotency-Key.',
      retryAfterSeconds: 1,
      serverTiming: [
        { metric: 'setup_queue_wait', durationMs: 2.5 },
        { metric: 'setup_provider_capacity_wait', durationMs: 10 }
      ]
    })
  })

  it('redacts unknown API errors and malformed response headers', () => {
    expect(summarizeLiveSetupFailure(
      503,
      { error: 'provider key sk-test-secret must never appear' },
      '1 second',
      'x-internal;desc=secret, setup_queue_wait;dur=NaN'
    )).toEqual({
      status: 503,
      apiError: 'Unrecognized API error',
      retryAfterSeconds: null,
      serverTiming: []
    })
  })

  it('captures provider failure class and status without exposing its message', () => {
    const error = Object.assign(new Error('secret-bearing provider message'), {
      name: 'NotFoundError',
      status: 404,
      code: 'model_not_found',
      stage: 'response_stream'
    })

    expect(summarizeLiveProviderFailure(error)).toEqual({
      errorName: 'NotFoundError',
      providerErrorName: 'NotFoundError',
      status: 404,
      code: 'model_not_found',
      type: null,
      stage: 'response_stream',
      availabilityFailure: null
    })
  })

  it('normalizes unknown provider exceptions without exposing arbitrary fields', () => {
    expect(summarizeLiveProviderFailure({
      name: 'secret sk-test-token',
      status: 700,
      code: 'token=private',
      message: 'must not be returned'
    })).toEqual({
      errorName: 'OtherError',
      providerErrorName: 'OtherError',
      status: null,
      code: null,
      type: null,
      stage: null,
      availabilityFailure: null
    })
  })
})
