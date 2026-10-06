import type { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'
import { createAudioTranscriptionExpiryWorker } from '../../services/api/src/audio-transcription-expiry-worker.ts'

describe('audio transcription expiry worker', () => {
  it('claims due calls with restart recovery and marks a hung-up call complete', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ grant_id: 'grant-1', provider_call_id: 'call-1' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
    const pool = { query } as unknown as Pool
    const hangup = vi.fn().mockResolvedValue(undefined)
    const onMetrics = vi.fn()
    const worker = createAudioTranscriptionExpiryWorker(pool, hangup, { onMetrics })

    await expect(worker.processOnce()).resolves.toBe(1)

    expect(query.mock.calls[0]?.[0]).toContain('FOR UPDATE SKIP LOCKED')
    expect(query.mock.calls[0]?.[0]).toContain("disconnect_claimed_at < now() - interval '1 minute'")
    expect(hangup).toHaveBeenCalledWith('call-1')
    expect(query.mock.calls[1]?.[0]).toContain('disconnected_at = now()')
    expect(onMetrics).toHaveBeenCalledWith(1)
  })

  it('releases failed calls for bounded exponential retry', async () => {
    const failure = new Error('provider unavailable')
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ grant_id: 'grant-2', provider_call_id: 'call-2' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 })
    const onError = vi.fn()
    const worker = createAudioTranscriptionExpiryWorker(
      { query } as unknown as Pool,
      vi.fn().mockRejectedValue(failure),
      { onError }
    )

    await expect(worker.processOnce()).resolves.toBe(0)

    expect(query.mock.calls[1]?.[0]).toContain('disconnect_attempts = disconnect_attempts + 1')
    expect(query.mock.calls[1]?.[0]).toContain('make_interval(secs => LEAST(300, (2 ^ LEAST(disconnect_attempts + 1, 8))::integer))')
    expect(onError).toHaveBeenCalledWith(failure)
  })
})
