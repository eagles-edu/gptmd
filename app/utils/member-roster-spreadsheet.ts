import * as XLSX from 'xlsx'

export type MemberRosterAssignment = {
  subjectId: string
  groupCodes: string[]
  departmentCode: string | null
}

export type MemberRosterInvitation = {
  email: string
  groupCodes: string[]
  departmentCode: string | null
}

export type MemberRosterFormat = 'csv' | 'xlsx' | 'ods'

export const MAX_MEMBER_ROSTER_FILE_BYTES = 5 * 1024 * 1024
const MAX_DATA_ROWS = 500
const REQUIRED_HEADERS = ['subjectid', 'groupcodes', 'departmentcode'] as const

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!
    if (quoted && character === '"' && text[index + 1] === '"') {
      cell += '"'
      index += 1
    } else if (character === '"') quoted = !quoted
    else if (!quoted && character === ',') {
      row.push(cell.trim())
      cell = ''
    } else if (!quoted && (character === '\n' || character === '\r')) {
      if (character === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell.trim())
      if (row.some(Boolean)) rows.push(row)
      row = []
      cell = ''
    } else cell += character
  }
  if (quoted) throw new Error('Unclosed quote in CSV')
  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  return rows
}

function normalizeRows(rows: unknown[][], restoreCsvPrefix = false): MemberRosterAssignment[] {
  const headerRow = rows.shift()
  const headers = headerRow?.map((value) => typeof value === 'string' ? value.trim().toLowerCase() : '') ?? []
  const subjectColumn = headers.indexOf(REQUIRED_HEADERS[0])
  const groupsColumn = headers.indexOf(REQUIRED_HEADERS[1])
  const departmentColumn = headers.indexOf(REQUIRED_HEADERS[2])
  if (subjectColumn < 0 || groupsColumn < 0 || departmentColumn < 0 || rows.length === 0) {
    throw new Error('Expected subjectId, groupCodes, departmentCode columns and at least one member row')
  }
  if (rows.length > MAX_DATA_ROWS) throw new Error(`Roster imports are limited to ${MAX_DATA_ROWS} member rows`)

  return rows.map((row) => {
    const subjectId = row[subjectColumn] ?? ''
    const groupCodes = row[groupsColumn] ?? ''
    const departmentCode = row[departmentColumn] ?? ''
    if (typeof subjectId !== 'string' || typeof groupCodes !== 'string' || typeof departmentCode !== 'string') {
      throw new Error('Roster member IDs and codes must be stored as text cells')
    }
    let normalizedSubjectId = subjectId.trim()
    if (restoreCsvPrefix && /^''(?=[\t\r ]*[=+\-@])/.test(normalizedSubjectId)) {
      normalizedSubjectId = normalizedSubjectId.slice(1)
    } else if (restoreCsvPrefix && /^'(?=[\t\r ]*[=+\-@])/.test(normalizedSubjectId)) {
      normalizedSubjectId = normalizedSubjectId.slice(1)
    }
    return {
      subjectId: normalizedSubjectId,
      groupCodes: groupCodes.split(';').map((code) => code.trim()).filter(Boolean),
      departmentCode: departmentCode.trim() || null
    }
  })
}

function bytesLength(data: string | ArrayBuffer | Uint8Array): number {
  return typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength
}

function parseWorkbook(data: ArrayBuffer | Uint8Array): unknown[][] {
  const workbook = XLSX.read(data, { type: 'array', sheetRows: MAX_DATA_ROWS + 1, WTF: true })
  const sheetName = workbook.SheetNames[0]
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined
  if (!sheet) throw new Error('The spreadsheet does not contain a worksheet')

  const reference = (sheet as XLSX.WorkSheet & { '!fullref'?: string })['!fullref'] ?? sheet['!ref']
  const range = reference ? XLSX.utils.decode_range(reference) : null
  if (!range) throw new Error('The spreadsheet worksheet is empty')
  if (range.e.r >= MAX_DATA_ROWS + 1) throw new Error(`Roster imports are limited to ${MAX_DATA_ROWS} member rows`)
  for (const address of Object.keys(sheet)) {
    if (address.startsWith('!')) continue
    const cell = sheet[address]
    if (cell && typeof cell === 'object' && 'f' in cell && cell.f) {
      throw new Error('Formula cells are not allowed in roster imports')
    }
  }
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' })
}

export function parseMemberRosterSpreadsheet(
  fileName: string,
  data: string | ArrayBuffer | Uint8Array
): MemberRosterAssignment[] {
  if (bytesLength(data) > MAX_MEMBER_ROSTER_FILE_BYTES) throw new Error('Roster files must be 5 MB or smaller')
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
  let rows: unknown[][]
  let restoreCsvPrefix = false
  if (extension === 'csv') {
    if (typeof data !== 'string') throw new Error('CSV roster data must be text')
    rows = parseCsv(data.replace(/^\uFEFF/, ''))
    restoreCsvPrefix = true
  } else if (extension === 'xlsx' || extension === 'ods') {
    if (typeof data === 'string') throw new Error('Binary spreadsheet data is required')
    rows = parseWorkbook(data)
  } else {
    throw new Error('Choose a CSV, XLSX, or ODS roster file')
  }
  return normalizeRows(rows, restoreCsvPrefix)
}

export function parseMemberRosterInvitationSpreadsheet(
  fileName: string,
  data: string | ArrayBuffer | Uint8Array
): MemberRosterInvitation[] {
  if (bytesLength(data) > MAX_MEMBER_ROSTER_FILE_BYTES) throw new Error('Roster files must be 5 MB or smaller')
  const extension = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase()
  let rows: unknown[][]
  if (extension === 'csv') {
    if (typeof data !== 'string') throw new Error('CSV roster data must be text')
    rows = parseCsv(data.replace(/^\uFEFF/, ''))
  } else if (extension === 'xlsx' || extension === 'ods') {
    if (typeof data === 'string') throw new Error('Binary spreadsheet data is required')
    rows = parseWorkbook(data)
  } else {
    throw new Error('Choose a CSV, XLSX, or ODS roster file')
  }
  const headerRow = rows.shift()
  const headers = headerRow?.map((value) => typeof value === 'string' ? value.trim().toLowerCase() : '') ?? []
  const emailColumn = headers.indexOf('email')
  const groupsColumn = headers.indexOf('groupcodes')
  const departmentColumn = headers.indexOf('departmentcode')
  if (emailColumn < 0 || groupsColumn < 0 || departmentColumn < 0 || rows.length === 0) {
    throw new Error('Expected email, groupCodes, departmentCode columns and at least one learner row')
  }
  if (rows.length > MAX_DATA_ROWS) throw new Error(`Roster imports are limited to ${MAX_DATA_ROWS} learner rows`)
  const invitations = rows.map((row) => {
    const email = row[emailColumn] ?? ''
    const groupCodes = row[groupsColumn] ?? ''
    const departmentCode = row[departmentColumn] ?? ''
    if (typeof email !== 'string' || typeof groupCodes !== 'string' || typeof departmentCode !== 'string') {
      throw new Error('Roster emails and codes must be stored as text cells')
    }
    const normalizedEmail = email.trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) {
      throw new Error('Every roster row must contain a valid email address')
    }
    return {
      email: normalizedEmail,
      groupCodes: groupCodes.split(';').map((code) => code.trim()).filter(Boolean),
      departmentCode: departmentCode.trim() || null
    }
  })
  if (new Set(invitations.map(({ email }) => email)).size !== invitations.length) {
    throw new Error('Roster rows must not repeat an email address')
  }
  return invitations
}

function csvSafeValue(value: string): string {
  if (/^[\t\r ]*[=+\-@]/.test(value)) return `'${value}`
  if (/^'[=+\-@]/.test(value)) return `'${value}`
  return value
}

export function createMemberRosterSpreadsheet(
  assignments: MemberRosterAssignment[],
  format: MemberRosterFormat
): { bytes: string | Uint8Array; mimeType: string; fileName: string } {
  const rows = [
    ['subjectId', 'groupCodes', 'departmentCode'],
    ...assignments.map((assignment) => [
      assignment.subjectId,
      assignment.groupCodes.join(';'),
      assignment.departmentCode ?? ''
    ])
  ]
  const fileName = `gptmd-member-department-roster.${format}`
  if (format === 'csv') {
    const csv = rows.map((row) => row.map((value) => `"${csvSafeValue(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')
    return { bytes: csv, mimeType: 'text/csv;charset=utf-8', fileName }
  }

  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Roster')
  const bookType = format === 'xlsx' ? 'xlsx' : 'ods'
  const bytes = XLSX.write(workbook, { bookType, type: 'array' })
  return {
    bytes: new Uint8Array(bytes),
    mimeType: format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/vnd.oasis.opendocument.spreadsheet',
    fileName
  }
}

export function createMemberRosterInvitationSpreadsheet(
  invitations: MemberRosterInvitation[],
  format: MemberRosterFormat
): { bytes: string | Uint8Array; mimeType: string; fileName: string } {
  const rows = [
    ['email', 'groupCodes', 'departmentCode'],
    ...invitations.map((invitation) => [
      invitation.email,
      invitation.groupCodes.join(';'),
      invitation.departmentCode ?? ''
    ])
  ]
  const fileName = `gptmd-learner-email-roster.${format}`
  if (format === 'csv') {
    const csv = rows.map((row) => row.map((value) => `"${csvSafeValue(value).replaceAll('"', '""')}"`).join(',')).join('\r\n')
    return { bytes: csv, mimeType: 'text/csv;charset=utf-8', fileName }
  }
  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Learners')
  const bytes = XLSX.write(workbook, { bookType: format === 'xlsx' ? 'xlsx' : 'ods', type: 'array' })
  return {
    bytes: new Uint8Array(bytes),
    mimeType: format === 'xlsx'
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'application/vnd.oasis.opendocument.spreadsheet',
    fileName
  }
}
