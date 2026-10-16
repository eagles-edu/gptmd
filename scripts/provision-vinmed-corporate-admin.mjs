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
const requiredMigrations = [
  '006_tenant_membership_roles.sql',
  '040_tenant_branding.sql',
  '041_tenant_member_roster_invitations.sql',
  '042_customer_admin_email_invitations.sql'
]

export async function provisionVinmedAdmin(database) {
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
    await database.query('INSERT INTO tenant_entitlements (tenant_id) VALUES ($1)', [tenantId])
    await database.query(
      `INSERT INTO tenant_branding (tenant_id, display_name, logo_path)
       VALUES ($1, 'VinMed Hospital', $2)`, [tenantId, logoPath]
    )
    await database.query(
      `INSERT INTO tenant_member_roster_invitations
         (tenant_id, email, requested_role, group_codes, department_code, assigned_by)
       VALUES ($1, $2, 'customer_admin', ARRAY[]::text[], NULL, 'gptmd-system-admin')`,
      [tenantId, email]
    )
    await database.query(
      `INSERT INTO tenant_member_roster_invitation_audit
         (tenant_id, email, changed_by, action, requested_role)
       VALUES ($1, $2, 'gptmd-system-admin', 'customer_admin_invited', 'customer_admin')`,
      [tenantId, email]
    )

    const verified = await database.query(`
      SELECT invitation.status, invitation.requested_role, invitation.email,
             e.sessions_enabled, e.responses_enabled, b.display_name, b.logo_path
      FROM tenant_member_roster_invitations invitation
      JOIN tenant_entitlements e USING (tenant_id)
      JOIN tenant_branding b USING (tenant_id)
      WHERE invitation.tenant_id = $1 AND invitation.email = $2
    `, [tenantId, email])
    const row = verified.rows[0]
    if (verified.rowCount !== 1 || row?.requested_role !== 'customer_admin' || row.status !== 'pending' ||
        row.email !== email ||
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
  const database = new Client({ connectionString: env.DATABASE_URL })
  await database.connect()
  try {
    await provisionVinmedAdmin(database)
  } finally {
    await database.end()
  }
  process.stdout.write(`Created the isolated ${tenantId} VinMed demo tenant with a pending customer-admin email invitation and disabled AI entitlements. ${email} must complete Google sign-in before membership is activated.\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  })
}
