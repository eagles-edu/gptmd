import type { PatientProfile } from '../schemas/patient-api'

/** Pick a portrait from the patient's age at the immutable session creation time. */
export function derivePatientPortraitPath(
  profile: Pick<PatientProfile, 'dateOfBirth' | 'bodyType'>,
  sessionCreatedAt: string
): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(profile.dateOfBirth)
  if (!match) throw new Error('Patient date of birth must use YYYY-MM-DD.')

  const birthYear = Number(match[1])
  const birthMonth = Number(match[2])
  const birthDay = Number(match[3])
  const birthDate = new Date(Date.UTC(birthYear, birthMonth - 1, birthDay))
  const sessionDate = new Date(sessionCreatedAt)

  if (
    birthDate.getUTCFullYear() !== birthYear ||
    birthDate.getUTCMonth() + 1 !== birthMonth ||
    birthDate.getUTCDate() !== birthDay ||
    !Number.isFinite(sessionDate.getTime())
  ) throw new Error('Patient portrait age requires a valid birth date and session creation time.')

  let age = sessionDate.getUTCFullYear() - birthYear
  const birthdayHasPassed =
    sessionDate.getUTCMonth() + 1 > birthMonth ||
    (sessionDate.getUTCMonth() + 1 === birthMonth && sessionDate.getUTCDate() >= birthDay)
  if (!birthdayHasPassed) age -= 1
  if (age < 0) throw new Error('Patient birth date cannot be after session creation.')

  const decade = age < 20 ? '1019' : age < 30 ? '2029' : age < 40 ? '3039' : age < 50 ? '4049' : '5059'
  return `/assets/images/${decade}-${profile.bodyType}/portrait-prototype.webp`
}
