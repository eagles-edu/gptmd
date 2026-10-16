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

  it('stores per-attempt token reservations with tenant scope and protected client access', async () => {
    const sql = await readFile(new URL('../../services/api/migrations/030_provider_token_reservations.sql', import.meta.url), 'utf8')

    expect(sql).toContain('provider_token_reservations')
    expect(sql).toContain('budget_group_code text')
    expect(sql).toContain('budget_department_code text')
    expect(sql).toContain("'reserved', 'settled', 'held', 'released'")
    expect(sql).toContain('provider_response_id text UNIQUE')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('REVOKE ALL ON provider_token_reservations FROM PUBLIC')
  })

  it('pins department transfer time to the session for prorated token enforcement', async () => {
    const sql = await readFile(new URL('../../services/api/migrations/031_ai_budget_enforcement.sql', import.meta.url), 'utf8')
    expect(sql).toContain('ADD COLUMN ai_budget_department_assigned_at timestamptz')
    expect(sql).toContain('SET ai_budget_department_assigned_at = s.created_at')
  })

  it('indexes the tenant-and-subject usage query by its UTC time range', async () => {
    const sql = await readFile(new URL('../../services/api/migrations/034_provider_usage_by_subject.sql', import.meta.url), 'utf8')
    expect(sql).toContain('ON provider_usage (tenant_id, subject_id, occurred_at)')
    expect(sql).toContain('INCLUDE (total_tokens)')
  })

  it('allows only append-only negative group-allocation adjustments', async () => {
    const sql = await readFile(new URL('../../services/api/migrations/038_organization_group_allocation_adjustments.sql', import.meta.url), 'utf8')
    expect(sql).toContain("'usage_debit', 'reversal', 'allocation_adjustment'")
    expect(sql).toContain("entry_kind = 'allocation_adjustment' AND token_delta < 0 AND reservation_id IS NULL")
  })

  it('stores fixed-duration active-session pulses with append-only history and a report index', async () => {
    const sql = await readFile(new URL('../../services/api/migrations/039_session_engagement_pulses.sql', import.meta.url), 'utf8')
    expect(sql).toContain('CREATE TABLE session_engagement_pulses')
    expect(sql).toContain('activity_seconds smallint NOT NULL DEFAULT 30 CHECK (activity_seconds = 30)')
    expect(sql).toContain('PRIMARY KEY (session_id, pulse_id)')
    expect(sql).toContain('session_engagement_pulses_by_tenant_time')
    expect(sql).toContain('session_engagement_pulses_are_append_only')
    expect(sql).toContain('ON DELETE RESTRICT')
  })

  it('stores email roster invitations under the tenant and protects the invitation audit', async () => {
    const sql = await readFile(new URL('../../services/api/migrations/041_tenant_member_roster_invitations.sql', import.meta.url), 'utf8')
    expect(sql).toContain('CREATE TABLE tenant_member_roster_invitations')
    expect(sql).toContain('PRIMARY KEY (tenant_id, email)')
    expect(sql).toContain("status IN ('pending', 'accepted')")
    expect(sql).toContain('accepted_subject_id')
    expect(sql).toContain('tenant_member_roster_invitation_audit')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toContain('tenant_member_roster_invitation_audit_append_only')
    expect(sql).toContain('tenant_member_roster_invitation_audit_no_truncate')
  })

  it('allows system-issued customer-admin email invitations without learner assignments', async () => {
    const sql = await readFile(new URL('../../services/api/migrations/042_customer_admin_email_invitations.sql', import.meta.url), 'utf8')
    expect(sql).toContain("requested_role IN ('learner', 'customer_admin')")
    expect(sql).toContain('tenant_member_roster_admin_invitation_unassigned')
    expect(sql).toContain("'customer_admin_invited'")
    expect(sql).toContain('ADD COLUMN requested_role text NOT NULL DEFAULT')
  })
})
