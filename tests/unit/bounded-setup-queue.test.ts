import { describe, expect, it, vi } from 'vitest'
import {
  BoundedSetupQueue,
  SetupQueueFullError,
  SetupQueueTimeoutError
} from '../../services/api/src/bounded-setup-queue.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('bounded patient setup queue', () => {
  it('limits active setup work, queues within capacity, and rejects overflow before invoking it', async () => {
    const queue = new BoundedSetupQueue({ maxConcurrent: 1, maxQueued: 1, waitTimeoutMs: 1_000 })
    const active = deferred<string>()
    const waiting = deferred<string>()
    const calls: string[] = []
    const first = queue.run(() => { calls.push('first'); return active.promise })
    await Promise.resolve()
    const second = queue.run(() => { calls.push('second'); return waiting.promise })
    const overflow = vi.fn(async () => { calls.push('overflow'); return 'unexpected' })

    await expect(queue.run(overflow)).rejects.toBeInstanceOf(SetupQueueFullError)
    expect(calls).toEqual(['first'])
    active.resolve('done-first')
    await expect(first).resolves.toBe('done-first')
    await vi.waitFor(() => expect(calls).toEqual(['first', 'second']))
    waiting.resolve('done-second')
    await expect(second).resolves.toBe('done-second')
    expect(overflow).not.toHaveBeenCalled()
  })

  it('removes a queued setup when its queue wait deadline expires', async () => {
    const queue = new BoundedSetupQueue({ maxConcurrent: 1, maxQueued: 1, waitTimeoutMs: 10 })
    const active = deferred<string>()
    const calls: string[] = []
    const first = queue.run(() => { calls.push('first'); return active.promise })
    await Promise.resolve()
    const timedOutTask = vi.fn(async () => { calls.push('timed-out'); return 'unexpected' })

    await expect(queue.run(timedOutTask)).rejects.toBeInstanceOf(SetupQueueTimeoutError)
    active.resolve('done')
    await expect(first).resolves.toBe('done')
    expect(calls).toEqual(['first'])
    expect(timedOutTask).not.toHaveBeenCalled()
  })

  it('releases a concurrency slot after a setup task fails', async () => {
    const queue = new BoundedSetupQueue({ maxConcurrent: 1, maxQueued: 0, waitTimeoutMs: 10 })
    const failure = new Error('provider failure')

    await expect(queue.run(async () => { throw failure })).rejects.toBe(failure)
    await expect(queue.run(async () => 'recovered')).resolves.toBe('recovered')
  })
})
