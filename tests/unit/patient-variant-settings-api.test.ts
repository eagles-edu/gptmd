import { describe, expect, it, vi } from 'vitest'
import type { Pool, PoolClient } from 'pg'
import {
  PATIENT_VARIANT_KEYS,
  PatientVariantSettingsSchema,
  applyApprovedPatientVariantSettings,
  createPostgresPatientVariantSettingsStore,
  type PatientVariantSettings
} from '../../services/api/src/patient-variant-settings.ts'

function draftSettings(): PatientVariantSettings {
  return {
    schemaVersion: 1,
    status: 'draft',
    revision: 0,
    variants: PATIENT_VARIANT_KEYS.map((variantKey) => ({
      variantKey,
      voiceProfileId: `voice-${variantKey}`,
      voice: {
        provider: null,
        voiceId: null,
        locale: null,
        rate: null,
        pitch: null,
        volume: null,
        fallbackVoiceId: null
      },
      variabilityProfileId: `variability-${variantKey}`,
      variability: {
        mood: { allowedValues: [] },
        maturity: { allowedValues: [] },
        verbosity: { allowedValues: [] },
        educationLevel: { allowedValues: [] },
        willingnessToDisclose: { allowedValues: [] }
      }
    }))
  }
}

function approvedSettings(): PatientVariantSettings {
  const draft = draftSettings()
  return {
    ...draft,
    status: 'approved',
    revision: 7,
    variants: draft.variants.map((variant) => ({
      ...variant,
      voice: {
        provider: 'browser-speech-synthesis',
        voiceId: `voice-${variant.variantKey}`,
        locale: 'en-US',
        rate: 1.05,
        pitch: 0.95,
        volume: 0.8,
        fallbackVoiceId: `fallback-${variant.variantKey}`
      },
      variability: {
        mood: { allowedValues: [`mood-${variant.variantKey}`] },
        maturity: { allowedValues: [`maturity-${variant.variantKey}`] },
        verbosity: { allowedValues: [`verbosity-${variant.variantKey}`] },
        educationLevel: { allowedValues: [`education-${variant.variantKey}`] },
        willingnessToDisclose: { allowedValues: [`disclosure-${variant.variantKey}`] }
      }
    }))
  }
}

describe('patient variant settings contract', () => {
  it('requires ten unique variant records and blocks approval until each profile is complete', () => {
    const draft = draftSettings()
    expect(PatientVariantSettingsSchema.safeParse(draft).success).toBe(true)
    expect(PatientVariantSettingsSchema.safeParse({
      ...draft,
      variants: [...draft.variants.slice(1), draft.variants[1]]
    }).success).toBe(false)

    const approval = PatientVariantSettingsSchema.safeParse({ ...draft, status: 'approved' })
    expect(approval.success).toBe(false)
    if (!approval.success) {
      expect(approval.error.issues.some((issue) => issue.message.includes('educator-selected'))).toBe(true)
    }
  })

  it('requires distinct voices across approved portrait variants and accepts supported server speech', () => {
    const settings = approvedSettings()
    const duplicateVoice = structuredClone(settings)
    duplicateVoice.variants[1]!.voice.voiceId = duplicateVoice.variants[0]!.voice.voiceId
    expect(PatientVariantSettingsSchema.safeParse(duplicateVoice).success).toBe(false)

    const serverVoice = structuredClone(settings)
    serverVoice.variants[0]!.voice = {
      provider: 'openai-audio-speech', voiceId: 'coral', locale: 'en',
      rate: null, pitch: null, volume: null, fallbackVoiceId: 'fallback-1019-average'
    }
    expect(PatientVariantSettingsSchema.safeParse(serverVoice).success).toBe(true)
    serverVoice.variants[1]!.voice = {
      provider: 'openai-audio-speech', voiceId: 'coral', locale: 'en',
      rate: null, pitch: null, volume: null, fallbackVoiceId: 'fallback-1019-heavy'
    }
    expect(PatientVariantSettingsSchema.safeParse(serverVoice).success).toBe(false)
  })

  it('applies only the selected approved variant and pins its voice snapshot deterministically', () => {
    const settings = approvedSettings()
    const profile = {
      dateOfBirth: '1990-02-01',
      bodyType: 'average' as const,
      diagnosis: 'Endometriosis',
      persona: {
        mood: 'generated mood', maturity: 'generated maturity', verbosity: 'generated verbosity',
        educationLevel: 'generated education', willingnessToDisclose: 'generated disclosure'
      }
    }
    const asOf = new Date('2026-01-10T00:00:00.000Z')
    const first = applyApprovedPatientVariantSettings(profile, asOf, 's'.repeat(43), settings)
    const repeated = applyApprovedPatientVariantSettings(profile, asOf, 's'.repeat(43), settings)

    expect(first).toEqual(repeated)
    expect(first.profile).toMatchObject({
      diagnosis: 'Endometriosis',
      persona: {
        mood: 'mood-3039-average', maturity: 'maturity-3039-average',
        verbosity: 'verbosity-3039-average', educationLevel: 'education-3039-average',
        willingnessToDisclose: 'disclosure-3039-average'
      }
    })
    expect(profile.persona.mood).toBe('generated mood')
    expect(first.presentationSettings).toEqual({
      variantKey: '3039-average', settingsRevision: 7, voiceProfileId: 'voice-3039-average',
      provider: 'browser-speech-synthesis', voiceId: 'voice-3039-average', locale: 'en-US',
      rate: 1.05, pitch: 0.95, volume: 0.8, fallbackVoiceId: 'fallback-3039-average'
    })
  })

  it('refuses to apply drafts to a generated patient', () => {
    const draft = draftSettings()
    const profile = {
      dateOfBirth: '1990-02-01', bodyType: 'average' as const,
      persona: {
        mood: 'mood', maturity: 'maturity', verbosity: 'verbosity',
        educationLevel: 'education', willingnessToDisclose: 'disclosure'
      }
    }

    expect(() => applyApprovedPatientVariantSettings(profile, new Date('2026-01-10T00:00:00.000Z'), 's'.repeat(43), draft))
      .toThrow('Only approved patient variant settings can be applied.')
  })

  it('saves the tenant settings and before/after audit atomically with a server-owned revision', async () => {
    const draft = draftSettings()
    const saved = { ...draft, revision: 1 }
    const statements: Array<{ sql: string; values?: unknown[] }> = []
    const client = {
      query: vi.fn(async (sql: string, values?: unknown[]) => {
        statements.push({ sql, values })
        if (sql.includes('SELECT tenant_id FROM tenants')) return { rows: [{ tenant_id: 'tenant-a' }], rowCount: 1 }
        if (sql.includes('SELECT schema_version, status, revision, variants')) return { rows: [] }
        if (sql.includes('RETURNING schema_version, status, revision, variants')) {
          return { rows: [{ schema_version: 1, status: 'draft', revision: 1, variants: saved.variants }] }
        }
        return { rows: [] }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool

    const result = await createPostgresPatientVariantSettingsStore(pool)
      .saveSettings('tenant-a', 'instructor-1', draft)

    expect(result).toEqual(saved)
    expect(statements.map(({ sql }) => sql)).toEqual(expect.arrayContaining([
      'BEGIN', expect.stringContaining('SELECT tenant_id FROM tenants'),
      expect.stringContaining('INSERT INTO tenant_patient_variant_settings'),
      expect.stringContaining('INSERT INTO tenant_patient_variant_settings_audit'), 'COMMIT'
    ]))
    const insert = statements.find(({ sql }) => sql.includes('INSERT INTO tenant_patient_variant_settings ('))
    expect(insert?.values?.[3]).toBe(1)
    const audit = statements.find(({ sql }) => sql.includes('INSERT INTO tenant_patient_variant_settings_audit'))
    expect(audit?.values?.slice(0, 2)).toEqual(['tenant-a', 'instructor-1'])
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('does not write settings for an unknown tenant', async () => {
    const client = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool

    await expect(createPostgresPatientVariantSettingsStore(pool)
      .saveSettings('missing-tenant', 'instructor-1', draftSettings())).resolves.toBeNull()
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('rejects a stale revision without overwriting the newer settings', async () => {
    const draft = draftSettings()
    const newer = { ...draft, revision: 3 }
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes('SELECT tenant_id FROM tenants')) return { rows: [{ tenant_id: 'tenant-a' }], rowCount: 1 }
        if (sql.includes('SELECT schema_version, status, revision, variants')) {
          return { rows: [{ schema_version: 1, status: 'draft', revision: 3, variants: newer.variants }] }
        }
        return { rows: [] }
      }),
      release: vi.fn()
    } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool

    await expect(createPostgresPatientVariantSettingsStore(pool)
      .saveSettings('tenant-a', 'instructor-1', draft)).resolves.toBe('conflict')
    expect(client.query).toHaveBeenCalledWith('ROLLBACK')
    expect((client.query as unknown as { mock: { calls: unknown[][] } }).mock.calls
      .some(([sql]) => typeof sql === 'string' && sql.includes('INSERT INTO tenant_patient_variant_settings ('))).toBe(false)
    expect(client.release).toHaveBeenCalledOnce()
  })
})
