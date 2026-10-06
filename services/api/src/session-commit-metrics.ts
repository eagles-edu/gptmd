import type { SessionCommitTimingRecorder } from './patient-state-store.ts'

const OPERATIONS = ['turn', 'phase', 'assessment', 'terminal', 'audit_event_enqueue'] as const
const HISTOGRAM_UPPER_BOUNDS_MS = [0.25, 0.5, 1, 2, 3, 4, 5, 10, 25, 50, 100] as const

type Operation = typeof OPERATIONS[number]
type OperationHistogram = {
  count: number
  atOrAbove5Ms: number
  maxMs: number
  buckets: number[]
}

export type SessionCommitMetric = {
  operation: Operation
  sampleCount: number
  atOrAbove5Ms: number
  maxMs: number
  p50UpperBoundMs: number | null
  p95UpperBoundMs: number | null
}

export type SessionCommitMetrics = {
  record: SessionCommitTimingRecorder
  flush(): SessionCommitMetric[]
}

export function createSessionCommitMetrics(): SessionCommitMetrics {
  const histograms = new Map<Operation, OperationHistogram>(
    OPERATIONS.map((operation) => [operation, createHistogram()])
  )

  return {
    record(operation, elapsedMs) {
      if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return
      const histogram = histograms.get(operation)
      if (!histogram) return
      histogram.count += 1
      histogram.maxMs = Math.max(histogram.maxMs, elapsedMs)
      if (elapsedMs >= 5) histogram.atOrAbove5Ms += 1
      const bucketIndex = HISTOGRAM_UPPER_BOUNDS_MS.findIndex((upperBound) => elapsedMs <= upperBound)
      histogram.buckets[bucketIndex < 0 ? histogram.buckets.length - 1 : bucketIndex] += 1
    },
    flush() {
      const metrics = OPERATIONS.flatMap((operation) => {
        const histogram = histograms.get(operation)
        if (!histogram || histogram.count === 0) return []
        const metric: SessionCommitMetric = {
          operation,
          sampleCount: histogram.count,
          atOrAbove5Ms: histogram.atOrAbove5Ms,
          maxMs: histogram.maxMs,
          p50UpperBoundMs: percentileUpperBound(histogram, 0.5),
          p95UpperBoundMs: percentileUpperBound(histogram, 0.95)
        }
        histograms.set(operation, createHistogram())
        return [metric]
      })
      return metrics
    }
  }
}

function createHistogram(): OperationHistogram {
  return {
    count: 0,
    atOrAbove5Ms: 0,
    maxMs: 0,
    buckets: Array.from({ length: HISTOGRAM_UPPER_BOUNDS_MS.length + 1 }, () => 0)
  }
}

function percentileUpperBound(histogram: OperationHistogram, percentile: number): number | null {
  const targetRank = Math.ceil(histogram.count * percentile)
  let observed = 0
  for (let index = 0; index < histogram.buckets.length; index += 1) {
    observed += histogram.buckets[index] ?? 0
    if (observed >= targetRank) return HISTOGRAM_UPPER_BOUNDS_MS[index] ?? null
  }
  return null
}
