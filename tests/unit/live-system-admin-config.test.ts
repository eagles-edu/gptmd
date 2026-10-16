import { describe, expect, it } from 'vitest'
import { appendSubject } from '../../scripts/configure-live-system-admin.mjs'

const subject = 'a1e83d5c-0d20-43fa-8c09-61a34426620b'
const other = 'b2e83d5c-0d20-43fa-8c09-61a34426620b'

describe('live system-admin configuration', () => {
  it('adds a verified subject without changing other environment values', () => {
    expect(appendSubject('PORT=4100\n', subject)).toBe(`PORT=4100\nGPTMD_SYSTEM_ADMIN_SUBJECTS=${subject}\n`)
  })

  it('preserves existing allowlisted operators and does not duplicate the subject', () => {
    const source = `PORT=4100\nGPTMD_SYSTEM_ADMIN_SUBJECTS=${other}\n`
    const expected = `PORT=4100\nGPTMD_SYSTEM_ADMIN_SUBJECTS=${other},${subject}\n`
    expect(appendSubject(source, subject)).toBe(expected)
    expect(appendSubject(expected, subject)).toBe(expected)
  })

  it('rejects malformed subject values and duplicate configuration keys', () => {
    expect(() => appendSubject('GPTMD_SYSTEM_ADMIN_SUBJECTS=not-a-uuid\n', subject)).toThrow(/invalid value/)
    expect(() => appendSubject('GPTMD_SYSTEM_ADMIN_SUBJECTS=\nGPTMD_SYSTEM_ADMIN_SUBJECTS=\n', subject)).toThrow(/at most one/)
    expect(() => appendSubject('', 'onlineadmin@eaglesvn.online')).toThrow(/UUID/)
  })
})
