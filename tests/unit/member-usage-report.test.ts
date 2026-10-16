import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { createMemberUsageReport, type MemberUsageReportRow } from '../../app/utils/member-usage-report.ts'

const members: MemberUsageReportRow[] = [{
  subjectId: '=formula-like-id',
  role: 'learner',
  sessionsStarted: 4,
  sessionsCompleted: 2,
  providerResponseCount: 9,
  totalTokens: '9007199254740993',
  lastAiActivityAt: '2026-10-15T12:30:00.000Z',
  estimatedEngagementSeconds: 930,
  lastEngagementAt: '2026-10-15T12:45:00.000Z'
}]

describe('customer member usage exports', () => {
  it('exports CSV with spreadsheet formula protection and preserves large token totals as text', () => {
    const report = createMemberUsageReport(members, 'csv')
    expect(report.fileName).toBe('gptmd-member-usage.csv')
    expect(report.mimeType).toContain('text/csv')
    expect(report.bytes).toContain("'=formula-like-id")
    expect(report.bytes).toContain('9007199254740993')
    expect(report.bytes).toContain('providerResponses')
    expect(report.bytes).toContain('estimatedEngagementMinutes')
    expect(report.bytes).toContain('15.5')
  })

  it.each(['xlsx', 'ods'] as const)('exports a readable %s report', (format) => {
    const report = createMemberUsageReport(members, format)
    const workbook = XLSX.read(report.bytes, { type: 'array' })
    const sheet = workbook.Sheets['Member usage']
    expect(sheet).toBeDefined()
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false })).toEqual([
      ['subjectId', 'role', 'sessionsStarted', 'sessionsCompleted', 'providerResponses', 'totalTokens', 'lastAiActivityAt', 'estimatedEngagementMinutes', 'lastEngagementAt'],
      ['=formula-like-id', 'learner', '4', '2', '9', '9007199254740993', '2026-10-15T12:30:00.000Z', '15.5', '2026-10-15T12:45:00.000Z']
    ])
    expect(report.fileName).toBe(`gptmd-member-usage.${format}`)
  })
})
