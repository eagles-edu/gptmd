import { describe, expect, it, vi } from 'vitest'
import { waitForHttpReady } from '../../scripts/http-readiness.mjs'

describe('waitForHttpReady', () => {
  it('retries an HTTP 503 until the readiness endpoint returns success', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    const wait = vi.fn().mockResolvedValue(undefined)

    await expect(waitForHttpReady({
      url: 'http://127.0.0.1:4000/readyz',
      fetchImpl,
      wait
    })).resolves.toBe(true)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledOnce()
  })

  it('does not treat a persistently unready endpoint as ready after the deadline', async () => {
    let currentTime = 0
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 503 }))
    const wait = vi.fn(async (durationMs: number) => {
      currentTime += durationMs
    })

    await expect(waitForHttpReady({
      url: 'http://127.0.0.1:4000/readyz',
      fetchImpl,
      timeoutMs: 10,
      intervalMs: 5,
      now: () => currentTime,
      wait
    })).resolves.toBe(false)

    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })
})
