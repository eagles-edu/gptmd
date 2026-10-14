import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { parse } from 'dotenv'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(new URL('../services/api/package.json', import.meta.url))
const { Client } = require('pg')
const liveApiEnv = '/home/eaglesvn/.config/gptmd-live/api.env'
const testTenant = 'gptmd-entitlement-test-scsstx'
const migrationNames = ['024_session_archive_jobs.sql', '025_tenant_entitlement_audit.sql']
const subjectPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function resolveTestSubject() {
  const output = execFileSync('docker', [
    'exec', 'supabase-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c',
    "SELECT id::text FROM auth.users WHERE lower(email) = lower('scsstx@gmail.com') AND deleted_at IS NULL"
  ], { encoding: 'utf8' })
  const subjects = output.trim().split(/\r?\n/).filter(Boolean)
  if (subjects.length !== 1 || !subjectPattern.test(subjects[0] ?? '')) {
    throw new Error(subjects.length === 0
      ? 'No active Supabase Auth user found for scsstx@gmail.com. Complete Google sign-in first.'
      : 'Expected exactly one valid Supabase Auth subject for scsstx@gmail.com; refusing to seed.')
  }
  return subjects[0]
}

async function provision() {
  const env = parse(await readFile(liveApiEnv, 'utf8'))
  if (!env.DATABASE_URL) throw new Error('Live API DATABASE_URL is missing.')

  const database = new Client({ connectionString: env.DATABASE_URL })
  await database.connect()
  try {
    const identity = await database.query(`
      SELECT current_database() AS database_name,
             current_user AS database_role,
             ARRAY(
               SELECT filename FROM gptmd_schema_migrations
               WHERE filename = ANY($1::text[])
             ) AS migrations,
             EXISTS (SELECT 1 FROM tenants WHERE tenant_id = $2) AS tenant_exists
    `, [migrationNames, testTenant])
    const target = identity.rows[0]
    if (target?.database_name !== 'gptmd_live' || target.database_role !== 'gptmd_live_app') {
      throw new Error('Live database identity did not match gptmd_live / gptmd_live_app; refusing to seed.')
    }
    if (migrationNames.some((name) => !target.migrations.includes(name))) {
      throw new Error('Migrations 024/025 are not both recorded in gptmd_live; refusing to seed.')
    }
    if (target.tenant_exists) {
      throw new Error('The isolated test tenant already exists; inspect it instead of rerunning provisioning.')
    }

    const subjectId = resolveTestSubject()
    let sql = await readFile(`${root}/ops/sql/provision-scsstx-entitlement-test.sql`, 'utf8')
    const psqlVariable = `:${String.fromCharCode(39)}test_subject_id${String.fromCharCode(39)}`
    if (!sql.includes(psqlVariable)) throw new Error('Seed is missing the validated test_subject_id variable.')
    sql = sql.replace(psqlVariable, `'${subjectId}'`)
    await database.query(sql)

    const result = await database.query(`
      SELECT m.role, m.status, e.sessions_enabled, e.responses_enabled,
             e.audio_transcription_enabled, e.audio_transcription_privacy_approved,
             e.monthly_session_quota, e.monthly_session_quota_per_user,
             e.monthly_response_quota, e.monthly_response_quota_per_user,
             e.response_quota_per_session, e.max_active_sessions,
             e.monthly_audio_transcription_session_quota
      FROM tenant_memberships m
      JOIN tenant_entitlements e USING (tenant_id)
      WHERE m.tenant_id = $1 AND m.subject_id = $2
    `, [testTenant, subjectId])
    const policy = result.rows[0]
    if (!policy || policy.role !== 'customer_admin' || policy.status !== 'active' ||
        policy.sessions_enabled || policy.responses_enabled || policy.audio_transcription_enabled ||
        policy.audio_transcription_privacy_approved || policy.monthly_session_quota !== 5 ||
        policy.monthly_session_quota_per_user !== 5 || policy.monthly_response_quota !== 50 ||
        policy.monthly_response_quota_per_user !== 50 || policy.response_quota_per_session !== 12 ||
        policy.max_active_sessions !== 1 || policy.monthly_audio_transcription_session_quota !== 0) {
      throw new Error('Post-seed verification failed; inspect the isolated test tenant before use.')
    }
    process.stdout.write('Provisioned the isolated test tenant with all capabilities disabled and bounded quotas.\n')
  } finally {
    await database.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  provision().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
