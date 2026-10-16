import { describe, expect, it } from 'vitest'
import { createCompletionRecordHtml } from '../../app/utils/completion-record.ts'

describe('printable completion records', () => {
  it('renders the completion facts and clearly disclaims CEU credit', () => {
    const html = createCompletionRecordHtml({
      sessionId: 'session-123',
      subjectId: 'learner-456',
      startedAt: '2026-10-15T12:00:00.000Z',
      completedAt: '2026-10-15T12:20:00.000Z',
      estimatedEngagementSeconds: 930
    })

    expect(html).toContain('Simulation completion record')
    expect(html).toContain('learner-456')
    expect(html).toContain('session-123')
    expect(html).toContain('15.5 minutes')
    expect(html).toContain('No CEU credit is awarded or represented')
  })

  it('escapes participant and session identifiers before placing them in HTML', () => {
    const html = createCompletionRecordHtml({
      sessionId: '<img src=x onerror=alert(1)>',
      subjectId: 'learner<&"\' >',
      startedAt: 'not-a-date',
      completedAt: '2026-10-15T12:20:00.000Z',
      estimatedEngagementSeconds: -1
    })

    expect(html).toContain('learner&lt;&amp;&quot;&#39; &gt;')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain('Date unavailable')
    expect(html).toContain('0.0 minutes')
  })
})
