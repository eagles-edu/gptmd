import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const seedSql = await readFile(new URL('../../ops/sql/provision-onlineadmin-admin-test.sql', import.meta.url), 'utf8')
const provisioner = await readFile(new URL('../../scripts/provision-onlineadmin-admin-test.mjs', import.meta.url), 'utf8')

describe('onlineadmin customer-admin workspace provisioning', () => {
  it('adds an isolated all-off admin tenant and records its initial policy', () => {
    expect(seedSql).toContain("'gptmd-entitlement-test-onlineadmin'")
    expect(seedSql).toContain("$1, 'active', 'customer_admin'")
    expect(seedSql).toMatch(/SELECT tenant_id, false, false, 5, 5, 50, 50, 12, 1, false, false, 0/)
    expect(seedSql).toContain('INSERT INTO tenant_entitlement_audit')
    expect(seedSql).toContain('WITH admin_tenant AS')
    expect(provisioner).toContain("lower(email) = lower('onlineadmin@eaglesvn.online')")
    expect(provisioner).toContain("target?.database_name !== 'gptmd_live'")
    expect(provisioner).toContain("target.database_role !== 'gptmd_live_app'")
    expect(provisioner).toContain('AS learner_tenant_exists')
    expect(provisioner).toContain('admin workspace already exists; inspect it instead of rerunning provisioning')
  })

  it('requires the existing onlineadmin learner space to remain active and bounded', () => {
    expect(provisioner).toContain("learnerPolicy.role !== 'learner'")
    expect(provisioner).toContain("learnerPolicy.status !== 'active'")
    expect(provisioner).toContain('learnerPolicy.monthly_response_quota !== 50')
    expect(provisioner).toContain('learnerPolicy.monthly_audio_transcription_session_quota !== 0')
    expect(provisioner).toContain("policy.role !== 'customer_admin'")
    expect(provisioner).toContain('policy.after_policy?.[key] !== value')
  })
})
