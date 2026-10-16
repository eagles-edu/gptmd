import * as XLSX from 'xlsx'

export type MemberUsageReportRow = {
  subjectId: string
  role: 'learner' | 'instructor' | 'customer_admin'
  sessionsStarted: number
  sessionsCompleted: number
  providerResponseCount: number
  totalTokens: string
  lastAiActivityAt: string | null
  estimatedEngagementSeconds: number
  lastEngagementAt: string | null
}

export type MemberUsageReportFormat = 'csv' | 'xlsx' | 'ods'

const HEADERS = [
  'subjectId', 'role', 'sessionsStarted', 'sessionsCompleted',
  'providerResponses', 'totalTokens', 'lastAiActivityAt',
  'estimatedEngagementMinutes', 'lastEngagementAt'
]

function safeCsvValue(value: string): string {
  if (/^[\t\r ]*[=+\-@]/.test(value)) return `'${value}`
  if (/^'[=+\-@]/.test(value)) return `'${value}`
  return value
}

export function createMemberUsageReport(
  members: MemberUsageReportRow[],
  format: MemberUsageReportFormat
): { bytes: string | Uint8Array; mimeType: string; fileName: string } {
  const rows: Array<Array<string | number>> = [
    HEADERS,
    ...members.map((member) => [
      member.subjectId,
      member.role,
      member.sessionsStarted,
      member.sessionsCompleted,
      member.providerResponseCount,
      member.totalTokens,
      member.lastAiActivityAt ?? '',
      (member.estimatedEngagementSeconds / 60).toFixed(1),
      member.lastEngagementAt ?? ''
    ])
  ]
  const fileName = `gptmd-member-usage.${format}`
  if (format === 'csv') {
    const csv = rows.map((row) => row.map((value) => {
      const safe = safeCsvValue(String(value))
      return `"${safe.replaceAll('"', '""')}"`
    }).join(',')).join('\r\n')
    return { bytes: `\uFEFF${csv}`, mimeType: 'text/csv;charset=utf-8', fileName }
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Member usage')
  const bytes = XLSX.write(workbook, { bookType: format, type: 'array' })
  return {
    bytes: new Uint8Array(bytes),
    mimeType: format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/vnd.oasis.opendocument.spreadsheet',
    fileName
  }
}
