import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const PatientVariantSettingsTemplateSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal('educator-review'),
  variants: z.array(z.object({
    variantKey: z.string(),
    voiceProfileId: z.string().min(1),
    voice: z.object({
      provider: z.null(),
      voiceId: z.null(),
      locale: z.null(),
      rate: z.null(),
      pitch: z.null(),
      volume: z.null(),
      fallbackVoiceId: z.null()
    }).strict(),
    variabilityProfileId: z.string().min(1),
    variability: z.object({
      mood: z.object({ allowedValues: z.array(z.never()) }).strict(),
      maturity: z.object({ allowedValues: z.array(z.never()) }).strict(),
      verbosity: z.object({ allowedValues: z.array(z.never()) }).strict(),
      educationLevel: z.object({ allowedValues: z.array(z.never()) }).strict(),
      willingnessToDisclose: z.object({ allowedValues: z.array(z.never()) }).strict()
    }).strict()
  }).strict()).length(10)
}).strict()

const expectedVariantKeys = [
  '1019-average', '1019-heavy',
  '2029-average', '2029-heavy',
  '3039-average', '3039-heavy',
  '4049-average', '4049-heavy',
  '5059-average', '5059-heavy'
]

describe('patient variant settings worksheet', () => {
  it('keeps independent voice and variability records for every portrait variant', async () => {
    const raw = await readFile(new URL('../../educator-input/patient-variant-settings.template.json', import.meta.url), 'utf8')
    const template = PatientVariantSettingsTemplateSchema.parse(JSON.parse(raw))
    const variants = template.variants

    expect(variants.map((variant) => variant.variantKey)).toEqual(expectedVariantKeys)
    expect(new Set(variants.map((variant) => variant.voiceProfileId)).size).toBe(10)
    expect(new Set(variants.map((variant) => variant.variabilityProfileId)).size).toBe(10)
    expect(variants.every((variant) =>
      Object.keys(variant.variability).length === 5 &&
      variant.voice.provider === null &&
      variant.voice.voiceId === null
    )).toBe(true)
  })
})
