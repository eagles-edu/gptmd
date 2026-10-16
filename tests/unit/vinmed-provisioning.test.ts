import { describe, expect, it, vi } from 'vitest'
import { provisionVinmedAdmin } from '../../scripts/provision-vinmed-corporate-admin.mjs'

describe('VinMed corporate-admin provisioning', () => {
  it('seeds only the isolated customer-admin tenant with branding and disabled entitlements', async () => {
    const database = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{
          database_name: 'gptmd_live', database_role: 'gptmd_live_app',
          migrations: ['006_tenant_membership_roles.sql', '040_tenant_branding.sql'], tenant_exists: false
        }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [{
          role: 'customer_admin', status: 'active', sessions_enabled: false, responses_enabled: false,
          display_name: 'VinMed Hospital', logo_path: '/assets/images/vinmed-logo.svg'
        }], rowCount: 1 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
    }

    await provisionVinmedAdmin(database, 'subject-uuid')

    expect(database.query.mock.calls.map(([sql]) => sql)).toContain('COMMIT')
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining("VALUES ($1, $2, 'active', 'customer_admin')"),
      ['vinmed-hospital-demo', 'subject-uuid']
    )
    expect(database.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO tenant_branding'),
      ['vinmed-hospital-demo', '/assets/images/vinmed-logo.svg']
    )
  })

  it('refuses an unknown database and rolls the transaction back before writing', async () => {
    const database = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [], rowCount: 0 })
        .mockResolvedValueOnce({ rows: [{
          database_name: 'gptmd', database_role: 'postgres', migrations: [], tenant_exists: false
        }], rowCount: 1 })
    }

    await expect(provisionVinmedAdmin(database, 'subject-uuid'))
      .rejects.toThrow('Database identity did not match gptmd_live / gptmd_live_app')
    expect(database.query).toHaveBeenCalledTimes(3)
    expect(database.query.mock.calls[2]?.[0]).toBe('ROLLBACK')
  })
})
