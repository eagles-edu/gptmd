import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { Pool } from 'pg'

export const PATIENT_VARIANT_KEYS = [
  '1019-average', '1019-heavy',
  '2029-average', '2029-heavy',
  '3039-average', '3039-heavy',
  '4049-average', '4049-heavy',
  '5059-average', '5059-heavy'
] as const

const optionalText = z.string().trim().min(1).max(200).nullable()
const optionalRate = z.number().finite().min(0.5).max(2).nullable()
const optionalPitch = z.number().finite().min(0).max(2).nullable()
const optionalVolume = z.number().finite().min(0).max(1).nullable()
const allowedValues = z.array(z.string().trim().min(1).max(120)).max(20)
export const OPENAI_SPEECH_VOICES = [
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx',
  'sage', 'shimmer', 'verse', 'marin', 'cedar'
] as const

const PatientVariantSettingSchema = z.object({
  variantKey: z.enum(PATIENT_VARIANT_KEYS),
  voiceProfileId: z.string().trim().min(1).max(120),
  voice: z.object({
    provider: z.enum(['browser-speech-synthesis', 'openai-audio-speech']).nullable(),
    voiceId: optionalText,
    locale: optionalText,
    rate: optionalRate,
    pitch: optionalPitch,
    volume: optionalVolume,
    fallbackVoiceId: optionalText
  }).strict(),
  variabilityProfileId: z.string().trim().min(1).max(120),
  variability: z.object({
    mood: z.object({ allowedValues }).strict(),
    maturity: z.object({ allowedValues }).strict(),
    verbosity: z.object({ allowedValues }).strict(),
    educationLevel: z.object({ allowedValues }).strict(),
    willingnessToDisclose: z.object({ allowedValues }).strict()
  }).strict()
}).strict()

export const PatientVariantSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(['draft', 'approved']),
  revision: z.number().int().nonnegative(),
  variants: z.array(PatientVariantSettingSchema).length(PATIENT_VARIANT_KEYS.length)
}).strict().superRefine((settings, context) => {
  const keys = settings.variants.map((variant) => variant.variantKey)
  if (new Set(keys).size !== PATIENT_VARIANT_KEYS.length ||
    PATIENT_VARIANT_KEYS.some((key) => !keys.includes(key))) {
    context.addIssue({ code: 'custom', message: 'Settings must include every portrait variant exactly once' })
  }

  const voiceIds = settings.variants.map((variant) => variant.voiceProfileId)
  const variabilityIds = settings.variants.map((variant) => variant.variabilityProfileId)
  if (new Set(voiceIds).size !== voiceIds.length || new Set(variabilityIds).size !== variabilityIds.length) {
    context.addIssue({ code: 'custom', message: 'Voice and variability profile IDs must be unique per variant' })
  }

  if (settings.status !== 'approved') return
  const voiceAssignments = settings.variants.map((variant) => `${variant.voice.provider}:${variant.voice.voiceId}`)
  if (new Set(voiceAssignments).size !== voiceAssignments.length) {
    context.addIssue({ code: 'custom', path: ['variants'], message: 'Approved portrait variants require distinct voices' })
  }
  settings.variants.forEach((variant, index) => {
    const voice = variant.voice
    const browserVoice = voice.provider === 'browser-speech-synthesis' && Boolean(voice.voiceId) &&
      Boolean(voice.locale) && voice.rate !== null && voice.pitch !== null && voice.volume !== null
    const openAiVoice = voice.provider === 'openai-audio-speech' &&
      OPENAI_SPEECH_VOICES.includes(voice.voiceId as typeof OPENAI_SPEECH_VOICES[number]) &&
      voice.locale === 'en' && voice.rate === null && voice.pitch === null && voice.volume === null
    if ((!browserVoice && !openAiVoice) ||
      (voice.rate !== null && (voice.rate < 0.5 || voice.rate > 2)) ||
      (voice.pitch !== null && (voice.pitch < 0 || voice.pitch > 2)) ||
      (voice.volume !== null && (voice.volume < 0 || voice.volume > 1)) || !voice.fallbackVoiceId) {
      context.addIssue({ code: 'custom', path: ['variants', index, 'voice'], message: 'Approved settings require a supported voice and bounded playback values' })
    }
    for (const [trait, selection] of Object.entries(variant.variability)) {
      if (selection.allowedValues.length === 0) {
        context.addIssue({ code: 'custom', path: ['variants', index, 'variability', trait], message: 'Approved settings require at least one educator-selected value per trait' })
      }
    }
  })
})

export type PatientVariantSettings = z.infer<typeof PatientVariantSettingsSchema>
export type PatientVariantSetting = PatientVariantSettings['variants'][number]

export const PatientVariantPresentationSettingsSchema = z.object({
  variantKey: z.enum(PATIENT_VARIANT_KEYS),
  settingsRevision: z.number().int().positive(),
  voiceProfileId: z.string().trim().min(1).max(120),
  provider: z.enum(['browser-speech-synthesis', 'openai-audio-speech']),
  voiceId: z.string().trim().min(1).max(200),
  locale: z.string().trim().min(1).max(200),
  rate: optionalRate,
  pitch: optionalPitch,
  volume: optionalVolume,
  fallbackVoiceId: z.string().trim().min(1).max(200)
}).strict().superRefine((voice, context) => {
  if (voice.provider === 'browser-speech-synthesis') {
    if (!voice.locale || voice.rate === null || voice.pitch === null || voice.volume === null) {
      context.addIssue({ code: 'custom', message: 'Browser speech settings require locale, rate, pitch, and volume' })
    }
    return
  }
  if (!OPENAI_SPEECH_VOICES.includes(voice.voiceId as typeof OPENAI_SPEECH_VOICES[number]) ||
    voice.locale !== 'en' || voice.rate !== null || voice.pitch !== null || voice.volume !== null) {
    context.addIssue({ code: 'custom', message: 'OpenAI speech settings require a supported voice and English locale' })
  }
})

export type PatientVariantPresentationSettings = z.infer<typeof PatientVariantPresentationSettingsSchema>

export interface VariantPersonaProfile {
  dateOfBirth: string
  bodyType: 'average' | 'heavy'
  persona: {
    mood: string
    maturity: string
    verbosity: string
    educationLevel: string
    willingnessToDisclose: string
  }
}

export function derivePatientVariantKey(
  dateOfBirth: string,
  bodyType: 'average' | 'heavy',
  asOf: Date
): typeof PATIENT_VARIANT_KEYS[number] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOfBirth)
  if (!match || !Number.isFinite(asOf.getTime())) throw new Error('A valid birth date and session creation time are required.')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const birthDate = new Date(Date.UTC(year, month - 1, day))
  if (birthDate.getUTCFullYear() !== year || birthDate.getUTCMonth() + 1 !== month || birthDate.getUTCDate() !== day) {
    throw new Error('Patient birth date must be a real YYYY-MM-DD date.')
  }
  let age = asOf.getUTCFullYear() - year
  if (asOf.getUTCMonth() + 1 < month || (asOf.getUTCMonth() + 1 === month && asOf.getUTCDate() < day)) age -= 1
  if (age < 0) throw new Error('Patient birth date cannot be after session creation.')
  const ageBand = age < 20 ? '1019' : age < 30 ? '2029' : age < 40 ? '3039' : age < 50 ? '4049' : '5059'
  return `${ageBand}-${bodyType}` as typeof PATIENT_VARIANT_KEYS[number]
}

function selectAllowedValue(seed: string, variantKey: string, trait: string, values: string[]): string {
  const digest = createHash('sha256').update(`${seed}\0${variantKey}\0${trait}`).digest()
  return values[digest.readUInt32BE(0) % values.length]!
}

export function applyApprovedPatientVariantSettings<T extends VariantPersonaProfile>(
  profile: T,
  asOf: Date,
  scenarioSeed: string,
  settings: PatientVariantSettings
): { profile: T; presentationSettings: PatientVariantPresentationSettings } {
  const validated = PatientVariantSettingsSchema.parse(settings)
  if (validated.status !== 'approved') throw new Error('Only approved patient variant settings can be applied.')
  const variantKey = derivePatientVariantKey(profile.dateOfBirth, profile.bodyType, asOf)
  const variant = validated.variants.find((candidate) => candidate.variantKey === variantKey)
  if (!variant) throw new Error(`Approved settings are missing portrait variant ${variantKey}.`)
  const allowed = variant.variability
  const updatedProfile = {
    ...profile,
    persona: {
      ...profile.persona,
      mood: selectAllowedValue(scenarioSeed, variantKey, 'mood', allowed.mood.allowedValues),
      maturity: selectAllowedValue(scenarioSeed, variantKey, 'maturity', allowed.maturity.allowedValues),
      verbosity: selectAllowedValue(scenarioSeed, variantKey, 'verbosity', allowed.verbosity.allowedValues),
      educationLevel: selectAllowedValue(scenarioSeed, variantKey, 'educationLevel', allowed.educationLevel.allowedValues),
      willingnessToDisclose: selectAllowedValue(scenarioSeed, variantKey, 'willingnessToDisclose', allowed.willingnessToDisclose.allowedValues)
    }
  }
  const presentationSettings = PatientVariantPresentationSettingsSchema.parse({
    variantKey,
    settingsRevision: validated.revision,
    voiceProfileId: variant.voiceProfileId,
    provider: variant.voice.provider,
    voiceId: variant.voice.voiceId,
    locale: variant.voice.locale,
    rate: variant.voice.rate,
    pitch: variant.voice.pitch,
    volume: variant.voice.volume,
    fallbackVoiceId: variant.voice.fallbackVoiceId
  })
  return { profile: updatedProfile, presentationSettings }
}

export interface PatientVariantSettingsStore {
  listTenants(): Promise<Array<{ tenantId: string; displayName: string }>>
  getSettings(tenantId: string): Promise<PatientVariantSettings | null>
  saveSettings(
    tenantId: string,
    changedBy: string,
    settings: PatientVariantSettings
  ): Promise<PatientVariantSettings | null | 'conflict'>
}

interface SettingsRow {
  schema_version: 1
  status: 'draft' | 'approved'
  revision: number
  variants: unknown
}

function parseSettingsRow(row: SettingsRow): PatientVariantSettings {
  return PatientVariantSettingsSchema.parse({
    schemaVersion: row.schema_version,
    status: row.status,
    revision: row.revision,
    variants: row.variants
  })
}

export function createPostgresPatientVariantSettingsStore(pool: Pool): PatientVariantSettingsStore {
  return {
    async listTenants() {
      const result = await pool.query<{ tenant_id: string; display_name: string }>(
        `SELECT t.tenant_id, COALESCE(b.display_name, t.tenant_id) AS display_name
         FROM tenants t
         LEFT JOIN tenant_branding b USING (tenant_id)
         ORDER BY display_name, t.tenant_id`
      )
      return result.rows.map(({ tenant_id, display_name }) => ({ tenantId: tenant_id, displayName: display_name }))
    },

    async getSettings(tenantId) {
      const result = await pool.query<SettingsRow>(
        `SELECT schema_version, status, revision, variants
         FROM tenant_patient_variant_settings WHERE tenant_id = $1`,
        [tenantId]
      )
      const row = result.rows[0]
      return row ? parseSettingsRow(row) : null
    },

    async saveSettings(tenantId, changedBy, settings) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const tenant = await client.query(
          'SELECT tenant_id FROM tenants WHERE tenant_id = $1 FOR UPDATE',
          [tenantId]
        )
        if (tenant.rowCount !== 1) {
          await client.query('ROLLBACK')
          return null
        }
        const current = await client.query<SettingsRow>(
          `SELECT schema_version, status, revision, variants
           FROM tenant_patient_variant_settings WHERE tenant_id = $1 FOR UPDATE`,
          [tenantId]
        )
        const before = current.rows[0] ? parseSettingsRow(current.rows[0]) : null
        if (settings.revision !== (before?.revision ?? 0)) {
          await client.query('ROLLBACK')
          return 'conflict'
        }
        const next = PatientVariantSettingsSchema.parse({ ...settings, revision: (before?.revision ?? 0) + 1 })
        const updated = await client.query<SettingsRow>(
          `INSERT INTO tenant_patient_variant_settings (
             tenant_id, schema_version, status, revision, variants, changed_by
           ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
           ON CONFLICT (tenant_id) DO UPDATE SET
             schema_version = EXCLUDED.schema_version,
             status = EXCLUDED.status,
             revision = EXCLUDED.revision,
             variants = EXCLUDED.variants,
             changed_by = EXCLUDED.changed_by,
             updated_at = now()
           RETURNING schema_version, status, revision, variants`,
          [tenantId, next.schemaVersion, next.status, next.revision, JSON.stringify(next.variants), changedBy]
        )
        const after = parseSettingsRow(updated.rows[0]!)
        await client.query(
          `INSERT INTO tenant_patient_variant_settings_audit
             (tenant_id, changed_by, before_settings, after_settings)
           VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
          [tenantId, changedBy, before ? JSON.stringify(before) : null, JSON.stringify(after)]
        )
        await client.query('COMMIT')
        return after
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    }
  }
}
