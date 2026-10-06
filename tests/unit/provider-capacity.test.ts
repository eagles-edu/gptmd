import { describe, expect, it, vi } from 'vitest'
import {
  BoundedProviderCapacity,
  ProviderCapacityFullError,
  ProviderCapacityTimeoutError
} from '../../services/api/src/provider-capacity.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const limits = {
  maxConcurrent: 4,
  reservedInteractive: 2,
  maxQueuedInteractive: 2,
  interactiveWaitTimeoutMs: 1_000,
  maxQueuedSetup: 2,
  setupWaitTimeoutMs: 1_000
}

describe('bounded provider capacity', () => {
  it('reserves slots for interactive work and starts waiting turns before setup', async () => {
    const capacity = new BoundedProviderCapacity(limits)
    const setupOne = deferred<string>()
    const setupTwo = deferred<string>()
    const turnOne = deferred<string>()
    const turnTwo = deferred<string>()
    const turnThree = deferred<string>()
    const calls: string[] = []
    const setupOneTask = vi.fn(() => { calls.push('setup-1'); return setupOne.promise })
    const setupTwoTask = vi.fn(() => { calls.push('setup-2'); return setupTwo.promise })
    const waitingSetupTask = vi.fn(async () => { calls.push('setup-3'); return 'setup-3' })

    const setupOneResult = capacity.run('setup', setupOneTask, vi.fn())
    const setupTwoResult = capacity.run('setup', setupTwoTask, vi.fn())
    const waitingSetupResult = capacity.run('setup', waitingSetupTask, vi.fn())
    await vi.waitFor(() => expect(calls).toEqual(['setup-1', 'setup-2']))

    const turnOneTask = vi.fn(() => { calls.push('turn-1'); return turnOne.promise })
    const turnTwoTask = vi.fn(() => { calls.push('turn-2'); return turnTwo.promise })
    const turnThreeTask = vi.fn(() => { calls.push('turn-3'); return turnThree.promise })
    const turnOneResult = capacity.run('interactive', turnOneTask, vi.fn())
    const turnTwoResult = capacity.run('interactive', turnTwoTask, vi.fn())
    const turnThreeResult = capacity.run('interactive', turnThreeTask, vi.fn())
    await vi.waitFor(() => expect(calls).toEqual(['setup-1', 'setup-2', 'turn-1', 'turn-2']))

    turnOne.resolve('turn-1')
    await expect(turnOneResult).resolves.toBe('turn-1')
    await vi.waitFor(() => expect(calls).toEqual(['setup-1', 'setup-2', 'turn-1', 'turn-2', 'turn-3']))
    expect(waitingSetupTask).not.toHaveBeenCalled()

    turnTwo.resolve('turn-2')
    turnThree.resolve('turn-3')
    setupOne.resolve('setup-1')
    setupTwo.resolve('setup-2')
    await expect(Promise.all([turnTwoResult, turnThreeResult, setupOneResult, setupTwoResult, waitingSetupResult]))
      .resolves.toEqual(['turn-2', 'turn-3', 'setup-1', 'setup-2', 'setup-3'])
    expect(calls.at(-1)).toBe('setup-3')
  })

  it('rejects interactive overflow and expires queued work without invoking it', async () => {
    const capacity = new BoundedProviderCapacity({
      ...limits,
      maxConcurrent: 2,
      reservedInteractive: 1,
      maxQueuedInteractive: 1,
      interactiveWaitTimeoutMs: 15
    })
    const activeOne = deferred<string>()
    const activeTwo = deferred<string>()
    const queuedTask = vi.fn(async () => 'queued')
    const expiredTask = vi.fn(async () => 'expired')
    const calls: string[] = []
    const activeOneResult = capacity.run('interactive', () => { calls.push('one'); return activeOne.promise }, vi.fn())
    const activeTwoResult = capacity.run('interactive', () => { calls.push('two'); return activeTwo.promise }, vi.fn())
    await vi.waitFor(() => expect(calls).toEqual(['one', 'two']))

    const queued = capacity.run('interactive', queuedTask, vi.fn())
    await expect(capacity.run('interactive', expiredTask, vi.fn())).rejects.toBeInstanceOf(ProviderCapacityFullError)
    await expect(queued).rejects.toBeInstanceOf(ProviderCapacityTimeoutError)
    expect(queuedTask).not.toHaveBeenCalled()
    expect(expiredTask).not.toHaveBeenCalled()

    activeOne.resolve('one')
    activeTwo.resolve('two')
    await expect(Promise.all([activeOneResult, activeTwoResult])).resolves.toEqual(['one', 'two'])
  })

  it('releases an interactive slot after provider failure', async () => {
    const capacity = new BoundedProviderCapacity({
      ...limits,
      maxConcurrent: 1,
      reservedInteractive: 0,
      maxQueuedInteractive: 0
    })
    const providerFailure = new Error('provider failure')

    await expect(capacity.run('interactive', async () => { throw providerFailure }, vi.fn()))
      .rejects.toBe(providerFailure)
    await expect(capacity.run('interactive', async () => 'recovered', vi.fn())).resolves.toBe('recovered')
  })
})
