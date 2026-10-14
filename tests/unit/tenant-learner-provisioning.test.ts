import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const seedSql = await readFile(new URL('../../ops/sql/provision-scsstx-learner-test.sql', import.meta.url), 'utf8')
const provisioner = await readFile(new URL('../../scripts/provision-scsstx-learner-test.mjs', import.meta.url), 'utf8')

describe('scsstx learner test workspace provisioning', () => {
  it('grants only capped text access and records its initial policy', () => {
    expect(seedSql).toContain("'gptmd-learner-test-scsstx'")
    expect(seedSql).toContain("$1, 'active', 'learner'")
    expect(seedSql).toMatch(/SELECT tenant_id, true, true, 5, 5, 50, 50, 12, 1, false, false, 0/)
    expect(seedSql).toContain('INSERT INTO tenant_entitlement_audit')
    expect(seedSql).toContain('monthlyAudioTranscriptionSessionQuota')
    expect(provisioner).toContain("target?.database_name !== 'gptmd_live'")
    expect(provisioner).toContain("target.database_role !== 'gptmd_live_app'")
    expect(provisioner).toContain('Migrations 024/025 are not both recorded')
    expect(provisioner).toContain('learner workspace already exists; inspect it instead of rerunning provisioning')
  })

  it('requires the existing customer-admin control workspace to remain all-off', () => {
    expect(provisioner).toContain("controlMembership.role !== 'customer_admin'")
    expect(provisioner).toContain('controlMembership.sessions_enabled || controlMembership.responses_enabled')
    expect(provisioner).toContain("policy.role !== 'learner'")
    expect(provisioner).toContain('audio_transcription_enabled')
  })
})
