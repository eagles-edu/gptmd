import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('organization AI-time budget migration', () => {
  it('isolates settings and makes their audit append-only', async () => {
    const sql = await readFile(new URL('../../services/api/migrations/027_organization_ai_time_budgets.sql', import.meta.url), 'utf8')

    expect(sql).toContain('tenant_ai_time_budget_settings ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('tenant_ai_time_budget_audit ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('REVOKE ALL ON tenant_ai_time_budget_settings, tenant_ai_time_budget_audit FROM PUBLIC')
    expect(sql).toContain("ARRAY['anon', 'authenticated']")
    expect(sql).toContain('FROM pg_roles WHERE rolname = role_name')
    expect(sql).toContain('tenant_ai_time_budget_audit_append_only')
    expect(sql).toContain('tenant_ai_time_budget_audit_no_truncate')
  })

  it('stores member assignments separately, pins new sessions, and protects the assignment audit', async () => {
    const sql = await readFile(new URL('../../services/api/migrations/029_ai_budget_group_assignments.sql', import.meta.url), 'utf8')

    expect(sql).toContain('tenant_member_ai_group_assignments')
    expect(sql).toContain('tenant_member_ai_department_assignments')
    expect(sql).toContain('tenant_member_ai_assignment_audit')
    expect(sql).toContain('ADD COLUMN ai_budget_group_code text')
    expect(sql).toContain('ADD COLUMN ai_budget_department_code text')
    expect(sql).toContain('tenant_member_ai_assignment_audit_append_only')
    expect(sql).toContain('tenant_member_ai_assignment_audit_no_truncate')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
  })
})
