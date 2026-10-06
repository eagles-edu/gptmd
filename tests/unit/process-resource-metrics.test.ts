import { describe, expect, it } from 'vitest'
import { createProcessResourceSampler, summarizeProcessResources } from '../../services/api/src/process-resource-metrics.ts'

describe('process resource metrics', () => {
  it('reports CPU deltas as percent of one core and emits memory bytes without request data', () => {
    expect(summarizeProcessResources({
      previousCpu: { user: 30_000, system: 10_000 },
      currentCpu: { user: 180_000, system: 70_000 },
      elapsedNanoseconds: 2_100_000_000n,
      memory: { rss: 10_000, heapTotal: 8_000, heapUsed: 5_000, external: 1_000 }
    })).toEqual({
      intervalMs: 2_100,
      cpuUserMs: 150,
      cpuSystemMs: 60,
      cpuPercentOfOneCore: 10,
      rssBytes: 10_000,
      heapTotalBytes: 8_000,
      heapUsedBytes: 5_000,
      externalBytes: 1_000
    })
  })

  it('advances its baseline after every sample', () => {
    const times = [1_000_000_000n, 3_000_000_000n, 4_000_000_000n]
    const cpu = [
      { user: 0, system: 0 },
      { user: 100_000, system: 0 },
      { user: 200_000, system: 0 }
    ]
    const sampler = createProcessResourceSampler({
      readCpu: () => cpu.shift() ?? { user: 0, system: 0 },
      readMemory: () => ({ rss: 100, heapTotal: 80, heapUsed: 50, external: 10 }),
      now: () => times.shift() ?? 0n
    })

    expect(sampler().cpuPercentOfOneCore).toBe(5)
    expect(sampler().cpuPercentOfOneCore).toBe(10)
  })

  it('rejects a zero or backwards monotonic interval', () => {
    expect(() => summarizeProcessResources({
      previousCpu: { user: 0, system: 0 }, currentCpu: { user: 0, system: 0 },
      elapsedNanoseconds: 0n, memory: { rss: 1, heapTotal: 1, heapUsed: 1, external: 1 }
    })).toThrow('Process resource sample interval must be positive')
  })
})
