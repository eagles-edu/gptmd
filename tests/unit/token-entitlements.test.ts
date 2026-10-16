import { readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'
import type { Pool } from 'pg'
import { createPostgresTokenEntitlementStore } from '../../services/api/src/token-entitlements.ts'

describe('token entitlement buckets', () => {
  it('returns expiring included and add-on grants for the authenticated user and workspace', async () => {
    const at = new Date('2026-10-16T12:00:00.000Z')
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM tenants')) return { rowCount: 1, rows: [{ tenant_id: 'tenant-a' }] }
      if (sql.includes('FROM tenant_ai_time_budget_settings')) return { rowCount: 0, rows: [] }
      if (sql.includes('WITH eligible_grants')) return { rows: [{
        account_scope: 'organization', bucket_kind: 'included', group_code: 'gptnursing',
        granted_tokens: '12000', used_tokens: '2500', reserved_tokens: '500',
        remaining_tokens: '9000', renewal_at: new Date('2026-10-01T00:00:00.000Z'),
        expires_at: new Date('2026-11-15T00:00:00.000Z')
      }, {
        account_scope: 'consumer', bucket_kind: 'addon', group_code: null,
        granted_tokens: '5000', used_tokens: '0', reserved_tokens: '0',
        remaining_tokens: '5000', renewal_at: null,
        expires_at: new Date('2027-10-10T12:00:00.000Z')
      }] }
      return { rows: [] }
    })
    const client = { query, release: vi.fn() }
    const store = createPostgresTokenEntitlementStore({
      connect: vi.fn().mockResolvedValue(client)
    } as unknown as Pool)

    await expect(store.getSubjectBuckets('tenant-a', 'learner-a', at)).resolves.toEqual([{
      accountScope: 'organization', bucketKind: 'included', groupCode: 'gptnursing',
      grantedTokens: '12000', usedTokens: '2500', reservedTokens: '500',
      remainingTokens: '9000', renewalAt: '2026-10-01T00:00:00.000Z',
      expiresAt: '2026-11-15T00:00:00.000Z', daysRemaining: 30
    }, {
      accountScope: 'consumer', bucketKind: 'addon', groupCode: null,
      grantedTokens: '5000', usedTokens: '0', reservedTokens: '0',
      remainingTokens: '5000', renewalAt: null,
      expiresAt: '2027-10-10T12:00:00.000Z', daysRemaining: 359
    }])
    const balanceRead = query.mock.calls.find(([sql]) => sql.includes('WITH eligible_grants'))
    expect(balanceRead?.[0]).toContain("g.account_scope = 'consumer' AND g.subject_id = $2")
    expect(balanceRead?.[0]).toContain("reservation.status IN ('reserved', 'held')")
    expect(balanceRead?.[0]).toContain('tenant_member_ai_group_assignments')
    expect(balanceRead?.[0]).toContain('LIMIT 500')
    expect(balanceRead?.[1]).toEqual(['tenant-a', 'learner-a', at])
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('defines immutable grants/debits, payment-confirmed add-ons, and the account-specific expiry bounds', async () => {
    const migration = await readFile(new URL('../../services/api/migrations/035_token_entitlement_buckets.sql', import.meta.url), 'utf8')
    expect(migration).toContain('gptmd_token_entitlement_grants')
    expect(migration).toContain('gptmd_token_entitlement_entries')
    expect(migration).toContain('gptmd_token_reservation_allocations')
    expect(migration).toContain("source_kind = 'verified_purchase'")
    expect(migration).toContain("expires_at = granted_at + interval '365 days'")
    expect(migration).toContain("expires_at = renewal_at + interval '45 days'")
    expect(migration).toContain('expires_at = renewal_at')
    expect(migration).toContain('gptmd_token_grants_append_only')
    expect(migration).toContain('gptmd_token_entries_append_only')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
  })

  it('persists confirmed add-on use separately from learner acknowledgment', async () => {
    const migration = await readFile(new URL('../../services/api/migrations/037_addon_spend_notice.sql', import.meta.url), 'utf8')
    expect(migration).toContain('addon_tokens_used boolean NOT NULL DEFAULT false')
    expect(migration).toContain('addon_notice_acknowledged boolean NOT NULL DEFAULT false')
  })
})
