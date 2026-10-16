import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { parse } from 'dotenv'
import { pathToFileURL } from 'node:url'

const require = createRequire(new URL('../services/api/package.json', import.meta.url))
const { Client } = require('pg')
const liveApiEnv = '/home/eaglesvn/.config/gptmd-live/api.env'
const tenantId = 'vinmed-hospital-demo'
const email = 'ayeyamsam@gmail.com'
const logoPath = '/assets/images/vinmed-logo.svg'
const requiredMigrations = ['006_tenant_membership_roles.sql', '040_tenant_branding.sql']
const subjectPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function resolveSubject() {
  const output = execFileSync('docker', [
    'exec', 'supabase-db', 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-c',
    `SELECT id::text FROM auth.users WHERE lower(email) = lower('${email}') AND deleted_at IS NULL`
  ], { encoding: 'utf8' })
  const subjects = output.trim().split(/\r?\n/).filter(Boolean)
  if (subjects.length !== 1 || !subjectPattern.test(subjects[0] ?? '')) {
    throw new Error(subjects.length === 0
      ? `No active Google/Supabase identity found for ${email}; complete sign-in first.`
      : `Expected exactly one active Supabase identity for ${email}; refusing to provision.`)
  }
  return subjects[0]
}

export async function provisionVinmedAdmin(database, subjectId) {
  await database.query('BEGIN')
  try {
    const identity = await database.query(`
      SELECT current_database() AS database_name, current_user AS database_role,
             ARRAY(SELECT filename FROM gptmd_schema_migrations WHERE filename = ANY($1::text[])) AS migrations,
             EXISTS (SELECT 1 FROM tenants WHERE tenant_id = $2) AS tenant_exists
    `, [requiredMigrations, tenantId])
    const target = identity.rows[0]
    if (target?.database_name !== 'gptmd_live' || target.database_role !== 'gptmd_live_app') {
      throw new Error('Database identity did not match gptmd_live / gptmd_live_app; refusing to provision.')
    }
    if (requiredMigrations.some((name) => !target.migrations.includes(name))) {
      throw new Error('Tenant-role or branding migration is missing; deploy the application migration first.')
    }
    if (target.tenant_exists) {
      throw new Error('VinMed demo tenant already exists; inspect it rather than changing existing membership or branding.')
    }

    await database.query('INSERT INTO tenants (tenant_id) VALUES ($1)', [tenantId])
    await database.query(
      `INSERT INTO tenant_memberships (tenant_id, subject_id, status, role)
       VALUES ($1, $2, 'active', 'customer_admin')`, [tenantId, subjectId]
    )
    await database.query('INSERT INTO tenant_entitlements (tenant_id) VALUES ($1)', [tenantId])
    await database.query(
      `INSERT INTO tenant_branding (tenant_id, display_name, logo_path)
       VALUES ($1, 'VinMed Hospital', $2)`, [tenantId, logoPath]
    )

    const verified = await database.query(`
      SELECT m.role, m.status, e.sessions_enabled, e.responses_enabled,
             b.display_name, b.logo_path
      FROM tenant_memberships m
      JOIN tenant_entitlements e USING (tenant_id)
      JOIN tenant_branding b USING (tenant_id)
      WHERE m.tenant_id = $1 AND m.subject_id = $2
    `, [tenantId, subjectId])
    const row = verified.rows[0]
    if (verified.rowCount !== 1 || row?.role !== 'customer_admin' || row.status !== 'active' ||
        row.sessions_enabled || row.responses_enabled || row.display_name !== 'VinMed Hospital' || row.logo_path !== logoPath) {
      throw new Error('VinMed seed verification failed; transaction will be rolled back.')
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
  const subjectId = resolveSubject()
  const database = new Client({ connectionString: env.DATABASE_URL })
  await database.connect()
  try {
    await provisionVinmedAdmin(database, subjectId)
  } finally {
    await database.end()
  }
  process.stdout.write(`Provisioned ${email} as customer_admin in the isolated ${tenantId} demo tenant with VinMed branding. AI entitlements remain disabled.\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
