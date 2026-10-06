export type ProcessCpuReading = { user: number; system: number }
export type ProcessMemoryReading = {
  rss: number
  heapTotal: number
  heapUsed: number
  external: number
}

export type ProcessResourceSample = {
  intervalMs: number
  cpuUserMs: number
  cpuSystemMs: number
  cpuPercentOfOneCore: number
  rssBytes: number
  heapTotalBytes: number
  heapUsedBytes: number
  externalBytes: number
}

export function summarizeProcessResources(input: {
  previousCpu: ProcessCpuReading
  currentCpu: ProcessCpuReading
  elapsedNanoseconds: bigint
  memory: ProcessMemoryReading
}): ProcessResourceSample {
  const intervalMs = Number(input.elapsedNanoseconds) / 1_000_000
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error('Process resource sample interval must be positive')
  }
  const cpuUserMs = Math.max(0, input.currentCpu.user - input.previousCpu.user) / 1_000
  const cpuSystemMs = Math.max(0, input.currentCpu.system - input.previousCpu.system) / 1_000
  return {
    intervalMs: round(intervalMs),
    cpuUserMs: round(cpuUserMs),
    cpuSystemMs: round(cpuSystemMs),
    cpuPercentOfOneCore: round(((cpuUserMs + cpuSystemMs) / intervalMs) * 100),
    rssBytes: input.memory.rss,
    heapTotalBytes: input.memory.heapTotal,
    heapUsedBytes: input.memory.heapUsed,
    externalBytes: input.memory.external
  }
}

export function createProcessResourceSampler(source: {
  readCpu: () => ProcessCpuReading
  readMemory: () => ProcessMemoryReading
  now: () => bigint
}): () => ProcessResourceSample {
  let previousCpu = source.readCpu()
  let previousAt = source.now()

  return () => {
    const currentAt = source.now()
    const currentCpu = source.readCpu()
    const memory = source.readMemory()
    const sample = summarizeProcessResources({
      previousCpu,
      currentCpu,
      elapsedNanoseconds: currentAt - previousAt,
      memory
    })
    previousCpu = currentCpu
    previousAt = currentAt
    return sample
  }
}

const round = (value: number): number => Math.round(value * 100) / 100
