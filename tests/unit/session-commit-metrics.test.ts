import { describe, expect, it } from 'vitest'
import { createSessionCommitMetrics } from '../../services/api/src/session-commit-metrics.ts'

describe('session commit operational metrics', () => {
  it('reports bounded percentile ceilings and counts commits at or above five milliseconds', () => {
    const metrics = createSessionCommitMetrics()
    metrics.record('turn', 0.12)
    metrics.record('turn', 1.5)
    metrics.record('turn', 4.3)
    metrics.record('turn', 5)
    metrics.record('turn', 12)
    metrics.record('phase', 6)
    metrics.record('assessment', Number.NaN)
    metrics.record('terminal', -1)

    expect(metrics.flush()).toEqual([
      {
        operation: 'turn', sampleCount: 5, atOrAbove5Ms: 2, maxMs: 12,
        p50UpperBoundMs: 5, p95UpperBoundMs: 25
      },
      {
        operation: 'phase', sampleCount: 1, atOrAbove5Ms: 1, maxMs: 6,
        p50UpperBoundMs: 10, p95UpperBoundMs: 10
      }
    ])
    expect(metrics.flush()).toEqual([])
  })

  it('keeps each operation isolated and emits no empty operation summaries', () => {
    const metrics = createSessionCommitMetrics()
    metrics.record('assessment', 0.25)

    expect(metrics.flush()).toEqual([{
      operation: 'assessment', sampleCount: 1, atOrAbove5Ms: 0, maxMs: 0.25,
      p50UpperBoundMs: 0.25, p95UpperBoundMs: 0.25
    }])
  })

  it('reports nonblocking audit-stream handoff separately from payload commits', () => {
    const metrics = createSessionCommitMetrics()
    metrics.record('audit_event_enqueue', 2)

    expect(metrics.flush()).toEqual([{
      operation: 'audit_event_enqueue', sampleCount: 1, atOrAbove5Ms: 0, maxMs: 2,
      p50UpperBoundMs: 2, p95UpperBoundMs: 2
    }])
  })
})
