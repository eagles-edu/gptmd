import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import {
  createMemberRosterInvitationSpreadsheet,
  createMemberRosterSpreadsheet,
  parseMemberRosterInvitationSpreadsheet,
  parseMemberRosterSpreadsheet,
  type MemberRosterAssignment,
  type MemberRosterFormat
} from '../../app/utils/member-roster-spreadsheet.ts'

const sample: MemberRosterAssignment[] = [
  { subjectId: '00-member-id', groupCodes: ['gptnursing', 'gptreception'], departmentCode: 'obgyn' },
  { subjectId: '=formula-like-id', groupCodes: [], departmentCode: null },
  { subjectId: "'=literal-apostrophe-id", groupCodes: ['gpttechnician'], departmentCode: null }
]

describe('customer member roster spreadsheets', () => {
  it.each(['csv', 'xlsx', 'ods'] as MemberRosterFormat[])('round trips roster values through %s', (format) => {
    const output = createMemberRosterSpreadsheet(sample, format)
    const parsed = parseMemberRosterSpreadsheet(
      output.fileName,
      typeof output.bytes === 'string' ? output.bytes : output.bytes
    )
    expect(parsed).toEqual(sample)
  })

  it('accepts a BOM CSV with quoted cells and normalizes header case', () => {
    expect(parseMemberRosterSpreadsheet(
      'roster.csv',
      '\uFEFFSUBJECTID,GROUPCODES,DEPARTMENTCODE\r\n"learner,one","gptnursing; gptreception",obgyn\r\n'
    )).toEqual([{
      subjectId: 'learner,one', groupCodes: ['gptnursing', 'gptreception'], departmentCode: 'obgyn'
    }])
  })

  it('rejects formulas, non-text identifiers, oversized files, and more than 500 roster rows', () => {
    for (const format of ['xlsx', 'ods'] as const) {
      const formula = XLSX.utils.aoa_to_sheet([
        ['subjectId', 'groupCodes', 'departmentCode'],
        ['learner-1', 'gptnursing', 'obgyn']
      ])
      formula.A2 = { t: 'n', f: '1+1', v: 2 }
      const workbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(workbook, formula, 'Roster')
      const formulaBytes = XLSX.write(workbook, { bookType: format, type: 'array' })
      expect(() => parseMemberRosterSpreadsheet(`formula.${format}`, new Uint8Array(formulaBytes)))
        .toThrow('Formula cells are not allowed')
    }

    const numericId = XLSX.utils.aoa_to_sheet([
      ['subjectId', 'groupCodes', 'departmentCode'],
      [123, 'gptnursing', 'obgyn']
    ])
    const numericWorkbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(numericWorkbook, numericId, 'Roster')
    const numericBytes = XLSX.write(numericWorkbook, { bookType: 'xlsx', type: 'array' })
    expect(() => parseMemberRosterSpreadsheet('numeric.xlsx', new Uint8Array(numericBytes)))
      .toThrow('must be stored as text')

    expect(() => parseMemberRosterSpreadsheet('large.csv', `${'x'.repeat(5 * 1024 * 1024)},`))
      .toThrow('5 MB or smaller')
    const csvRows = ['subjectId,groupCodes,departmentCode', ...Array.from({ length: 501 }, (_, i) => `member-${i},gptnursing,obgyn`)]
    expect(() => parseMemberRosterSpreadsheet('many.csv', csvRows.join('\n')))
      .toThrow('limited to 500 member rows')

    const excessRows = [
      ['subjectId', 'groupCodes', 'departmentCode'],
      ...Array.from({ length: 501 }, (_, i) => [`member-${i}`, 'gptnursing', 'obgyn'])
    ]
    for (const format of ['xlsx', 'ods'] as const) {
      const largeWorkbook = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(largeWorkbook, XLSX.utils.aoa_to_sheet(excessRows), 'Roster')
      const largeBytes = XLSX.write(largeWorkbook, { bookType: format, type: 'array' })
      expect(() => parseMemberRosterSpreadsheet(`many.${format}`, new Uint8Array(largeBytes)))
        .toThrow('limited to 500 member rows')
    }
  })

  it('requires the canonical assignment columns and a supported extension', () => {
    expect(() => parseMemberRosterSpreadsheet('wrong.csv', 'email,department\na@example.test,obgyn'))
      .toThrow('Expected subjectId, groupCodes, departmentCode columns')
    expect(() => parseMemberRosterSpreadsheet('roster.xls', 'subjectId,groupCodes,departmentCode\na,b,c'))
      .toThrow('Choose a CSV, XLSX, or ODS')
  })

  it.each(['csv', 'xlsx', 'ods'] as MemberRosterFormat[])('round trips learner invitation templates through %s', (format) => {
    const rows = [{ email: 'employee@example.test', groupCodes: ['gptnursing'], departmentCode: 'obgyn' }]
    const output = createMemberRosterInvitationSpreadsheet(rows, format)
    expect(parseMemberRosterInvitationSpreadsheet(output.fileName, output.bytes)).toEqual(rows)
  })

  it('normalizes emails, preserves codes as text, and rejects invalid or repeated invitation rows', () => {
    expect(parseMemberRosterInvitationSpreadsheet(
      'learners.csv',
      '\uFEFFEMAIL,GROUPCODES,DEPARTMENTCODE\r\n"Employee@Example.test","gptnursing;gptreception",obgyn\r\n'
    )).toEqual([{
      email: 'employee@example.test', groupCodes: ['gptnursing', 'gptreception'], departmentCode: 'obgyn'
    }])
    expect(() => parseMemberRosterInvitationSpreadsheet('bad.csv', 'email,groupCodes,departmentCode\nnot-an-email,,\n'))
      .toThrow('valid email address')
    expect(() => parseMemberRosterInvitationSpreadsheet(
      'duplicate.csv', 'email,groupCodes,departmentCode\na@example.test,,\nA@example.test,,\n'
    )).toThrow('must not repeat')
    expect(() => parseMemberRosterInvitationSpreadsheet('wrong.csv', 'subjectId,groupCodes,departmentCode\na,,\n'))
      .toThrow('Expected email, groupCodes, departmentCode')
  })

  it('rejects formulas and non-text email values in invitation spreadsheets', () => {
    const formula = XLSX.utils.aoa_to_sheet([
      ['email', 'groupCodes', 'departmentCode'],
      ['employee@example.test', 'gptnursing', 'obgyn']
    ])
    formula.A2 = { t: 'n', f: '1+1', v: 2 }
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, formula, 'Learners')
    const bytes = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' })
    expect(() => parseMemberRosterInvitationSpreadsheet('formula.xlsx', new Uint8Array(bytes)))
      .toThrow('Formula cells are not allowed')

    const numeric = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(numeric, XLSX.utils.aoa_to_sheet([
      ['email', 'groupCodes', 'departmentCode'], [123, '', '']
    ]), 'Learners')
    const numericBytes = XLSX.write(numeric, { bookType: 'xlsx', type: 'array' })
    expect(() => parseMemberRosterInvitationSpreadsheet('numeric.xlsx', new Uint8Array(numericBytes)))
      .toThrow('stored as text')
  })
})
