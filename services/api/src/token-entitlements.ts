import type { Pool } from 'pg'
import {
  getOrganizationAiTimePeriodBounds,
  OrganizationAiTimeBudgetSettingsSchema
} from './organization-ai-time-budget.ts'
import { reconcileOrganizationGroupAllocation } from './organization-token-allocations.ts'

export type TokenEntitlementBucketKind = 'included' | 'addon'
export type TokenEntitlementScope = 'consumer' | 'organization'

export interface TokenBucketBalance {
  accountScope: TokenEntitlementScope
  bucketKind: TokenEntitlementBucketKind
  groupCode: string | null
  grantedTokens: string
  usedTokens: string
  reservedTokens: string
  remainingTokens: string
  renewalAt: string | null
  expiresAt: string
  daysRemaining: number
}

export interface TokenEntitlementStore {
  getSubjectBuckets(tenantId: string, subjectId: string, at?: Date): Promise<TokenBucketBalance[]>
}

export function createPostgresTokenEntitlementStore(pool: Pool): TokenEntitlementStore {
  return {
    async getSubjectBuckets(tenantId, subjectId, at = new Date()) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const tenant = await client.query(
          'SELECT tenant_id FROM tenants WHERE tenant_id = $1 FOR UPDATE',
          [tenantId]
        )
        if (tenant.rowCount !== 1) {
          await client.query('ROLLBACK')
          return []
        }
        const settingsResult = await client.query<{ revision: number; settings: unknown }>(
          `SELECT revision, settings FROM tenant_ai_time_budget_settings WHERE tenant_id = $1 FOR SHARE`,
          [tenantId]
        )
        const settingsRow = settingsResult.rows[0]
        if (settingsRow) {
          const settings = OrganizationAiTimeBudgetSettingsSchema.parse({
            ...(settingsRow.settings as Record<string, unknown>),
            revision: settingsRow.revision
          })
          if (settings.status === 'active') {
            const assignments = await client.query<{ group_code: string }>(
              `SELECT group_code FROM tenant_member_ai_group_assignments
               WHERE tenant_id = $1 AND subject_id = $2 ORDER BY group_code`,
              [tenantId, subjectId]
            )
            const period = getOrganizationAiTimePeriodBounds(
              settings.organizationPeriod.anchorDate, settings.organizationPeriod.months, at
            )
            for (const { group_code: groupCode } of assignments.rows) {
              const group = settings.groups.find((entry) => entry.code === groupCode)
              if (!group) continue
              const reconciled = await reconcileOrganizationGroupAllocation(client, {
                tenantId,
                groupCode,
                periodStart: period.startAt,
                periodEnd: period.endAt,
                tokenBudget: group.tokenBudget,
                settingsRevision: settings.revision,
                grantedBy: 'gptmd-organization-period-allocator',
                grantedAt: at
              })
              if (!reconciled) throw new Error('Organization allocation is below settled or held token usage')
            }
          }
        }
        const result = await client.query<{
        account_scope: TokenEntitlementScope
        bucket_kind: TokenEntitlementBucketKind
        group_code: string | null
        granted_tokens: string
        used_tokens: string
        reserved_tokens: string
        remaining_tokens: string
        renewal_at: Date | null
        expires_at: Date
      }>(
        `WITH eligible_grants AS (
           SELECT g.*
           FROM gptmd_token_entitlement_grants g
           WHERE g.valid_from <= $3 AND g.expires_at > $3
             AND (
               (g.account_scope = 'consumer' AND g.subject_id = $2)
               OR
               (g.account_scope = 'organization' AND g.tenant_id = $1
                AND EXISTS (
                  SELECT 1 FROM tenant_member_ai_group_assignments assignment
                  WHERE assignment.tenant_id = $1 AND assignment.subject_id = $2
                    AND assignment.group_code = g.group_code
                ))
             )
         ), debits AS (
           SELECT grant_id,
                  sum(token_delta) FILTER (WHERE entry_kind IN ('usage_debit', 'reversal'))::bigint AS usage_delta,
                  sum(token_delta) FILTER (WHERE entry_kind = 'allocation_adjustment')::bigint AS allocation_delta
           FROM gptmd_token_entitlement_entries
           GROUP BY grant_id
         ), holds AS (
           SELECT allocation.grant_id, sum(allocation.reserved_tokens)::bigint AS held_tokens
           FROM gptmd_token_reservation_allocations allocation
           JOIN provider_token_reservations reservation USING (reservation_id)
           WHERE reservation.status IN ('reserved', 'held')
           GROUP BY allocation.grant_id
         )
         SELECT entitlement.account_scope, entitlement.bucket_kind, entitlement.group_code,
                GREATEST(0, entitlement.granted_tokens + COALESCE(debits.allocation_delta, 0))::text AS granted_tokens,
                GREATEST(0, -COALESCE(debits.usage_delta, 0))::text AS used_tokens,
                COALESCE(holds.held_tokens, 0)::text AS reserved_tokens,
                GREATEST(0, entitlement.granted_tokens + COALESCE(debits.allocation_delta, 0)
                    + COALESCE(debits.usage_delta, 0)
                    - COALESCE(holds.held_tokens, 0))::text AS remaining_tokens,
                entitlement.renewal_at, entitlement.expires_at
         FROM eligible_grants entitlement
         LEFT JOIN debits USING (grant_id)
         LEFT JOIN holds USING (grant_id)
         ORDER BY entitlement.account_scope, entitlement.bucket_kind, entitlement.expires_at, entitlement.grant_id
         LIMIT 500`,
          [tenantId, subjectId, at]
        )

        const buckets = result.rows.map((row) => ({
        accountScope: row.account_scope,
        bucketKind: row.bucket_kind,
        groupCode: row.group_code,
        grantedTokens: row.granted_tokens,
        usedTokens: row.used_tokens,
        reservedTokens: row.reserved_tokens,
        remainingTokens: row.remaining_tokens,
        renewalAt: row.renewal_at?.toISOString() ?? null,
        expiresAt: row.expires_at.toISOString(),
        daysRemaining: Math.max(0, Math.ceil((row.expires_at.getTime() - at.getTime()) / 86_400_000))
        }))
        await client.query('COMMIT')
        return buckets
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    }
  }
}
