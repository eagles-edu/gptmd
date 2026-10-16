import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { parse } from 'dotenv'
import { pathToFileURL } from 'node:url'

const require = createRequire(new URL('../services/api/package.json', import.meta.url))
const { Client } = require('pg')
const liveApiEnv = '/home/eaglesvn/.config/gptmd-live/api.env'
const adminTenant = 'gptmd-entitlement-test-onlineadmin'
const learnerTenant = 'gptmd-learner-test-scsstx'
const migrationNames = [
  '024_session_archive_jobs.sql', '025_tenant_entitlement_audit.sql',
  '027_organization_ai_time_budgets.sql', '029_ai_budget_group_assignments.sql',
  '030_provider_token_reservations.sql', '031_ai_budget_enforcement.sql'
]
const subjectPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function resolveTestSubject(email) {
  const output = execFileSync('docker', [
    'exec', 'supabase-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c',
    `SELECT id::text FROM auth.users WHERE lower(email) = lower('${email}') AND deleted_at IS NULL`
  ], { encoding: 'utf8' })
  const subjects = output.trim().split(/\r?\n/).filter(Boolean)
  if (subjects.length !== 1 || !subjectPattern.test(subjects[0] ?? '')) {
    throw new Error(subjects.length === 0
      ? `No active Supabase Auth user found for ${email}; complete Google sign-in first.`
      : `Expected exactly one valid Supabase Auth subject for ${email}; refusing to provision.`)
  }
  return subjects[0]
}

function hasPolicy(policy, expected) {
  return policy && Object.entries(expected).every(([key, value]) => policy[key] === value)
}

export async function provisionBudgetTestMembership(database, adminSubjectId, learnerSubjectId) {
  await database.query('BEGIN')
  try {
    const identity = await database.query(`
      SELECT current_database() AS database_name, current_user AS database_role,
             ARRAY(SELECT filename FROM gptmd_schema_migrations
                   WHERE filename = ANY($1::text[])) AS migrations
    `, [migrationNames])
    const target = identity.rows[0]
    if (target?.database_name !== 'gptmd_live' || target.database_role !== 'gptmd_live_app') {
      throw new Error('Live database identity did not match gptmd_live / gptmd_live_app; refusing to provision.')
    }
    if (migrationNames.some((name) => !target.migrations.includes(name))) {
      throw new Error('Required entitlement and AI-budget migrations are missing; refusing to provision.')
    }

    const lockedTenant = await database.query(
      'SELECT tenant_id FROM tenants WHERE tenant_id = $1 FOR UPDATE', [adminTenant]
    )
    if (lockedTenant.rowCount !== 1) throw new Error('The onlineadmin AI-budget test workspace is missing.')

    const admin = await database.query(
      `SELECT role, status FROM tenant_memberships WHERE tenant_id = $1 AND subject_id = $2`,
      [adminTenant, adminSubjectId]
    )
    if (admin.rowCount !== 1 || admin.rows[0]?.role !== 'customer_admin' || admin.rows[0]?.status !== 'active') {
      throw new Error('The expected active onlineadmin customer-admin membership is missing.')
    }

    const disabledPolicy = {
      sessions_enabled: false, responses_enabled: false,
      audio_transcription_enabled: false, audio_transcription_privacy_approved: false,
      monthly_session_quota: 5, monthly_session_quota_per_user: 5,
      monthly_response_quota: 50, monthly_response_quota_per_user: 50,
      response_quota_per_session: 12, max_active_sessions: 1,
      monthly_audio_transcription_session_quota: 0
    }
    const targetPolicy = await database.query(
      `SELECT sessions_enabled, responses_enabled, audio_transcription_enabled,
              audio_transcription_privacy_approved, monthly_session_quota,
              monthly_session_quota_per_user, monthly_response_quota,
              monthly_response_quota_per_user, response_quota_per_session,
              max_active_sessions, monthly_audio_transcription_session_quota
       FROM tenant_entitlements WHERE tenant_id = $1 FOR UPDATE`,
      [adminTenant]
    )
    if (targetPolicy.rowCount !== 1 || !hasPolicy(targetPolicy.rows[0], disabledPolicy)) {
      throw new Error('The onlineadmin workspace no longer has its guarded all-off baseline policy.')
    }

    const budgetData = await database.query(`
      SELECT
        (SELECT count(*)::int FROM tenant_ai_time_budget_settings WHERE tenant_id = $1) AS settings,
        (SELECT count(*)::int FROM tenant_member_ai_group_assignments WHERE tenant_id = $1) AS groups,
        (SELECT count(*)::int FROM tenant_member_ai_department_assignments WHERE tenant_id = $1) AS departments,
        (SELECT count(*)::int FROM provider_token_reservations WHERE tenant_id = $1) AS reservations
    `, [adminTenant])
    if (!budgetData.rows[0] || Object.values(budgetData.rows[0]).some((count) => count !== 0)) {
      throw new Error('The onlineadmin workspace already contains AI-budget data; inspect it instead of adding a learner.')
    }

    const existing = await database.query(
      'SELECT role, status FROM tenant_memberships WHERE tenant_id = $1 AND subject_id = $2',
      [adminTenant, learnerSubjectId]
    )
    if (existing.rowCount !== 0) {
      throw new Error('The scsstx membership already exists in the onlineadmin test workspace; inspect it manually.')
    }

    const learner = await database.query(
      `SELECT m.role, m.status, e.sessions_enabled, e.responses_enabled,
              e.audio_transcription_enabled, e.audio_transcription_privacy_approved,
              e.monthly_session_quota, e.monthly_session_quota_per_user,
              e.monthly_response_quota, e.monthly_response_quota_per_user,
              e.response_quota_per_session, e.max_active_sessions,
              e.monthly_audio_transcription_session_quota
       FROM tenant_memberships m JOIN tenant_entitlements e USING (tenant_id)
       WHERE m.tenant_id = $1 AND m.subject_id = $2`,
      [learnerTenant, learnerSubjectId]
    )
    const learnerPolicy = learner.rows[0]
    if (learner.rowCount !== 1 || learnerPolicy?.role !== 'learner' || learnerPolicy.status !== 'active' ||
        !hasPolicy(learnerPolicy, {
          sessions_enabled: true, responses_enabled: true,
          audio_transcription_enabled: false, audio_transcription_privacy_approved: false,
          monthly_session_quota: 5, monthly_session_quota_per_user: 5,
          monthly_response_quota: 50, monthly_response_quota_per_user: 50,
          response_quota_per_session: 12, max_active_sessions: 1,
          monthly_audio_transcription_session_quota: 0
        })) {
      throw new Error('The existing scsstx learner workspace is not in the approved bounded text-only state.')
    }

    const inserted = await database.query(
      `INSERT INTO tenant_memberships (tenant_id, subject_id, status, role)
       VALUES ($1, $2, 'active', 'learner') RETURNING role, status`,
      [adminTenant, learnerSubjectId]
    )
    if (inserted.rowCount !== 1 || inserted.rows[0]?.role !== 'learner' || inserted.rows[0]?.status !== 'active') {
      throw new Error('The test learner membership could not be verified.')
    }
    await database.query('COMMIT')
  } catch (error) {
    await database.query('ROLLBACK').catch(() => undefined)
    throw error
  }
}

async function main() {
  const env = parse(await readFile(liveApiEnv, 'utf8'))
  if (!env.DATABASE_URL) throw new Error('Live API DATABASE_URL is missing.')
  const adminSubjectId = resolveTestSubject('onlineadmin@eaglesvn.online')
  const learnerSubjectId = resolveTestSubject('scsstx@gmail.com')
  const database = new Client({ connectionString: env.DATABASE_URL })
  await database.connect()
  try {
    await provisionBudgetTestMembership(database, adminSubjectId, learnerSubjectId)
  } finally {
    await database.end()
  }
  process.stdout.write('Added scsstx as a learner in onlineadmin test workspace. All tenant features remain disabled until the customer admin configures them.\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
