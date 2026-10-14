import type { Pool } from 'pg'
import { z } from 'zod'

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

export const OrganizationAiTimeBudgetSettingsSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  status: z.literal('draft'),
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
  saveSettings(
    tenantId: string,
    changedBy: string,
    settings: OrganizationAiTimeBudgetSettings
  ): Promise<OrganizationAiTimeBudgetSettings | null | 'conflict' | 'assignments_exist'>
  listMemberAssignments(tenantId: string): Promise<OrganizationAiMemberAssignment[]>
  saveMemberAssignment(
    tenantId: string,
    changedBy: string,
    assignment: OrganizationAiMemberAssignmentInput
  ): Promise<OrganizationAiMemberAssignment | null | 'invalid' | 'conflict'>
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
export type OrganizationAiMemberAssignment = OrganizationAiMemberAssignmentInput & {
  role: 'learner' | 'instructor' | 'customer_admin'
  departmentAssignedAt?: string | null
}

export interface OrganizationAiTimeUsageSummary {
  totalTokens: string
  responseCount: number
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
    }
  }
}
