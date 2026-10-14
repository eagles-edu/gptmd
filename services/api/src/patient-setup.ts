import { z } from 'zod'
import {
  PatientPhysicalExamFindingsSchema,
  PatientVitalSignsBaseSchema,
  PatientVitalSignsSchema,
  type PatientScenarioProfile
} from './patient-profile.js'
import {
  PatientVariantPresentationSettingsSchema,
  type PatientVariantPresentationSettings
} from './patient-variant-settings.ts'

/** Private setup values derived from the accepted full scenario profile. */
export const PatientSetupProjectionSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  dateOfBirth: z.iso.date(),
  bodyType: z.enum(['average', 'heavy']),
  reasonForVisit: z.string().trim().min(1).max(1_000),
  diagnosis: z.string().trim().min(1).max(1_000).nullable(),
  vitalSigns: PatientVitalSignsSchema,
  physicalExamFindings: PatientPhysicalExamFindingsSchema,
  presentationSettings: PatientVariantPresentationSettingsSchema.optional()
}).strict()

export type PatientSetupProjection = z.infer<typeof PatientSetupProjectionSchema>

/** Learner-safe setup response; diagnosis stays in the server-side projection. */
export const LearnerPatientProfileSchema = z.object({
  fullName: z.string().trim().min(1).max(120),
  dateOfBirth: z.iso.date(),
  bodyType: z.enum(['average', 'heavy']),
  reasonForVisit: z.string().trim().min(1).max(1_000),
  presentationSettings: PatientVariantPresentationSettingsSchema.optional(),
  vitalSigns: PatientVitalSignsBaseSchema.pick({
    currentPulse: true,
    bpSitting: true,
    respiratoryRate: true,
    axillaryTemp: true,
    oralTemp: true,
    analTemp: true,
    dermalTemp: true,
    auralTemp: true
  })
}).strict()

export type LearnerPatientProfile = z.infer<typeof LearnerPatientProfileSchema>

export function derivePatientSetup(
  profile: PatientScenarioProfile,
  presentationSettings?: PatientVariantPresentationSettings | null
): PatientSetupProjection {
  return PatientSetupProjectionSchema.parse({
    fullName: profile.fullName,
    dateOfBirth: profile.dateOfBirth,
    bodyType: profile.bodyType,
    reasonForVisit: profile.reasonForVisit,
    diagnosis: profile.diagnosis,
    vitalSigns: profile.vitalSigns,
    physicalExamFindings: profile.physicalExamFindings,
    ...(presentationSettings ? { presentationSettings } : {})
  })
}

export function toLearnerPatientProfile(
  setup: PatientSetupProjection
): LearnerPatientProfile {
  return LearnerPatientProfileSchema.parse({
    fullName: setup.fullName,
    dateOfBirth: setup.dateOfBirth,
    bodyType: setup.bodyType,
    reasonForVisit: setup.reasonForVisit,
    ...(setup.presentationSettings ? { presentationSettings: setup.presentationSettings } : {}),
    vitalSigns: LearnerPatientProfileSchema.shape.vitalSigns.parse({
      currentPulse: setup.vitalSigns.currentPulse,
      bpSitting: setup.vitalSigns.bpSitting,
      respiratoryRate: setup.vitalSigns.respiratoryRate,
      axillaryTemp: setup.vitalSigns.axillaryTemp,
      oralTemp: setup.vitalSigns.oralTemp,
      analTemp: setup.vitalSigns.analTemp,
      dermalTemp: setup.vitalSigns.dermalTemp,
      auralTemp: setup.vitalSigns.auralTemp
    })
  })
}
