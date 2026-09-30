import { z } from 'zod'

export const CreateSessionResponseSchema = z.object({
  sessionId: z.string().min(1)
}).strict()

export const PatientProfileSchema = z.object({
  patientName: z.string().min(1),
  patientDob: z.iso.date(),
  patientBodytype: z.enum(['average', 'heavy']),
  patientReason: z.string().min(1)
}).strict()

export const SetupResponseSchema = z.object({
  profile: PatientProfileSchema
}).strict()

export const TurnResponseSchema = z.object({
  turnId: z.string().min(1),
  text: z.string().min(1)
}).strict()

export type CreateSessionResult = z.infer<typeof CreateSessionResponseSchema>
export type PatientProfile = z.infer<typeof PatientProfileSchema>
export type TurnResult = z.infer<typeof TurnResponseSchema>
