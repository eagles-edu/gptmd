import type { Pool } from 'pg'
import { z } from 'zod'
import { reconcileOrganizationGroupAllocation } from './organization-token-allocations.ts'

const MAX_BUDGET = 2_147_483_647
const budget = z.number().int().min(0).max(MAX_BUDGET)
const nullableMonthlyBudget = budget.nullable()
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
})

const GroupBudgetSchema = z.object({
  code: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,39}$/),
  name: z.string().trim().min(1).max(100),
  tokenBudget: budget,
  estimatedMinuteBudget: budget,
  monthlyTokensPerUser: nullableMonthlyBudget,
  monthlyEstimatedMinutesPerUser: nullableMonthlyBudget
}).strict()

const DepartmentSchema = z.object({
  code: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,39}$/),
  name: z.string().trim().min(1).max(100),
  monthlyTokensPerUser: nullableMonthlyBudget.optional()
}).strict()

export const OrganizationAiMemberAssignmentInputSchema = z.object({
  subjectId: z.string().trim().min(1).max(200),
  groupCodes: z.array(z.string().trim().regex(/^[a-z][a-z0-9_-]{1,39}$/)).max(100),
  departmentCode: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,39}$/).nullable()
}).strict().superRefine((assignment, context) => {
  if (new Set(assignment.groupCodes).size !== assignment.groupCodes.length) {
    context.addIssue({ code: 'custom', path: ['groupCodes'], message: 'Group assignments must be unique' })
  }
})

export const OrganizationAiMemberAssignmentImportSchema = z.array(OrganizationAiMemberAssignmentInputSchema).min(1).max(500)

export const OrganizationAiMemberRosterInvitationSchema = z.object({
  email: z.string().trim().email().max(254).transform((email) => email.toLowerCase()),
  groupCodes: z.array(z.string().trim().regex(/^[a-z][a-z0-9_-]{1,39}$/)).max(100),
  departmentCode: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,39}$/).nullable()
}).strict().superRefine((invitation, context) => {
  if (new Set(invitation.groupCodes).size !== invitation.groupCodes.length) {
    context.addIssue({ code: 'custom', path: ['groupCodes'], message: 'Group assignments must be unique' })
  }
})

export const OrganizationAiMemberRosterInvitationImportSchema = z.array(
  OrganizationAiMemberRosterInvitationSchema
).min(1).max(500)

export const OrganizationAiTimeBudgetSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  status: z.enum(['draft', 'active']),
  organizationPeriod: z.object({
    months: z.number().int().min(1).max(12),
    anchorDate: date
  }).strict(),
  organizationPool: z.object({
    tokens: budget,
    estimatedMinutes: budget
  }).strict(),
  groups: z.array(GroupBudgetSchema).max(100),
  departments: z.array(DepartmentSchema).max(100)
}).strict().superRefine((settings, context) => {
  if (settings.status === 'active' && settings.groups.length === 0) {
    context.addIssue({ code: 'custom', path: ['groups'], message: 'An active organization budget requires at least one group' })
  }
  const groupCodes = settings.groups.map((group) => group.code)
  if (new Set(groupCodes).size !== groupCodes.length) {
    context.addIssue({ code: 'custom', path: ['groups'], message: 'Group codes must be unique' })
  }
  const departmentCodes = settings.departments.map((department) => department.code)
  if (new Set(departmentCodes).size !== departmentCodes.length) {
    context.addIssue({ code: 'custom', path: ['departments'], message: 'Department codes must be unique' })
  }
  const totals = {
    tokens: settings.groups.reduce((sum, group) => sum + group.tokenBudget, 0),
    estimatedMinutes: settings.groups.reduce((sum, group) => sum + group.estimatedMinuteBudget, 0)
  }
  if (totals.tokens > settings.organizationPool.tokens) {
    context.addIssue({ code: 'custom', path: ['groups'], message: 'Group token budgets cannot exceed the organization token pool' })
  }
  if (totals.estimatedMinutes > settings.organizationPool.estimatedMinutes) {
    context.addIssue({ code: 'custom', path: ['groups'], message: 'Group estimated-minute budgets cannot exceed the organization estimated-minute pool' })
  }
})

export type OrganizationAiTimeBudgetSettings = z.infer<typeof OrganizationAiTimeBudgetSettingsSchema>

export interface OrganizationAiTimeBudgetStore {
  getSettings(tenantId: string): Promise<OrganizationAiTimeBudgetSettings | null>
  getUsageSummary(tenantId: string, startAt: Date, endAt: Date): Promise<OrganizationAiTimeUsageSummary>
  getSubjectUsageSummary(tenantId: string, subjectId: string, startAt: Date, endAt: Date): Promise<OrganizationAiTimeUsageSummary>
  getSubjectUsageLedger?(tenantId: string, subjectId: string, limit: number): Promise<OrganizationAiUsageLedgerEntry[]>
  getMemberUsageSummary(tenantId: string, startAt: Date, endAt: Date): Promise<OrganizationAiMemberUsageSummary[]>
  getCompletedSessionRecords(tenantId: string, startAt: Date, endAt: Date): Promise<{
    records: OrganizationAiCompletionRecord[]
    hasMore: boolean
  }>
  getReservationSummary(tenantId: string, startAt: Date, endAt: Date): Promise<OrganizationAiReservationSummary>
  saveSettings(
    tenantId: string,
    changedBy: string,
    settings: OrganizationAiTimeBudgetSettings
  ): Promise<OrganizationAiTimeBudgetSettings | null | 'conflict' | 'assignments_exist' | 'allocation_below_usage' | 'period_locked'>
  listMemberAssignments(tenantId: string): Promise<OrganizationAiMemberAssignment[]>
  saveMemberAssignment(
    tenantId: string,
    changedBy: string,
    assignment: OrganizationAiMemberAssignmentInput
  ): Promise<OrganizationAiMemberAssignment | null | 'invalid' | 'conflict'>
  importMemberRosterInvitations?(
    tenantId: string,
    changedBy: string,
    invitations: OrganizationAiMemberRosterInvitation[]
  ): Promise<{ imported: number; alreadyAccepted: number } | 'invalid' | 'conflict'>
  claimPendingMemberRosterInvitations?(subjectId: string, email: string): Promise<void>
}

export function getProratedMonthlyDepartmentTokens(
  monthlyTokens: number | null | undefined,
  effectiveAt = new Date(),
  referenceDate = new Date()
): { periodStart: string; periodEnd: string; fraction: number; tokens: number | null } {
  const start = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), 1))
  const end = new Date(Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth() + 1, 1))
  const allocationStart = effectiveAt > start && effectiveAt < end ? effectiveAt : start
  const fraction = Math.max(0, Math.min(1, (end.getTime() - allocationStart.getTime()) / (end.getTime() - start.getTime())))
  return {
    periodStart: start.toISOString(),
    periodEnd: end.toISOString(),
    fraction,
    tokens: monthlyTokens == null ? null : Math.floor(monthlyTokens * fraction)
  }
}

export type OrganizationAiMemberAssignmentInput = z.infer<typeof OrganizationAiMemberAssignmentInputSchema>
export type OrganizationAiMemberRosterInvitation = z.infer<typeof OrganizationAiMemberRosterInvitationSchema>
export type OrganizationAiMemberAssignment = OrganizationAiMemberAssignmentInput & {
  role: 'learner' | 'instructor' | 'customer_admin'
  departmentAssignedAt?: string | null
}

export interface OrganizationAiUsageLedgerEntry {
  occurredAt: string
  sessionId: string
  provider: string
  operation: 'scenario_generation' | 'patient_turn'
  inputTokens: number
  outputTokens: number
  totalTokens: string
}

export interface OrganizationAiTimeUsageSummary {
  totalTokens: string
  responseCount: number
}

export interface OrganizationAiMemberUsageSummary {
  subjectId: string
  role: 'learner' | 'instructor' | 'customer_admin'
  sessionsStarted: number
  sessionsCompleted: number
  providerResponseCount: number
  totalTokens: string
  lastAiActivityAt: string | null
  estimatedEngagementSeconds: number
  lastEngagementAt: string | null
}

export interface OrganizationAiCompletionRecord {
  sessionId: string
  subjectId: string
  startedAt: string
  completedAt: string
  estimatedEngagementSeconds: number
}

export interface OrganizationAiReservationSummary {
  reservedTokens: string
  reservedCount: number
  heldTokens: string
  heldCount: number
}

function addUtcMonthsClamped(date: Date, months: number): Date {
  const targetMonth = date.getUTCMonth() + months
  const targetYear = date.getUTCFullYear() + Math.floor(targetMonth / 12)
  const normalizedMonth = ((targetMonth % 12) + 12) % 12
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate()
  return new Date(Date.UTC(
    targetYear,
    normalizedMonth,
    Math.min(date.getUTCDate(), lastDay)
  ))
}

export function getOrganizationAiTimePeriodBounds(
  anchorDate: string,
  periodMonths: number,
  referenceDate = new Date()
): { startAt: Date; endAt: Date } {
  const anchor = new Date(`${date.parse(anchorDate)}T00:00:00.000Z`)
  if (!Number.isInteger(periodMonths) || periodMonths < 1 || periodMonths > 12) {
    throw new Error('Organization AI-time period must be from 1 to 12 months')
  }
  const anchorMonth = anchor.getUTCFullYear() * 12 + anchor.getUTCMonth()
  const currentMonth = referenceDate.getUTCFullYear() * 12 + referenceDate.getUTCMonth()
  let index = Math.floor((currentMonth - anchorMonth) / periodMonths)
  let startAt = addUtcMonthsClamped(anchor, index * periodMonths)
  if (startAt > referenceDate) {
    index -= 1
    startAt = addUtcMonthsClamped(anchor, index * periodMonths)
  }
  const endAt = addUtcMonthsClamped(anchor, (index + 1) * periodMonths)
  return { startAt, endAt }
}

interface SettingsRow {
  revision: number
  settings: unknown
}

function parseSettingsRow(row: SettingsRow): OrganizationAiTimeBudgetSettings {
  if (!row.settings || typeof row.settings !== 'object' || Array.isArray(row.settings)) {
    throw new Error('Stored AI-time budget settings must be a JSON object')
  }
  return OrganizationAiTimeBudgetSettingsSchema.parse({
    ...(row.settings as Record<string, unknown>),
    revision: row.revision
  })
}

export function createPostgresOrganizationAiTimeBudgetStore(pool: Pool): OrganizationAiTimeBudgetStore {
  return {
    async getSettings(tenantId) {
      const result = await pool.query<SettingsRow>(
        `SELECT revision, settings
         FROM tenant_ai_time_budget_settings WHERE tenant_id = $1`,
        [tenantId]
      )
      const row = result.rows[0]
      return row ? parseSettingsRow(row) : null
    },

    async getUsageSummary(tenantId, startAt, endAt) {
      const result = await pool.query<{ total_tokens: string; response_count: string }>(
        `SELECT COALESCE(sum(total_tokens), 0)::text AS total_tokens,
                count(*)::text AS response_count
         FROM provider_usage
         WHERE tenant_id = $1 AND occurred_at >= $2 AND occurred_at < $3`,
        [tenantId, startAt, endAt]
      )
      const row = result.rows[0]
      return {
        totalTokens: row?.total_tokens ?? '0',
        responseCount: Number(row?.response_count ?? 0)
      }
    },

    async getSubjectUsageSummary(tenantId, subjectId, startAt, endAt) {
      const result = await pool.query<{ total_tokens: string; response_count: string }>(
        `SELECT COALESCE(sum(total_tokens), 0)::text AS total_tokens,
                count(*)::text AS response_count
         FROM provider_usage
         WHERE tenant_id = $1 AND subject_id = $2 AND occurred_at >= $3 AND occurred_at < $4`,
        [tenantId, subjectId, startAt, endAt]
      )
      const row = result.rows[0]
      return {
        totalTokens: row?.total_tokens ?? '0',
        responseCount: Number(row?.response_count ?? 0)
      }
    },

    async getSubjectUsageLedger(tenantId, subjectId, limit) {
      const result = await pool.query<{
        occurred_at: Date
        session_id: string
        provider: string
        operation: OrganizationAiUsageLedgerEntry['operation']
        input_tokens: number
        output_tokens: number
        total_tokens: string
      }>(
        `SELECT occurred_at, session_id, provider, operation,
                input_tokens, output_tokens, total_tokens::text AS total_tokens
         FROM provider_usage
         WHERE tenant_id = $1 AND subject_id = $2
         ORDER BY occurred_at DESC, usage_id DESC
         LIMIT $3`,
        [tenantId, subjectId, limit]
      )
      return result.rows.map((row) => ({
        occurredAt: row.occurred_at.toISOString(),
        sessionId: row.session_id,
        provider: row.provider,
        operation: row.operation,
        inputTokens: row.input_tokens,
        outputTokens: row.output_tokens,
        totalTokens: row.total_tokens
      }))
    },

    async getMemberUsageSummary(tenantId, startAt, endAt) {
      const result = await pool.query<{
        subject_id: string
        role: OrganizationAiMemberUsageSummary['role']
        sessions_started: string
        sessions_completed: string
        provider_response_count: string
        total_tokens: string
        last_ai_activity_at: Date | null
        estimated_engagement_seconds: string
        last_engagement_at: Date | null
      }>(
        `WITH sessions AS (
           SELECT tenant_id, subject_id, count(*)::text AS sessions_started,
                  count(*) FILTER (WHERE status = 'completed')::text AS sessions_completed
           FROM app_sessions
           WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
           GROUP BY tenant_id, subject_id
         ), usage AS (
           SELECT tenant_id, subject_id, count(*)::text AS provider_response_count,
                  COALESCE(sum(total_tokens), 0)::text AS total_tokens,
                  max(occurred_at) AS last_ai_activity_at
           FROM provider_usage
           WHERE tenant_id = $1 AND occurred_at >= $2 AND occurred_at < $3
           GROUP BY tenant_id, subject_id
         ), engagement AS (
           SELECT tenant_id, subject_id, sum(activity_seconds)::text AS estimated_engagement_seconds,
                  max(recorded_at) AS last_engagement_at
           FROM session_engagement_pulses
           WHERE tenant_id = $1 AND recorded_at >= $2 AND recorded_at < $3
           GROUP BY tenant_id, subject_id
         )
         SELECT membership.subject_id, membership.role,
                COALESCE(sessions.sessions_started, '0') AS sessions_started,
                COALESCE(sessions.sessions_completed, '0') AS sessions_completed,
                COALESCE(usage.provider_response_count, '0') AS provider_response_count,
                COALESCE(usage.total_tokens, '0') AS total_tokens,
                usage.last_ai_activity_at,
                COALESCE(engagement.estimated_engagement_seconds, '0') AS estimated_engagement_seconds,
                engagement.last_engagement_at
         FROM tenant_memberships AS membership
         LEFT JOIN sessions ON sessions.tenant_id = membership.tenant_id
                           AND sessions.subject_id = membership.subject_id
         LEFT JOIN usage ON usage.tenant_id = membership.tenant_id
                        AND usage.subject_id = membership.subject_id
         LEFT JOIN engagement ON engagement.tenant_id = membership.tenant_id
                             AND engagement.subject_id = membership.subject_id
         WHERE membership.tenant_id = $1 AND membership.status = 'active'
         ORDER BY membership.subject_id`,
        [tenantId, startAt, endAt]
      )
      return result.rows.map((row) => ({
        subjectId: row.subject_id,
        role: row.role,
        sessionsStarted: Number(row.sessions_started),
        sessionsCompleted: Number(row.sessions_completed),
        providerResponseCount: Number(row.provider_response_count),
        totalTokens: row.total_tokens,
        lastAiActivityAt: row.last_ai_activity_at?.toISOString() ?? null,
        estimatedEngagementSeconds: Number(row.estimated_engagement_seconds),
        lastEngagementAt: row.last_engagement_at?.toISOString() ?? null
      }))
    },

    async getCompletedSessionRecords(tenantId, startAt, endAt) {
      const result = await pool.query<{
        session_id: string
        subject_id: string
        started_at: Date
        completed_at: Date
        estimated_engagement_seconds: string
      }>(
        `SELECT session.session_id, session.subject_id, session.created_at AS started_at,
                outcome.occurred_at AS completed_at,
                COALESCE(activity.estimated_seconds, 0)::text AS estimated_engagement_seconds
         FROM app_sessions AS session
         JOIN session_outcomes AS outcome ON outcome.session_id = session.session_id
           AND outcome.outcome = 'completed'
         JOIN tenant_memberships AS membership ON membership.tenant_id = session.tenant_id
           AND membership.subject_id = session.subject_id
         LEFT JOIN LATERAL (
           SELECT sum(pulse.activity_seconds) AS estimated_seconds
           FROM session_engagement_pulses AS pulse
           WHERE pulse.session_id = session.session_id
             AND pulse.recorded_at >= session.created_at
             AND pulse.recorded_at <= outcome.occurred_at
         ) AS activity ON true
         WHERE session.tenant_id = $1 AND outcome.occurred_at >= $2 AND outcome.occurred_at < $3
         ORDER BY outcome.occurred_at DESC, session.session_id DESC
         LIMIT 501`,
        [tenantId, startAt, endAt]
      )
      return {
        records: result.rows.slice(0, 500).map((row) => ({
          sessionId: row.session_id,
          subjectId: row.subject_id,
          startedAt: row.started_at.toISOString(),
          completedAt: row.completed_at.toISOString(),
          estimatedEngagementSeconds: Number(row.estimated_engagement_seconds)
        })),
        hasMore: result.rows.length > 500
      }
    },

    async getReservationSummary(tenantId, startAt, endAt) {
      const result = await pool.query<{
        reserved_tokens: string
        reserved_count: string
        held_tokens: string
        held_count: string
      }>(
        `SELECT
           COALESCE(sum(input_tokens::bigint + output_token_cap::bigint)
             FILTER (WHERE status = 'reserved'), 0)::text AS reserved_tokens,
           count(*) FILTER (WHERE status = 'reserved')::text AS reserved_count,
           COALESCE(sum(input_tokens::bigint + output_token_cap::bigint)
             FILTER (WHERE status = 'held'), 0)::text AS held_tokens,
           count(*) FILTER (WHERE status = 'held')::text AS held_count
         FROM provider_token_reservations
         WHERE tenant_id = $1 AND created_at >= $2 AND created_at < $3
           AND status IN ('reserved', 'held')`,
        [tenantId, startAt, endAt]
      )
      const row = result.rows[0]
      return {
        reservedTokens: row?.reserved_tokens ?? '0',
        reservedCount: Number(row?.reserved_count ?? 0),
        heldTokens: row?.held_tokens ?? '0',
        heldCount: Number(row?.held_count ?? 0)
      }
    },

    async saveSettings(tenantId, changedBy, settings) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const tenant = await client.query(
          'SELECT tenant_id FROM tenants WHERE tenant_id = $1 FOR UPDATE',
          [tenantId]
        )
        if (tenant.rowCount !== 1) {
          await client.query('ROLLBACK')
          return null
        }
        const current = await client.query<SettingsRow>(
          `SELECT revision, settings
           FROM tenant_ai_time_budget_settings WHERE tenant_id = $1 FOR UPDATE`,
          [tenantId]
        )
        const before = current.rows[0] ? parseSettingsRow(current.rows[0]) : null
        if (settings.revision !== (before?.revision ?? 0)) {
          await client.query('ROLLBACK')
          return 'conflict'
        }
        const next = OrganizationAiTimeBudgetSettingsSchema.parse({
          ...settings,
          revision: (before?.revision ?? 0) + 1
        })
        const assignedCodes = await client.query<{ group_code: string }>(
          `SELECT DISTINCT group_code FROM tenant_member_ai_group_assignments
           WHERE tenant_id = $1`,
          [tenantId]
        )
        if (assignedCodes.rows.some(({ group_code }) => !next.groups.some((group) => group.code === group_code))) {
          await client.query('ROLLBACK')
          return 'assignments_exist'
        }
        const assignedDepartments = await client.query<{ department_code: string }>(
          `SELECT DISTINCT department_code FROM tenant_member_ai_department_assignments
           WHERE tenant_id = $1`,
          [tenantId]
        )
        if (assignedDepartments.rows.some(({ department_code }) =>
          !next.departments.some((department) => department.code === department_code))) {
          await client.query('ROLLBACK')
          return 'assignments_exist'
        }
        const periodChanged = before && (
          before.organizationPeriod.months !== next.organizationPeriod.months ||
          before.organizationPeriod.anchorDate !== next.organizationPeriod.anchorDate
        )
        if (periodChanged) {
          const now = new Date()
          const activePeriodGraceEnd = before.status === 'active'
            ? getOrganizationAiTimePeriodBounds(
              before.organizationPeriod.anchorDate, before.organizationPeriod.months, now
            ).endAt.getTime() + 45 * 24 * 60 * 60 * 1000
            : 0
          const hasActivePeriodCredit = before.status === 'active' && now.getTime() < activePeriodGraceEnd
          const unexpiredGrants = hasActivePeriodCredit ? null : await client.query(
            `SELECT 1 FROM gptmd_token_entitlement_grants
             WHERE account_scope = 'organization' AND tenant_id = $1
               AND bucket_kind = 'included' AND expires_at > $2
             LIMIT 1`,
            [tenantId, now]
          )
          if (hasActivePeriodCredit || unexpiredGrants?.rowCount) {
            await client.query('ROLLBACK')
            return 'period_locked'
          }
        }
        const period = next.status === 'active'
          ? getOrganizationAiTimePeriodBounds(
            next.organizationPeriod.anchorDate, next.organizationPeriod.months
          )
          : null
        if (period) {
          const currentGroupCodes = new Set([
            ...(before?.groups.map(({ code }) => code) ?? []),
            ...next.groups.map(({ code }) => code)
          ])
          for (const groupCode of currentGroupCodes) {
            const group = next.groups.find((entry) => entry.code === groupCode)
            const reconciled = await reconcileOrganizationGroupAllocation(client, {
              tenantId,
              groupCode,
              periodStart: period.startAt,
              periodEnd: period.endAt,
              tokenBudget: group?.tokenBudget ?? 0,
              settingsRevision: next.revision,
              grantedBy: changedBy
            })
            if (!reconciled) {
              await client.query('ROLLBACK')
              return 'allocation_below_usage'
            }
          }
        }
        const updated = await client.query<SettingsRow>(
          `INSERT INTO tenant_ai_time_budget_settings (
             tenant_id, revision, settings, changed_by
           ) VALUES ($1, $2, $3::jsonb, $4)
           ON CONFLICT (tenant_id) DO UPDATE SET
             revision = EXCLUDED.revision,
             settings = EXCLUDED.settings,
             changed_by = EXCLUDED.changed_by,
             changed_at = now()
           RETURNING revision, settings`,
          [tenantId, next.revision, JSON.stringify({
            schemaVersion: next.schemaVersion,
            status: next.status,
            organizationPeriod: next.organizationPeriod,
            organizationPool: next.organizationPool,
            groups: next.groups,
            departments: next.departments
          }), changedBy]
        )
        await client.query(
          `INSERT INTO tenant_ai_time_budget_audit (
             tenant_id, changed_by, before_settings, after_settings
           ) VALUES ($1, $2, $3::jsonb, $4::jsonb)`,
          [tenantId, changedBy, before ? JSON.stringify(before) : null, JSON.stringify(next)]
        )
        await client.query('COMMIT')
        const row = updated.rows[0]
        if (!row) throw new Error('AI-time budget settings upsert did not return a row')
        return parseSettingsRow(row)
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },

    async listMemberAssignments(tenantId) {
      const result = await pool.query<{
        subject_id: string
        role: OrganizationAiMemberAssignment['role']
        group_codes: string[] | null
        department_code: string | null
        department_assigned_at: Date | null
      }>(
        `SELECT m.subject_id, m.role,
                COALESCE(groups.group_codes, ARRAY[]::text[]) AS group_codes,
                departments.department_code, departments.assigned_at AS department_assigned_at
         FROM tenant_memberships m
         LEFT JOIN LATERAL (
           SELECT array_agg(a.group_code ORDER BY a.group_code) AS group_codes
           FROM tenant_member_ai_group_assignments a
           WHERE a.tenant_id = m.tenant_id AND a.subject_id = m.subject_id
         ) groups ON true
         LEFT JOIN tenant_member_ai_department_assignments departments
           ON departments.tenant_id = m.tenant_id AND departments.subject_id = m.subject_id
         WHERE m.tenant_id = $1 AND m.status = 'active'
         ORDER BY m.subject_id`,
        [tenantId]
      )
      return result.rows.map((row) => ({
        subjectId: row.subject_id,
        role: row.role,
        groupCodes: row.group_codes ?? [],
        departmentCode: row.department_code,
        departmentAssignedAt: row.department_assigned_at?.toISOString() ?? null
      }))
    },

    async saveMemberAssignment(tenantId, changedBy, assignment) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const tenant = await client.query(
          'SELECT tenant_id FROM tenants WHERE tenant_id = $1 FOR UPDATE',
          [tenantId]
        )
        if (tenant.rowCount !== 1) {
          await client.query('ROLLBACK')
          return null
        }
        const member = await client.query<{ role: OrganizationAiMemberAssignment['role'] }>(
          `SELECT role FROM tenant_memberships
           WHERE tenant_id = $1 AND subject_id = $2 AND status = 'active'
           FOR UPDATE`,
          [tenantId, assignment.subjectId]
        )
        const memberRow = member.rows[0]
        if (!memberRow) {
          await client.query('ROLLBACK')
          return null
        }
        const current = await client.query<SettingsRow>(
          `SELECT revision, settings FROM tenant_ai_time_budget_settings
           WHERE tenant_id = $1 FOR UPDATE`,
          [tenantId]
        )
        const currentSettings = current.rows[0] ? parseSettingsRow(current.rows[0]) : null
        if (!currentSettings) {
          await client.query('ROLLBACK')
          return 'conflict'
        }
        if (assignment.groupCodes.some((code) => !currentSettings.groups.some((group) => group.code === code)) ||
            (assignment.departmentCode !== null &&
              !currentSettings.departments.some((department) => department.code === assignment.departmentCode))) {
          await client.query('ROLLBACK')
          return 'invalid'
        }
        const beforeGroups = await client.query<{ group_code: string }>(
          `SELECT group_code FROM tenant_member_ai_group_assignments
           WHERE tenant_id = $1 AND subject_id = $2 ORDER BY group_code`,
          [tenantId, assignment.subjectId]
        )
        const beforeDepartment = await client.query<{ department_code: string }>(
          `SELECT department_code FROM tenant_member_ai_department_assignments
           WHERE tenant_id = $1 AND subject_id = $2`,
          [tenantId, assignment.subjectId]
        )
        await client.query(
          `DELETE FROM tenant_member_ai_group_assignments
           WHERE tenant_id = $1 AND subject_id = $2`,
          [tenantId, assignment.subjectId]
        )
        for (const groupCode of assignment.groupCodes) {
          await client.query(
            `INSERT INTO tenant_member_ai_group_assignments
               (tenant_id, subject_id, group_code, assigned_by)
             VALUES ($1, $2, $3, $4)`,
            [tenantId, assignment.subjectId, groupCode, changedBy]
          )
        }
        if (assignment.departmentCode === null) {
          await client.query(
            `DELETE FROM tenant_member_ai_department_assignments
             WHERE tenant_id = $1 AND subject_id = $2`,
            [tenantId, assignment.subjectId]
          )
        } else {
          await client.query(
            `INSERT INTO tenant_member_ai_department_assignments
               (tenant_id, subject_id, department_code, assigned_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (tenant_id, subject_id) DO UPDATE SET
               department_code = EXCLUDED.department_code,
               assigned_by = EXCLUDED.assigned_by,
               assigned_at = CASE
                 WHEN tenant_member_ai_department_assignments.department_code IS DISTINCT FROM EXCLUDED.department_code
                   THEN now()
                 ELSE tenant_member_ai_department_assignments.assigned_at
               END`,
            [tenantId, assignment.subjectId, assignment.departmentCode, changedBy]
          )
        }
        await client.query(
          `INSERT INTO tenant_member_ai_assignment_audit (
             tenant_id, subject_id, changed_by, before_groups, after_groups,
             before_department, after_department
           ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [tenantId, assignment.subjectId, changedBy,
            beforeGroups.rows.map((row) => row.group_code), [...assignment.groupCodes].sort(),
            beforeDepartment.rows[0]?.department_code ?? null, assignment.departmentCode]
        )
        const savedDepartment = await client.query<{ department_assigned_at: Date | null }>(
          `SELECT assigned_at AS department_assigned_at FROM tenant_member_ai_department_assignments
           WHERE tenant_id = $1 AND subject_id = $2`,
          [tenantId, assignment.subjectId]
        )
        await client.query('COMMIT')
        return {
          ...assignment,
          groupCodes: [...assignment.groupCodes].sort(),
          role: memberRow.role,
          departmentAssignedAt: savedDepartment.rows[0]?.department_assigned_at?.toISOString() ?? null
        }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },

    async importMemberRosterInvitations(tenantId, changedBy, invitations) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const tenant = await client.query(
          'SELECT tenant_id FROM tenants WHERE tenant_id = $1 FOR UPDATE', [tenantId]
        )
        if (tenant.rowCount !== 1) {
          await client.query('ROLLBACK')
          return 'conflict'
        }
        const settingsResult = await client.query<SettingsRow>(
          `SELECT revision, settings FROM tenant_ai_time_budget_settings
           WHERE tenant_id = $1 FOR UPDATE`, [tenantId]
        )
        const settings = settingsResult.rows[0] ? parseSettingsRow(settingsResult.rows[0]) : null
        if (!settings) {
          await client.query('ROLLBACK')
          return 'conflict'
        }
        if (invitations.some((invitation) =>
          invitation.groupCodes.some((code) => !settings.groups.some((group) => group.code === code)) ||
          (invitation.departmentCode !== null &&
            !settings.departments.some((department) => department.code === invitation.departmentCode)))) {
          await client.query('ROLLBACK')
          return 'invalid'
        }

        let imported = 0
        let alreadyAccepted = 0
        for (const invitation of invitations) {
          const previous = await client.query<{
            status: 'pending' | 'accepted'
            group_codes: string[]
            department_code: string | null
          }>(
            `SELECT status, group_codes, department_code
             FROM tenant_member_roster_invitations
             WHERE tenant_id = $1 AND email = $2 FOR UPDATE`,
            [tenantId, invitation.email]
          )
          if (previous.rows[0]?.status === 'accepted') {
            alreadyAccepted += 1
            continue
          }
          await client.query(
            `INSERT INTO tenant_member_roster_invitations
               (tenant_id, email, group_codes, department_code, assigned_by)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (tenant_id, email) DO UPDATE SET
               group_codes = EXCLUDED.group_codes,
               department_code = EXCLUDED.department_code,
               assigned_by = EXCLUDED.assigned_by,
               updated_at = now()
             WHERE tenant_member_roster_invitations.status = 'pending'`,
            [tenantId, invitation.email, [...invitation.groupCodes].sort(), invitation.departmentCode, changedBy]
          )
          await client.query(
            `INSERT INTO tenant_member_roster_invitation_audit (
               tenant_id, email, changed_by, action, before_group_codes, after_group_codes,
               before_department_code, after_department_code
             ) VALUES ($1, $2, $3, 'roster_imported', $4, $5, $6, $7)`,
            [tenantId, invitation.email, changedBy,
              previous.rows[0]?.group_codes ?? [], [...invitation.groupCodes].sort(),
              previous.rows[0]?.department_code ?? null, invitation.departmentCode]
          )
          imported += 1
        }
        await client.query('COMMIT')
        return { imported, alreadyAccepted }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },

    async claimPendingMemberRosterInvitations(subjectId, email) {
      const normalizedEmail = email.trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 254) return
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const pendingTenants = await client.query<{ tenant_id: string }>(
          `SELECT DISTINCT tenant_id
           FROM tenant_member_roster_invitations
           WHERE email = $1 AND status = 'pending'
           ORDER BY tenant_id`,
          [normalizedEmail]
        )
        for (const pendingTenant of pendingTenants.rows) {
          const tenantId = pendingTenant.tenant_id
          const tenant = await client.query(
            'SELECT tenant_id FROM tenants WHERE tenant_id = $1 FOR UPDATE', [tenantId]
          )
          if (tenant.rowCount !== 1) continue
          const invitations = await client.query<{
            tenant_id: string
          email: string
          group_codes: string[]
          department_code: string | null
          assigned_by: string
          }>(
            `SELECT tenant_id, email, group_codes, department_code, assigned_by
             FROM tenant_member_roster_invitations
             WHERE tenant_id = $1 AND email = $2 AND status = 'pending'
             FOR UPDATE`,
            [tenantId, normalizedEmail]
          )
          const invitation = invitations.rows[0]
          if (!invitation) continue
          const settingsResult = await client.query<SettingsRow>(
            `SELECT revision, settings FROM tenant_ai_time_budget_settings
             WHERE tenant_id = $1 FOR UPDATE`, [invitation.tenant_id]
          )
          const settings = settingsResult.rows[0] ? parseSettingsRow(settingsResult.rows[0]) : null
          if (!settings || invitation.group_codes.some((code) => !settings.groups.some((group) => group.code === code)) ||
              (invitation.department_code !== null &&
                !settings.departments.some((department) => department.code === invitation.department_code))) {
            throw new Error('Pending roster invitation references unavailable organization settings')
          }
          const membership = await client.query<{ role: string; status: string }>(
            `SELECT role, status FROM tenant_memberships
             WHERE tenant_id = $1 AND subject_id = $2 FOR UPDATE`,
            [invitation.tenant_id, subjectId]
          )
          if (membership.rows[0] && membership.rows[0].role !== 'learner') continue
          await client.query(
            `INSERT INTO tenant_memberships (tenant_id, subject_id, status, role)
             VALUES ($1, $2, 'active', 'learner')
             ON CONFLICT (tenant_id, subject_id) DO UPDATE SET status = 'active'`,
            [invitation.tenant_id, subjectId]
          )
          const beforeGroups = await client.query<{ group_code: string }>(
            `SELECT group_code FROM tenant_member_ai_group_assignments
             WHERE tenant_id = $1 AND subject_id = $2 ORDER BY group_code`,
            [invitation.tenant_id, subjectId]
          )
          const beforeDepartment = await client.query<{ department_code: string }>(
            `SELECT department_code FROM tenant_member_ai_department_assignments
             WHERE tenant_id = $1 AND subject_id = $2`,
            [invitation.tenant_id, subjectId]
          )
          await client.query(
            `DELETE FROM tenant_member_ai_group_assignments
             WHERE tenant_id = $1 AND subject_id = $2`, [invitation.tenant_id, subjectId]
          )
          for (const groupCode of invitation.group_codes) {
            await client.query(
              `INSERT INTO tenant_member_ai_group_assignments
                 (tenant_id, subject_id, group_code, assigned_by)
               VALUES ($1, $2, $3, $4)`,
              [invitation.tenant_id, subjectId, groupCode, invitation.assigned_by]
            )
          }
          if (invitation.department_code === null) {
            await client.query(
              `DELETE FROM tenant_member_ai_department_assignments
               WHERE tenant_id = $1 AND subject_id = $2`, [invitation.tenant_id, subjectId]
            )
          } else {
            await client.query(
              `INSERT INTO tenant_member_ai_department_assignments
                 (tenant_id, subject_id, department_code, assigned_by)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (tenant_id, subject_id) DO UPDATE SET
                 department_code = EXCLUDED.department_code,
                 assigned_by = EXCLUDED.assigned_by,
                 assigned_at = CASE
                   WHEN tenant_member_ai_department_assignments.department_code IS DISTINCT FROM EXCLUDED.department_code
                     THEN now()
                   ELSE tenant_member_ai_department_assignments.assigned_at
                 END`,
              [invitation.tenant_id, subjectId, invitation.department_code, invitation.assigned_by]
            )
          }
          await client.query(
            `INSERT INTO tenant_member_ai_assignment_audit (
               tenant_id, subject_id, changed_by, before_groups, after_groups,
               before_department, after_department
             ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [invitation.tenant_id, subjectId, invitation.assigned_by,
              beforeGroups.rows.map((row) => row.group_code), invitation.group_codes,
              beforeDepartment.rows[0]?.department_code ?? null, invitation.department_code]
          )
          await client.query(
            `UPDATE tenant_member_roster_invitations
             SET status = 'accepted', accepted_subject_id = $3, accepted_at = now(), updated_at = now()
             WHERE tenant_id = $1 AND email = $2 AND status = 'pending'`,
            [invitation.tenant_id, invitation.email, subjectId]
          )
          await client.query(
            `INSERT INTO tenant_member_roster_invitation_audit (
               tenant_id, email, changed_by, action, subject_id, before_group_codes, after_group_codes,
               before_department_code, after_department_code
             ) VALUES ($1, $2, $3, 'membership_claimed', $4, $5, $6, $7, $8)`,
            [invitation.tenant_id, invitation.email, invitation.assigned_by, subjectId,
              beforeGroups.rows.map((row) => row.group_code), invitation.group_codes,
              beforeDepartment.rows[0]?.department_code ?? null, invitation.department_code]
          )
        }
        await client.query('COMMIT')
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    }
  }
}
