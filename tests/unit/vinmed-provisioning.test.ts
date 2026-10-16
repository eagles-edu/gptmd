import { describe, expect, it, vi } from 'vitest'
import { provisionVinmedAdmin } from '../../scripts/provision-vinmed-corporate-admin.mjs'

describe('VinMed corporate-admin provisioning', () => {
  it('seeds only the isolated customer-admin tenant with branding and disabled entitlements', async () => {
    const database = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{
          database_name: 'gptmd_live', database_role: 'gptmd_live_app',
          migrations: [
            '006_tenant_membership_roles.sql', '040_tenant_branding.sql',
            '041_tenant_member_roster_invitations.sql', '042_customer_admin_email_invitations.sql'
          ], tenant_exists: false
        }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{
          requested_role: 'customer_admin', status: 'pending', email: 'ayeyamsam@gmail.com',
          sessions_enabled: false, responses_enabled: false,
          display_name: 'VinMed Hospital', logo_path: '/assets/images/vinmed-logo.svg'
        }], rowCount: 1 })
    }

    await provisionVinmedAdmin(database)

    expect(database.query.mock.calls.map(([sql]) => sql)).toContain('COMMIT')
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1, $2, 'customer_admin', ARRAY[]::text[], NULL, 'gptmd-system-admin')"),
      ['vinmed-hospital-demo', 'ayeyamsam@gmail.com']
    )
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tenant_branding'),
      ['vinmed-hospital-demo', '/assets/images/vinmed-logo.svg']
    )
    expect(database.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO tenant_memberships'))).toBe(false)
  })

  it('refuses an unknown database and rolls the transaction back before writing', async () => {
    const database = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{
          database_name: 'gptmd', database_role: 'postgres', migrations: [], tenant_exists: false
        }], rowCount: 1 })
    }

    await expect(provisionVinmedAdmin(database))
      .rejects.toThrow('Database identity did not match gptmd_live / gptmd_live_app')
    expect(database.query).toHaveBeenCalledTimes(3)
    expect(database.query.mock.calls[2]?.[0]).toBe('ROLLBACK')
  })
})
