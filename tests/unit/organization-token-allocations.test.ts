import { describe, expect, it, vi } from 'vitest'
import type { PoolClient } from 'pg'
import { reconcileOrganizationGroupAllocation } from '../../services/api/src/organization-token-allocations.ts'

const periodStart = new Date('2026-10-01T00:00:00.000Z')
const periodEnd = new Date('2026-11-01T00:00:00.000Z')

function makeClient(existing: Array<{
  grant_id: string
  granted_tokens: string
  allocation_adjustments: string
  usage_delta: string
  held_tokens: string
}> = []) {
  const query = vi.fn(async (sql: string) => sql.includes('FROM gptmd_token_entitlement_grants grant_row')
    ? { rows: existing }
    : { rows: [], rowCount: 1 })
  return { client: { query } as unknown as PoolClient, query }
}

describe('organization group allocation grants', () => {
  it('issues the current group allowance with the organization 45-day carry window', async () => {
    const { client, query } = makeClient()
    await expect(reconcileOrganizationGroupAllocation(client, {
      tenantId: 'hospital-a', groupCode: 'gptnursing', periodStart, periodEnd,
      tokenBudget: 12_000, settingsRevision: 4, grantedBy: 'customer-admin'
    })).resolves.toBe(true)

    const insert = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO gptmd_token_entitlement_grants'))
    expect(insert?.[0]).toContain("'organization_allocation'")
    expect(insert?.[1]).toMatchObject([
      expect.any(String), 'hospital-a', 'gptnursing', expect.stringMatching(/^organization-allocation:[a-f0-9]{64}$/),
      '12000', expect.any(Date), periodStart, periodEnd, new Date('2026-12-16T00:00:00.000Z'), 'customer-admin'
    ])
  })

  it('reduces only unspent and unreserved allocation through an append-only negative entry', async () => {
    const { client, query } = makeClient([{
      grant_id: 'grant-a', granted_tokens: '12000', allocation_adjustments: '0',
      usage_delta: '-2000', held_tokens: '500'
    }])
    await expect(reconcileOrganizationGroupAllocation(client, {
      tenantId: 'hospital-a', groupCode: 'gptnursing', periodStart, periodEnd,
      tokenBudget: 9_000, settingsRevision: 5, grantedBy: 'customer-admin'
    })).resolves.toBe(true)

    const adjustment = query.mock.calls.find(([sql]) => sql.includes('INSERT INTO gptmd_token_entitlement_entries'))
    expect(adjustment?.[0]).toContain("'allocation_adjustment'")
    expect(adjustment?.[1]).toEqual([
      expect.any(String), 'grant-a', '-3000', 'organization-allocation-revision:5', expect.any(Date)
    ])
  })

  it('refuses a reduction that would consume settled or held tokens', async () => {
    const { client, query } = makeClient([{
      grant_id: 'grant-a', granted_tokens: '12000', allocation_adjustments: '0',
      usage_delta: '-9000', held_tokens: '3000'
    }])
    await expect(reconcileOrganizationGroupAllocation(client, {
      tenantId: 'hospital-a', groupCode: 'gptnursing', periodStart, periodEnd,
      tokenBudget: 8_000, settingsRevision: 6, grantedBy: 'customer-admin'
    })).resolves.toBe(false)
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO gptmd_token_entitlement_entries'))).toBe(false)
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT INTO gptmd_token_entitlement_grants'))).toBe(false)
  })
})
