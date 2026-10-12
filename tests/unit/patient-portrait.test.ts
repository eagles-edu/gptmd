import { describe, expect, it } from 'vitest'
import { derivePatientPortraitPath } from '../../app/utils/patient-portrait'

describe('derivePatientPortraitPath', () => {
  it('keeps the session age band when the patient turns 20 after the session began', () => {
    expect(derivePatientPortraitPath(
      { dateOfBirth: '2006-10-08', bodyType: 'average' },
      '2026-10-07T23:59:59.000Z'
    )).toBe('/assets/images/1019-average/portrait-prototype.webp')
  })

  it('uses the next age band when the birthday has passed at session creation', () => {
    expect(derivePatientPortraitPath(
      { dateOfBirth: '2006-10-08', bodyType: 'heavy' },
      '2026-10-08T00:00:00.000Z'
    )).toBe('/assets/images/2029-heavy/portrait-prototype.webp')
  })

  it('rejects an invalid or future birth date rather than selecting a guessed portrait', () => {
    expect(() => derivePatientPortraitPath(
      { dateOfBirth: '2006-02-30', bodyType: 'average' },
      '2026-10-08T00:00:00.000Z'
    )).toThrow('valid birth date and session creation time')
    expect(() => derivePatientPortraitPath(
      { dateOfBirth: '2026-10-09', bodyType: 'average' },
      '2026-10-08T00:00:00.000Z'
    )).toThrow('cannot be after session creation')
  })
})
