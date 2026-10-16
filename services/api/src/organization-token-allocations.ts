import { createHash, randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'

interface OrganizationGroupGrantRow {
  grant_id: string
  granted_tokens: string
  allocation_adjustments: string
  usage_delta: string
  held_tokens: string
}

export async function reconcileOrganizationGroupAllocation(
  client: PoolClient,
  input: {
    tenantId: string
    groupCode: string
    periodStart: Date
    periodEnd: Date
    tokenBudget: number
    settingsRevision: number
    grantedBy: string
    grantedAt?: Date
  }
): Promise<boolean> {
  const existing = await client.query<OrganizationGroupGrantRow>(
    `SELECT grant_row.grant_id, grant_row.granted_tokens::text AS granted_tokens,
            COALESCE((
              SELECT sum(entry.token_delta)::bigint
              FROM gptmd_token_entitlement_entries entry
              WHERE entry.grant_id = grant_row.grant_id
                AND entry.entry_kind = 'allocation_adjustment'
            ), 0)::text AS allocation_adjustments,
            COALESCE((
              SELECT sum(entry.token_delta)::bigint
              FROM gptmd_token_entitlement_entries entry
              WHERE entry.grant_id = grant_row.grant_id
                AND entry.entry_kind IN ('usage_debit', 'reversal')
            ), 0)::text AS usage_delta,
            COALESCE((
              SELECT sum(allocation.reserved_tokens)::bigint
              FROM gptmd_token_reservation_allocations allocation
              JOIN provider_token_reservations reservation USING (reservation_id)
              WHERE allocation.grant_id = grant_row.grant_id
                AND reservation.status IN ('reserved', 'held')
            ), 0)::text AS held_tokens
     FROM gptmd_token_entitlement_grants grant_row
     WHERE grant_row.account_scope = 'organization'
       AND grant_row.tenant_id = $1 AND grant_row.group_code = $2
       AND grant_row.bucket_kind = 'included'
       AND grant_row.source_kind = 'organization_allocation'
       AND grant_row.valid_from = $3 AND grant_row.renewal_at = $4
     ORDER BY grant_row.grant_id
     FOR UPDATE OF grant_row`,
    [input.tenantId, input.groupCode, input.periodStart, input.periodEnd]
  )
  const allocated = existing.rows.reduce((sum, row) =>
    sum + BigInt(row.granted_tokens) + BigInt(row.allocation_adjustments), 0n)
  const difference = BigInt(input.tokenBudget) - allocated
  if (difference === 0n) return true

  const freeByGrant = existing.rows.map((row) => ({
    grantId: row.grant_id,
    free: BigInt(row.granted_tokens) + BigInt(row.allocation_adjustments)
      + BigInt(row.usage_delta) - BigInt(row.held_tokens)
  }))

  if (difference > 0n) {
    const grantedAt = input.grantedAt ?? new Date()
    const sourceDigest = createHash('sha256')
      .update(`${input.tenantId}\n${input.groupCode}\n${input.periodStart.toISOString()}\n${input.periodEnd.toISOString()}\n${input.settingsRevision}`)
      .digest('hex')
    const expiresAt = new Date(input.periodEnd.getTime() + 45 * 24 * 60 * 60 * 1000)
    await client.query(
      `INSERT INTO gptmd_token_entitlement_grants (
         grant_id, account_scope, subject_id, tenant_id, group_code,
         bucket_kind, source_kind, source_reference, granted_tokens,
         granted_at, valid_from, renewal_at, expires_at, granted_by
       ) VALUES ($1, 'organization', NULL, $2, $3, 'included',
                 'organization_allocation', $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (account_scope, source_reference) DO NOTHING`,
      [randomUUID(), input.tenantId, input.groupCode,
        `organization-allocation:${sourceDigest}`, difference.toString(),
        grantedAt, input.periodStart, input.periodEnd, expiresAt, input.grantedBy]
    )
    return true
  }

  let reduction = -difference
  if (freeByGrant.reduce((sum, grant) => sum + grant.free, 0n) < reduction ||
      freeByGrant.reduce((sum, grant) => sum + (grant.free > 0n ? grant.free : 0n), 0n) < reduction) {
    return false
  }
  for (const grant of freeByGrant) {
    if (reduction === 0n) break
    const amount = grant.free < reduction ? grant.free : reduction
    if (amount <= 0n) continue
    await client.query(
      `INSERT INTO gptmd_token_entitlement_entries (
         entry_id, grant_id, reservation_id, entry_kind, token_delta,
         source_reference, occurred_at
       ) VALUES ($1, $2, NULL, 'allocation_adjustment', $3, $4, $5)`,
      [randomUUID(), grant.grantId, (-amount).toString(),
        `organization-allocation-revision:${input.settingsRevision}`, input.grantedAt ?? new Date()]
    )
    reduction -= amount
  }
  return reduction === 0n
}
