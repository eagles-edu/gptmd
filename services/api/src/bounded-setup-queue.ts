export type SetupQueueLimits = {
  maxConcurrent: number
  maxQueued: number
  waitTimeoutMs: number
}

export const DEFAULT_SETUP_QUEUE_LIMITS: SetupQueueLimits = {
  maxConcurrent: 2,
  maxQueued: 4,
  waitTimeoutMs: 15_000
}

export class SetupQueueFullError extends Error {
  constructor() {
    super('Patient setup capacity is full')
    this.name = 'SetupQueueFullError'
  }
}

export class SetupQueueTimeoutError extends Error {
  constructor() {
    super('Patient setup did not enter capacity before the queue timeout')
    this.name = 'SetupQueueTimeoutError'
  }
}

type QueueJob = {
  task: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (error: unknown) => void
  timer?: ReturnType<typeof setTimeout>
}

export class BoundedSetupQueue {
  private readonly waiting: QueueJob[] = []
  private active = 0

  constructor(readonly limits: SetupQueueLimits = DEFAULT_SETUP_QUEUE_LIMITS) {
    if (!Number.isInteger(limits.maxConcurrent) || limits.maxConcurrent < 1) {
      throw new Error('Setup queue maxConcurrent must be a positive integer')
    }
    if (!Number.isInteger(limits.maxQueued) || limits.maxQueued < 0) {
      throw new Error('Setup queue maxQueued must be a non-negative integer')
    }
    if (!Number.isInteger(limits.waitTimeoutMs) || limits.waitTimeoutMs < 1) {
      throw new Error('Setup queue waitTimeoutMs must be a positive integer')
    }
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const job: QueueJob = {
        task,
        resolve: (value) => resolve(value as T),
        reject
      }
      if (this.active < this.limits.maxConcurrent) {
        this.start(job)
        return
      }
      if (this.waiting.length >= this.limits.maxQueued) {
        reject(new SetupQueueFullError())
        return
      }
      job.timer = setTimeout(() => {
        const index = this.waiting.indexOf(job)
        if (index < 0) return
        this.waiting.splice(index, 1)
        reject(new SetupQueueTimeoutError())
      }, this.limits.waitTimeoutMs)
      this.waiting.push(job)
    })
  }

  private start(job: QueueJob): void {
    if (job.timer) clearTimeout(job.timer)
    this.active += 1
    void Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        this.active -= 1
        const next = this.waiting.shift()
        if (next) this.start(next)
      })
  }
}
