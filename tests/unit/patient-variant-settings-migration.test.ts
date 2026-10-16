import { readFile, readdir } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('patient variant settings migration', () => {
  it('works in standalone PostgreSQL while revoking optional Supabase roles when present', async () => {
    const sql = await readFile(new URL('../../services/api/migrations/026_patient_variant_settings.sql', import.meta.url), 'utf8')

    expect(sql).toContain('ALTER TABLE tenant_patient_variant_settings ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('REVOKE ALL ON tenant_patient_variant_settings, tenant_patient_variant_settings_audit FROM PUBLIC')
    expect(sql).toContain("ARRAY['anon', 'authenticated']")
    expect(sql).toContain('FROM pg_roles WHERE rolname = role_name')
    expect(sql).toContain('FROM %I')
    expect(sql).not.toMatch(/REVOKE[^;]+FROM PUBLIC,\s*anon,\s*authenticated/i)
    expect(sql).toContain('patient_variant_settings_audit_append_only')
    expect(sql).toContain('patient_variant_settings_audit_no_truncate')
  })

  it('keeps the storage-backed verifier on the current settings schema', async () => {
    const verifier = await readFile(new URL('../../scripts/verify-phase2-session-history.mjs', import.meta.url), 'utf8')
    const migrations = (await readdir(new URL('../../services/api/migrations/', import.meta.url)))
      .filter((file) => /^\d{3}_.+\.sql$/.test(file))
      .sort()

    expect(verifier).toContain("readdir(new URL('../services/api/migrations/', import.meta.url))")
    expect(verifier).toContain('.filter((file) => /^\\d{3}_.+\\.sql$/.test(file))')
    expect(verifier).toContain('.sort()')
    expect(migrations).toContain('026_patient_variant_settings.sql')
    expect(migrations).toContain('042_customer_admin_email_invitations.sql')
  })
})
