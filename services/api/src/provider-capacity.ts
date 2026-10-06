export type ProviderWorkLane = 'interactive' | 'setup'

export type ProviderCapacityLimits = {
  maxConcurrent: number
  reservedInteractive: number
  maxQueuedInteractive: number
  interactiveWaitTimeoutMs: number
  maxQueuedSetup: number
  setupWaitTimeoutMs: number
}

export const DEFAULT_PROVIDER_CAPACITY_LIMITS: ProviderCapacityLimits = {
  maxConcurrent: 4,
  reservedInteractive: 2,
  maxQueuedInteractive: 8,
  interactiveWaitTimeoutMs: 5_000,
  maxQueuedSetup: 2,
  setupWaitTimeoutMs: 15_000
}

export class ProviderCapacityFullError extends Error {
  constructor(readonly lane: ProviderWorkLane) {
    super(`${lane === 'interactive' ? 'Interactive' : 'Setup'} provider capacity is full`)
    this.name = 'ProviderCapacityFullError'
  }
}

export class ProviderCapacityTimeoutError extends Error {
  constructor(readonly lane: ProviderWorkLane) {
    super(`${lane === 'interactive' ? 'Interactive' : 'Setup'} provider capacity wait timed out`)
    this.name = 'ProviderCapacityTimeoutError'
  }
}

type CapacityJob = {
  lane: ProviderWorkLane
  task: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  enqueuedAt: number
  onWaitMeasured: (waitMs: number) => void
  timer?: ReturnType<typeof setTimeout>
}

export class BoundedProviderCapacity {
  private readonly interactiveWaiting: CapacityJob[] = []
  private readonly setupWaiting: CapacityJob[] = []
  private active = 0
  private activeSetup = 0

  constructor(
    readonly limits: ProviderCapacityLimits = DEFAULT_PROVIDER_CAPACITY_LIMITS,
    private readonly now: () => number = () => performance.now()
  ) {
    if (!Number.isInteger(limits.maxConcurrent) || limits.maxConcurrent < 1) {
      throw new Error('Provider maxConcurrent must be a positive integer')
    }
    if (!Number.isInteger(limits.reservedInteractive) || limits.reservedInteractive < 0 ||
        limits.reservedInteractive >= limits.maxConcurrent) {
      throw new Error('Provider reservedInteractive must be non-negative and less than maxConcurrent')
    }
    if (!Number.isInteger(limits.maxQueuedInteractive) || limits.maxQueuedInteractive < 0 ||
        !Number.isInteger(limits.maxQueuedSetup) || limits.maxQueuedSetup < 0) {
      throw new Error('Provider queue limits must be non-negative integers')
    }
    if (!Number.isInteger(limits.interactiveWaitTimeoutMs) || limits.interactiveWaitTimeoutMs < 1 ||
        !Number.isInteger(limits.setupWaitTimeoutMs) || limits.setupWaitTimeoutMs < 1) {
      throw new Error('Provider wait timeouts must be positive integers')
    }
  }

  run<T>(
    lane: ProviderWorkLane,
    task: () => Promise<T>,
    onWaitMeasured: (waitMs: number) => void
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: CapacityJob = {
        lane,
        task,
        resolve: (value) => resolve(value as T),
        reject,
        enqueuedAt: this.now(),
        onWaitMeasured
      }

      const waiting = lane === 'interactive' ? this.interactiveWaiting : this.setupWaiting
      const maxQueued = lane === 'interactive'
        ? this.limits.maxQueuedInteractive
        : this.limits.maxQueuedSetup
      if (this.canStart(lane) && waiting.length === 0 &&
          (lane === 'interactive' || this.interactiveWaiting.length === 0)) {
        this.start(job)
        return
      }
      if (waiting.length >= maxQueued) {
        this.reportWait(onWaitMeasured, 0)
        reject(new ProviderCapacityFullError(lane))
        return
      }

      const timeoutMs = lane === 'interactive'
        ? this.limits.interactiveWaitTimeoutMs
        : this.limits.setupWaitTimeoutMs
      job.timer = setTimeout(() => {
        const index = waiting.indexOf(job)
        if (index < 0) return
        waiting.splice(index, 1)
        this.reportWait(job.onWaitMeasured, Math.max(0, this.now() - job.enqueuedAt))
        job.reject(new ProviderCapacityTimeoutError(lane))
        this.pump()
      }, timeoutMs)
      waiting.push(job)
      this.pump()
    })
  }

  private canStart(lane: ProviderWorkLane): boolean {
    if (this.active >= this.limits.maxConcurrent) return false
    return lane === 'interactive' || this.activeSetup < this.limits.maxConcurrent - this.limits.reservedInteractive
  }

  private pump(): void {
    while (this.active < this.limits.maxConcurrent) {
      const interactive = this.interactiveWaiting.shift()
      if (interactive) {
        this.start(interactive)
        continue
      }
      if (this.setupWaiting.length === 0 || !this.canStart('setup')) return
      const setup = this.setupWaiting.shift()
      if (!setup) return
      this.start(setup)
    }
  }

  private start(job: CapacityJob): void {
    if (job.timer) clearTimeout(job.timer)
    this.reportWait(job.onWaitMeasured, Math.max(0, this.now() - job.enqueuedAt))
    this.active += 1
    if (job.lane === 'setup') this.activeSetup += 1
    void Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        this.active -= 1
        if (job.lane === 'setup') this.activeSetup -= 1
        this.pump()
      })
  }

  private reportWait(onWaitMeasured: (waitMs: number) => void, waitMs: number): void {
    try {
      onWaitMeasured(waitMs)
    } catch {
      // Observability must not change provider admission or task execution.
    }
  }
}
