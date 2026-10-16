import { randomUUID } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import {
  getOrganizationAiTimePeriodBounds,
  OrganizationAiTimeBudgetSettingsSchema
} from './organization-ai-time-budget.ts'
import { reconcileOrganizationGroupAllocation } from './organization-token-allocations.ts'
import type {
  TokenEntitlementBucketKind,
  TokenEntitlementScope
} from './token-entitlements.ts'

export type ProviderTokenOperation = 'scenario_setup' | 'patient_turn'

export class ProviderTokenBudgetExceeded extends Error {
  constructor() {
    super('The selected AI token allowance is exhausted')
    this.name = 'ProviderTokenBudgetExceeded'
  }
}

type GrantAllocation = {
  grant_id: string
  account_scope: TokenEntitlementScope
  bucket_kind: TokenEntitlementBucketKind
  remaining_tokens: string
}

export type ProviderTokenReservation = {
  reservationId: string
  settle(providerResponseId: string, totalTokens: number): Promise<boolean>
  hold(): Promise<void>
}

export interface ProviderTokenReservationStore {
  reserve(input: {
    tenantId: string
    subjectId: string
    sessionId: string
    operation: ProviderTokenOperation
    inputTokens: number
    outputTokenCap: number
  }): Promise<ProviderTokenReservation>
}

type SessionBudget = {
  tenant_id: string
  subject_id: string
  group_code: string | null
  department_code: string | null
  department_assigned_at: Date | null
}

async function getReservedUsage(
  client: PoolClient,
  tenantId: string,
  startAt: Date,
  endAt: Date,
  groupCode?: string,
  subjectId?: string,
  departmentCode?: string,
  departmentAssignedAt?: Date | null
): Promise<bigint> {
  const result = await client.query<{ used_tokens: string }>(
    `SELECT COALESCE(sum(CASE WHEN r.status = 'settled' THEN
       COALESCE((SELECT sum(-entry.token_delta)::bigint
                 FROM gptmd_token_entitlement_entries entry
                 JOIN gptmd_token_entitlement_grants g USING (grant_id)
                 WHERE entry.reservation_id = r.reservation_id
                   AND g.account_scope = 'organization' AND g.bucket_kind = 'included'), 0)
       ELSE COALESCE((SELECT sum(allocation.reserved_tokens)::bigint
                      FROM gptmd_token_reservation_allocations allocation
                      JOIN gptmd_token_entitlement_grants g USING (grant_id)
                      WHERE allocation.reservation_id = r.reservation_id
                        AND g.account_scope = 'organization' AND g.bucket_kind = 'included'), 0)
       END), 0)::text AS used_tokens
     FROM provider_token_reservations r
     JOIN app_sessions s ON s.session_id = r.session_id
     WHERE r.tenant_id = $1
       AND r.status IN ('reserved', 'held', 'settled')
       AND r.created_at >= $2 AND r.created_at < $3
       AND ($4::text IS NULL OR r.budget_group_code = $4)
       AND ($5::text IS NULL OR r.subject_id = $5)
       AND ($6::text IS NULL OR r.budget_department_code = $6)
       AND ($7::timestamptz IS NULL OR s.ai_budget_department_assigned_at >= $7)
     `,
    [tenantId, startAt, endAt, groupCode ?? null, subjectId ?? null, departmentCode ?? null,
      departmentAssignedAt ?? null]
  )
  return BigInt(result.rows[0]?.used_tokens ?? '0')
}

async function assertAllowance(
  client: PoolClient,
  input: {
    tenantId: string
    requested: bigint
    limit: number | null
    startAt: Date
    endAt: Date
    groupCode?: string
    subjectId?: string
    departmentCode?: string
    departmentAssignedAt?: Date | null
  }
): Promise<void> {
  if (input.limit === null || input.requested === 0n) return
  const used = await getReservedUsage(
    client, input.tenantId, input.startAt, input.endAt,
    input.groupCode, input.subjectId, input.departmentCode, input.departmentAssignedAt
  )
  if (used + input.requested > BigInt(input.limit)) throw new ProviderTokenBudgetExceeded()
}

function calendarMonthBounds(reference: Date): { startAt: Date; endAt: Date } {
  return {
    startAt: new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1)),
    endAt: new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth() + 1, 1))
  }
}

function proratedDepartmentLimit(monthlyLimit: number | null | undefined, assignedAt: Date | null): number | null {
  if (monthlyLimit == null) return null
  const now = new Date()
  const { startAt, endAt } = calendarMonthBounds(now)
  const beginsAt = assignedAt && assignedAt > startAt && assignedAt < endAt ? assignedAt : startAt
  const fraction = Math.max(0, Math.min(1, (endAt.getTime() - beginsAt.getTime()) / (endAt.getTime() - startAt.getTime())))
  return Math.floor(monthlyLimit * fraction)
}

export function createPostgresProviderTokenReservationStore(pool: Pool): ProviderTokenReservationStore {
  return {
    async reserve(input) {
      if (!Number.isSafeInteger(input.inputTokens) || input.inputTokens < 0 ||
          !Number.isSafeInteger(input.outputTokenCap) || input.outputTokenCap < 1) {
        throw new Error('Provider token reservation counts must be nonnegative safe integers')
      }

      const client = await pool.connect()
      const reservationId = randomUUID()
      try {
        await client.query('BEGIN')
        const tenant = await client.query(
          'SELECT tenant_id FROM tenants WHERE tenant_id = $1 FOR UPDATE',
          [input.tenantId]
        )
        if (tenant.rowCount !== 1) throw new Error('Provider token reservation workspace is unavailable')
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
          [`gptmd-token-subject:${input.subjectId}`]
        )

        const sessionResult = await client.query<SessionBudget>(
          `SELECT s.tenant_id, s.subject_id,
                  s.ai_budget_group_code AS group_code,
                  s.ai_budget_department_code AS department_code,
                  s.ai_budget_department_assigned_at AS department_assigned_at
           FROM app_sessions s
           JOIN tenant_memberships m
             ON m.tenant_id = s.tenant_id AND m.subject_id = s.subject_id AND m.status = 'active'
           WHERE s.session_id = $1 AND s.tenant_id = $2 AND s.subject_id = $3
             AND s.status IN ('initializing', 'ready', 'active')`,
          [input.sessionId, input.tenantId, input.subjectId]
        )
        const session = sessionResult.rows[0]
        if (!session) throw new Error('Provider token reservation session is unavailable')

        const settingsResult = await client.query<{ revision: number; settings: unknown }>(
          `SELECT revision, settings FROM tenant_ai_time_budget_settings WHERE tenant_id = $1 FOR SHARE`,
          [input.tenantId]
        )
        const reservation = BigInt(input.inputTokens) + BigInt(input.outputTokenCap)
        const now = new Date()
        const month = calendarMonthBounds(now)
        const settingsRow = settingsResult.rows[0]
        let groupCode: string | null = null
        let enforceIncludedAllowance: ((tokens: bigint) => Promise<void>) | null = null
        if (settingsRow) {
          const settings = OrganizationAiTimeBudgetSettingsSchema.parse({
            ...(settingsRow.settings as Record<string, unknown>),
            revision: settingsRow.revision
          })
          if (settings.status === 'active') {
            const group = settings.groups.find(({ code }) => code === session.group_code)
            if (!group) throw new ProviderTokenBudgetExceeded()
            groupCode = group.code
            const orgPeriod = getOrganizationAiTimePeriodBounds(
              settings.organizationPeriod.anchorDate, settings.organizationPeriod.months, now
            )
            const allocationReady = await reconcileOrganizationGroupAllocation(client, {
              tenantId: input.tenantId,
              groupCode: group.code,
              periodStart: orgPeriod.startAt,
              periodEnd: orgPeriod.endAt,
              tokenBudget: group.tokenBudget,
              settingsRevision: settings.revision,
              grantedBy: 'gptmd-organization-period-allocator',
              grantedAt: now
            })
            if (!allocationReady) throw new ProviderTokenBudgetExceeded()

            const department = settings.departments.find(({ code }) => code === session.department_code)
            if (session.department_code && !department) throw new ProviderTokenBudgetExceeded()
            if (department?.monthlyTokensPerUser != null && !session.department_assigned_at) {
              throw new ProviderTokenBudgetExceeded()
            }
            const departmentLimit = proratedDepartmentLimit(
              department?.monthlyTokensPerUser, session.department_assigned_at
            )
            const departmentStart = session.department_assigned_at && session.department_assigned_at > month.startAt
              ? session.department_assigned_at : month.startAt
            enforceIncludedAllowance = async (includedTokens) => {
              await assertAllowance(client, {
                tenantId: input.tenantId, requested: includedTokens,
                limit: settings.organizationPool.tokens, ...orgPeriod
              })
              await assertAllowance(client, {
                tenantId: input.tenantId, requested: includedTokens,
                limit: group.tokenBudget, ...orgPeriod, groupCode: group.code
              })
              await assertAllowance(client, {
                tenantId: input.tenantId, requested: includedTokens,
                limit: group.monthlyTokensPerUser, ...month,
                groupCode: group.code, subjectId: input.subjectId
              })
              if (department && departmentLimit !== null) {
                await assertAllowance(client, {
                  tenantId: input.tenantId, requested: includedTokens,
                  limit: departmentLimit,
                  startAt: departmentStart, endAt: month.endAt,
                  subjectId: input.subjectId, departmentCode: department.code,
                  departmentAssignedAt: session.department_assigned_at
                })
              }
            }
          }
        }

        const grantResult = await client.query<GrantAllocation>(
          `SELECT g.grant_id, g.account_scope, g.bucket_kind,
                  GREATEST(0, g.granted_tokens
                    + COALESCE((SELECT sum(entry.token_delta)::bigint
                                FROM gptmd_token_entitlement_entries entry
                                WHERE entry.grant_id = g.grant_id), 0)
                    - COALESCE((SELECT sum(allocation.reserved_tokens)::bigint
                                FROM gptmd_token_reservation_allocations allocation
                                JOIN provider_token_reservations held
                                  USING (reservation_id)
                                WHERE allocation.grant_id = g.grant_id
                                  AND held.status IN ('reserved', 'held')), 0)
                  )::text AS remaining_tokens
           FROM gptmd_token_entitlement_grants g
           WHERE g.valid_from <= $4 AND g.expires_at > $4
             AND (
               (g.account_scope = 'organization' AND g.tenant_id = $1
                AND g.group_code = $3)
               OR
               (g.account_scope = 'consumer' AND g.subject_id = $2
                AND ($3::text IS NULL OR g.bucket_kind = 'addon'))
             )
           ORDER BY CASE
                      WHEN g.account_scope = 'organization' AND g.bucket_kind = 'included' THEN 0
                      WHEN g.account_scope = 'organization' AND g.bucket_kind = 'addon' THEN 1
                      WHEN g.account_scope = 'consumer' AND g.bucket_kind = 'included' THEN 2
                      ELSE 3
                    END,
                    g.expires_at, g.grant_id
           FOR UPDATE OF g
           LIMIT 500`,
          [input.tenantId, input.subjectId, groupCode, now]
        )
        let unallocated = reservation
        const allocations: Array<{ grantId: string; tokens: bigint }> = []
        for (const grant of grantResult.rows) {
          const available = BigInt(grant.remaining_tokens)
          if (available <= 0n) continue
          const amount = available < unallocated ? available : unallocated
          allocations.push({ grantId: grant.grant_id, tokens: amount })
          unallocated -= amount
          if (unallocated === 0n) break
        }
        if (unallocated > 0n) throw new ProviderTokenBudgetExceeded()
        const includedOrganizationTokens = allocations.reduce((total, allocation) => {
          const grant = grantResult.rows.find(({ grant_id }) => grant_id === allocation.grantId)
          return grant?.account_scope === 'organization' && grant.bucket_kind === 'included'
            ? total + allocation.tokens : total
        }, 0n)
        await enforceIncludedAllowance?.(includedOrganizationTokens)

        await client.query(
          `INSERT INTO provider_token_reservations (
             reservation_id, tenant_id, subject_id, session_id,
             budget_group_code, budget_department_code, operation,
             input_tokens, output_token_cap
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [reservationId, input.tenantId, input.subjectId, input.sessionId,
            session.group_code, session.department_code, input.operation,
            input.inputTokens, input.outputTokenCap]
        )
        for (const allocation of allocations) {
          await client.query(
            `INSERT INTO gptmd_token_reservation_allocations
               (reservation_id, grant_id, reserved_tokens)
             VALUES ($1, $2, $3)`,
            [reservationId, allocation.grantId, allocation.tokens.toString()]
          )
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }

      const settle = async (providerResponseId: string, totalTokens: number): Promise<boolean> => {
        if (!providerResponseId.trim() || !Number.isSafeInteger(totalTokens) || totalTokens < 0) {
          throw new Error('Provider usage reconciliation is invalid')
        }
        const client = await pool.connect()
        try {
          await client.query('BEGIN')
          const current = await client.query<{ status: string; subject_id: string; session_id: string; tenant_id: string; provider_response_id: string | null; actual_total_tokens: number | null }>(
            `SELECT status, subject_id, session_id, tenant_id, provider_response_id, actual_total_tokens
             FROM provider_token_reservations WHERE reservation_id = $1 FOR UPDATE`,
            [reservationId]
          )
          const row = current.rows[0]
          if (row?.status === 'settled') {
            if (row.provider_response_id !== providerResponseId || row.actual_total_tokens !== totalTokens) {
              throw new Error('Provider token reservation reconciliation conflicts')
            }
            const prior = await client.query<{ used_addon: boolean }>(
              `SELECT EXISTS (
                 SELECT 1 FROM gptmd_token_entitlement_entries entry
                 JOIN gptmd_token_entitlement_grants grant_row USING (grant_id)
                 WHERE entry.reservation_id = $1 AND grant_row.bucket_kind = 'addon'
                   AND entry.entry_kind = 'usage_debit'
               ) AS used_addon`,
              [reservationId]
            )
            await client.query('COMMIT')
            return prior.rows[0]?.used_addon === true
          }
          if (!row || !['reserved', 'held'].includes(row.status)) {
            throw new Error('Provider token reservation reconciliation conflicts')
          }
          await client.query(
            'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
            [`gptmd-token-subject:${row.subject_id}`]
          )
          await client.query(
            `SELECT g.grant_id
             FROM gptmd_token_reservation_allocations allocation
             JOIN gptmd_token_entitlement_grants g USING (grant_id)
             WHERE allocation.reservation_id = $1
             ORDER BY g.grant_id FOR UPDATE OF g`,
            [reservationId]
          )
          const held = await client.query<{
            grant_id: string
            reserved_tokens: string
            bucket_kind: TokenEntitlementBucketKind
          }>(
            `SELECT allocation.grant_id, allocation.reserved_tokens::text AS reserved_tokens,
                    grant_row.bucket_kind
             FROM gptmd_token_reservation_allocations allocation
             JOIN gptmd_token_entitlement_grants grant_row USING (grant_id)
             WHERE allocation.reservation_id = $1
             ORDER BY CASE
                        WHEN grant_row.account_scope = 'organization' AND grant_row.bucket_kind = 'included' THEN 0
                        WHEN grant_row.account_scope = 'organization' AND grant_row.bucket_kind = 'addon' THEN 1
                        WHEN grant_row.account_scope = 'consumer' AND grant_row.bucket_kind = 'included' THEN 2
                        ELSE 3
                      END, allocation.grant_id
             FOR UPDATE OF allocation`,
            [reservationId]
          )
          let remaining = BigInt(totalTokens)
          const debitEntries: Array<{ grantId: string; tokens: bigint; bucketKind: TokenEntitlementBucketKind }> = []
          for (const allocation of held.rows) {
            if (remaining === 0n) break
            const amount = BigInt(allocation.reserved_tokens) < remaining
              ? BigInt(allocation.reserved_tokens) : remaining
            debitEntries.push({ grantId: allocation.grant_id, tokens: amount, bucketKind: allocation.bucket_kind })
            remaining -= amount
          }
          if (remaining > 0n) throw new Error('Provider usage exceeded its token entitlement reservation')
          for (const debit of debitEntries) {
            await client.query(
              `INSERT INTO gptmd_token_entitlement_entries
                 (entry_id, grant_id, reservation_id, entry_kind, token_delta,
                  source_reference, occurred_at)
               VALUES ($1, $2, $3, 'usage_debit', $4, $5, now())`,
              [randomUUID(), debit.grantId, reservationId, (-debit.tokens).toString(),
                `provider-reservation:${reservationId}:${debit.grantId}`]
            )
          }
          const usedAddon = debitEntries.some(({ bucketKind, tokens }) => bucketKind === 'addon' && tokens > 0n)
          if (usedAddon && input.operation === 'patient_turn') {
            await client.query(
              `UPDATE app_sessions SET addon_tokens_used = true
               WHERE session_id = $1 AND tenant_id = $2 AND subject_id = $3`,
              [row.session_id, row.tenant_id, row.subject_id]
            )
          }
          await client.query(
            'DELETE FROM gptmd_token_reservation_allocations WHERE reservation_id = $1',
            [reservationId]
          )
          await client.query(
            `UPDATE provider_token_reservations
             SET status = 'settled', provider_response_id = $2, actual_total_tokens = $3,
                 settled_at = COALESCE(settled_at, now()), updated_at = now()
             WHERE reservation_id = $1`,
            [reservationId, providerResponseId, totalTokens]
          )
          await client.query('COMMIT')
          return usedAddon
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined)
          throw error
        } finally {
          client.release()
        }
      }
      const hold = async (): Promise<void> => {
        await pool.query(
          `UPDATE provider_token_reservations
           SET status = 'held', updated_at = now()
           WHERE reservation_id = $1 AND status = 'reserved'`,
          [reservationId]
        )
      }
      return { reservationId, settle, hold }
    }
  }
}
