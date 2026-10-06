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
    let now = 0
    const queue = new BoundedSetupQueue({ maxConcurrent: 1, maxQueued: 1, waitTimeoutMs: 1_000 }, () => now)
    const active = deferred<string>()
    const waiting = deferred<string>()
    const calls: string[] = []
    const firstWaitMeasured = vi.fn()
    const secondWaitMeasured = vi.fn()
    const overflowWaitMeasured = vi.fn()
    const first = queue.run(() => { calls.push('first'); return active.promise }, firstWaitMeasured)
    await Promise.resolve()
    now = 12
    const second = queue.run(() => { calls.push('second'); return waiting.promise }, secondWaitMeasured)
    const overflow = vi.fn(async () => { calls.push('overflow'); return 'unexpected' })

    await expect(queue.run(overflow, overflowWaitMeasured)).rejects.toBeInstanceOf(SetupQueueFullError)
    expect(calls).toEqual(['first'])
    expect(firstWaitMeasured).toHaveBeenCalledExactlyOnceWith(0)
    expect(overflowWaitMeasured).toHaveBeenCalledExactlyOnceWith(0)
    now = 42
    active.resolve('done-first')
    await expect(first).resolves.toBe('done-first')
    await vi.waitFor(() => expect(calls).toEqual(['first', 'second']))
    expect(secondWaitMeasured).toHaveBeenCalledExactlyOnceWith(30)
    waiting.resolve('done-second')
    await expect(second).resolves.toBe('done-second')
    expect(overflow).not.toHaveBeenCalled()
  })

  it('removes a queued setup when its queue wait deadline expires', async () => {
    let now = 0
    const queue = new BoundedSetupQueue({ maxConcurrent: 1, maxQueued: 1, waitTimeoutMs: 10 }, () => now)
    const active = deferred<string>()
    const calls: string[] = []
    const first = queue.run(() => { calls.push('first'); return active.promise }, vi.fn())
    await Promise.resolve()
    const timedOutTask = vi.fn(async () => { calls.push('timed-out'); return 'unexpected' })
    const timeoutWaitMeasured = vi.fn()

    now = 5
    const queuedTimeout = queue.run(timedOutTask, timeoutWaitMeasured)
    now = 15
    await expect(queuedTimeout).rejects.toBeInstanceOf(SetupQueueTimeoutError)
    expect(timeoutWaitMeasured).toHaveBeenCalledExactlyOnceWith(10)
    active.resolve('done')
    await expect(first).resolves.toBe('done')
    expect(calls).toEqual(['first'])
    expect(timedOutTask).not.toHaveBeenCalled()
  })

  it('releases a concurrency slot after a setup task fails', async () => {
    const queue = new BoundedSetupQueue({ maxConcurrent: 1, maxQueued: 0, waitTimeoutMs: 10 })
    const failure = new Error('provider failure')

    await expect(queue.run(async () => { throw failure }, vi.fn())).rejects.toBe(failure)
    await expect(queue.run(async () => 'recovered', vi.fn())).resolves.toBe('recovered')
  })
})
