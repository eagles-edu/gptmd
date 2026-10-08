import { createHash } from 'node:crypto'
import { z } from 'zod'
import { canonicalJsonStringify } from './canonical-json.ts'
import { PatientScenarioProfileSchema } from './patient-profile.ts'
import type { LivePatientState } from './patient-state-store.ts'

const SessionIdentityCoreSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  tenantId: z.string().min(1),
  subjectId: z.string().min(1),
  patientProfileId: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  providerConversationId: z.string().min(1),
  scenarioFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  schemaVersion: z.number().int().positive()
}).strict()

export const SessionIdentityBindingSchema = SessionIdentityCoreSchema

export type SessionIdentityBinding = z.infer<typeof SessionIdentityBindingSchema>
export type SessionIdentityVerificationStatus = 'verified' | 'redis_missing' | 'mismatch'

export function fingerprintScenario(profile: unknown): string {
  const canonicalProfile = PatientScenarioProfileSchema.parse(profile)
  return createHash('sha256').update(canonicalJsonStringify(canonicalProfile)).digest('hex')
}

export function createSessionIdentityBinding(
  input: z.input<typeof SessionIdentityCoreSchema>
): SessionIdentityBinding {
  return SessionIdentityBindingSchema.parse(input)
}

export function verifySessionIdentityBinding(
  binding: SessionIdentityBinding,
  live: LivePatientState | null
): SessionIdentityVerificationStatus {
  if (!live) return 'redis_missing'
  const observed = createSessionIdentityBinding({
    sessionId: live.sessionId,
    tenantId: binding.tenantId,
    subjectId: binding.subjectId,
    patientProfileId: live.patientProfileId,
    providerConversationId: live.conversationId,
    scenarioFingerprint: fingerprintScenario(live.profile),
    schemaVersion: live.schemaVersion
  })
  return observed.sessionId === binding.sessionId &&
    observed.patientProfileId === binding.patientProfileId &&
    observed.providerConversationId === binding.providerConversationId &&
    observed.scenarioFingerprint === binding.scenarioFingerprint &&
    observed.schemaVersion === binding.schemaVersion &&
    live.profileDigest === binding.scenarioFingerprint
    ? 'verified'
    : 'mismatch'
}
