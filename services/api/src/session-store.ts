import { createHash, randomBytes } from 'node:crypto'
import type { Pool, PoolClient } from 'pg'
import type { AuthenticatedPrincipal } from './auth.ts'
import {
  ImmutablePatientScenarioSchema
} from './session-contracts.ts'
import {
  PATIENT_SCENARIO_POLICY_VERSION,
  PATIENT_SCENARIO_PROMPT_VERSION,
  PATIENT_SCENARIO_SCHEMA_VERSION,
  PatientScenarioProfileSchema,
  isPatientScenarioConsistent,
  type GeneratedPatientScenario,
  type PatientScenarioVersionPins
} from './patient-profile.ts'
import { derivePatientSetup, toLearnerPatientProfile } from './patient-setup.ts'

export type QuotaFeature = 'sessions' | 'responses'
export type SessionStatus = 'initializing' | 'ready' | 'active' | 'completed' | 'cancelled'
export type SessionRecord = {
  sessionId: string
  status: SessionStatus
  createdAt: string
  updatedAt: string
  versions: PatientScenarioVersionPins
}

export type PatientScenarioSetupResult = {
  sessionId: string
  scenarioId: string
  status: 'ready'
  createdAt: string
  patient: ReturnType<typeof toLearnerPatientProfile>
  versions: PatientScenarioVersionPins
}

export type ScenarioSetupResult =
  | PatientScenarioSetupResult
  | 'not_found'
  | 'idempotency_conflict'
  | 'invalid_state'
  | 'version_unavailable'

export type StoreResult = 'allowed' | 'membership_missing' | 'entitlement_denied' | 'quota_exceeded'

export interface SessionStore {
  getActiveTenantIds(subjectId: string): Promise<string[]>
  hasActiveMembership(principal: AuthenticatedPrincipal): Promise<boolean>
  consumeQuota(principal: AuthenticatedPrincipal, feature: QuotaFeature): Promise<StoreResult>
  createSession(
    principal: AuthenticatedPrincipal,
    versions: PatientScenarioVersionPins
  ): Promise<SessionRecord | StoreResult>
  setupScenario(
    principal: AuthenticatedPrincipal,
    sessionId: string,
    idempotencyKey: string,
    generateScenario: (
      versions: PatientScenarioVersionPins,
      asOf: Date
    ) => Promise<GeneratedPatientScenario>
  ): Promise<ScenarioSetupResult>
  getOwnedSession(
    principal: AuthenticatedPrincipal,
    sessionId: string
  ): Promise<SessionRecord | null>
}

type EntitlementRow = {
  enabled: boolean
  monthly_quota: number | null
  max_active_sessions?: number | null
}

type SetupSessionRow = {
  session_id: string
  status: SessionStatus
  created_at: Date
  setup_idempotency_key_hash: string | null
  prompt_version: string
  model_version: string
  schema_version: number
  policy_version: string
}

type ScenarioRow = {
  scenario_id: string
  created_at: Date
  profile_digest: string
  profile_json: unknown
}

const toVersionPins = (row: Pick<SetupSessionRow,
  'prompt_version' | 'model_version' | 'schema_version' | 'policy_version'
>): PatientScenarioVersionPins => ({
  promptVersion: row.prompt_version,
  modelVersion: row.model_version,
  schemaVersion: row.schema_version,
  policyVersion: row.policy_version
})

function toSetupResponse(
  sessionId: string,
  scenario: ReturnType<typeof ImmutablePatientScenarioSchema.parse>,
  versions: PatientScenarioVersionPins
): PatientScenarioSetupResult {
  return {
    sessionId,
    scenarioId: scenario.scenarioId,
    status: 'ready',
    createdAt: scenario.createdAt,
    patient: toLearnerPatientProfile(derivePatientSetup(scenario.profile)),
    versions
  }
}

async function rollback(client: PoolClient): Promise<void> {
  try {
    await client.query('ROLLBACK')
  } catch {
    // Preserve the original transaction error.
  }
}

export function createPostgresSessionStore(pool: Pool): SessionStore {
  return {
    async getActiveTenantIds(subjectId) {
      const result = await pool.query<{ tenant_id: string }>(
        `SELECT tenant_id FROM tenant_memberships
         WHERE subject_id = $1 AND status = 'active'
         ORDER BY tenant_id`,
        [subjectId]
      )
      return result.rows.map((row) => row.tenant_id)
    },

    async hasActiveMembership(principal) {
      if (!principal.tenantId) return false
      const result = await pool.query(
        `SELECT 1 FROM tenant_memberships
         WHERE tenant_id = $1 AND subject_id = $2 AND status = 'active'`,
        [principal.tenantId, principal.subjectId]
      )
      return (result.rowCount ?? 0) > 0
    },

    async consumeQuota(principal, feature) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const entitlement = await client.query<EntitlementRow>(
          `SELECT ${feature === 'sessions' ? 'sessions_enabled AS enabled, monthly_session_quota AS monthly_quota' : 'responses_enabled AS enabled, monthly_response_quota AS monthly_quota'}
           FROM tenant_entitlements e
           JOIN tenant_memberships m USING (tenant_id)
           WHERE e.tenant_id = $1 AND m.subject_id = $2
             AND m.status = 'active'
           FOR UPDATE OF e`,
          [principal.tenantId, principal.subjectId]
        )
        const row = entitlement.rows[0]
        if (!row) {
          await client.query('ROLLBACK')
          return 'membership_missing'
        }
        if (!row.enabled) {
          await client.query('ROLLBACK')
          return 'entitlement_denied'
        }
        const reserved = await reserveMonthlyQuota(client, principal.tenantId, feature, row.monthly_quota)
        if (!reserved) {
          await client.query('ROLLBACK')
          return 'quota_exceeded'
        }
        await client.query('COMMIT')
        return 'allowed'
      } catch (error) {
        await rollback(client)
        throw error
      } finally {
        client.release()
      }
    },

    async createSession(principal, versions) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const entitlement = await client.query<EntitlementRow>(
          `SELECT sessions_enabled AS enabled, monthly_session_quota AS monthly_quota,
                  max_active_sessions
           FROM tenant_entitlements e
           JOIN tenant_memberships m USING (tenant_id)
           WHERE e.tenant_id = $1 AND m.subject_id = $2 AND m.status = 'active'
           FOR UPDATE OF e`,
          [principal.tenantId, principal.subjectId]
        )
        const row = entitlement.rows[0]
        if (!row) {
          await client.query('ROLLBACK')
          return 'membership_missing'
        }
        if (!row.enabled) {
          await client.query('ROLLBACK')
          return 'entitlement_denied'
        }
        if (row.max_active_sessions !== null && row.max_active_sessions !== undefined) {
          const active = await client.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM app_sessions
             WHERE tenant_id = $1 AND status IN ('initializing', 'ready', 'active')`,
            [principal.tenantId]
          )
          if (Number(active.rows[0]?.count ?? 0) >= row.max_active_sessions) {
            await client.query('ROLLBACK')
            return 'quota_exceeded'
          }
        }
        const reserved = await reserveMonthlyQuota(client, principal.tenantId, 'sessions', row.monthly_quota)
        if (!reserved) {
          await client.query('ROLLBACK')
          return 'quota_exceeded'
        }
        const sessionId = randomBytes(32).toString('base64url')
        const inserted = await client.query<{ created_at: Date; updated_at: Date }>(
          `INSERT INTO app_sessions (
             session_id, tenant_id, subject_id, status,
             prompt_version, model_version, schema_version, policy_version
           )
           VALUES ($1, $2, $3, 'initializing', $4, $5, $6, $7)
           RETURNING created_at, updated_at`,
          [
            sessionId,
            principal.tenantId,
            principal.subjectId,
            versions.promptVersion,
            versions.modelVersion,
            versions.schemaVersion,
            versions.policyVersion
          ]
        )
        await client.query('COMMIT')
        const created = inserted.rows[0]
        if (!created) throw new Error('Session insert did not return timestamps')
        return {
          sessionId,
          status: 'initializing',
          createdAt: created.created_at.toISOString(),
          updatedAt: created.updated_at.toISOString(),
          versions
        }
      } catch (error) {
        await rollback(client)
        throw error
      } finally {
        client.release()
      }
    },

    async setupScenario(principal, sessionId, idempotencyKey, generateScenario) {
      const client = await pool.connect()
      const idempotencyHash = createHash('sha256').update(idempotencyKey).digest('hex')
      try {
        await client.query('BEGIN')
        const selected = await client.query<SetupSessionRow>(
          `SELECT session_id, status, created_at, setup_idempotency_key_hash,
                  prompt_version, model_version, schema_version, policy_version
           FROM app_sessions
           WHERE session_id = $1 AND tenant_id = $2 AND subject_id = $3
           FOR UPDATE`,
          [sessionId, principal.tenantId, principal.subjectId]
        )
        const session = selected.rows[0]
        if (!session) {
          await client.query('ROLLBACK')
          return 'not_found'
        }

        const versions = toVersionPins(session)
        if (session.setup_idempotency_key_hash && session.setup_idempotency_key_hash !== idempotencyHash) {
          await client.query('ROLLBACK')
          return 'idempotency_conflict'
        }

        const saved = await client.query<ScenarioRow>(
          `SELECT scenario_id, created_at, profile_digest, profile_json
           FROM patient_scenarios WHERE session_id = $1`,
          [sessionId]
        )
        const savedRow = saved.rows[0]
        if (savedRow) {
          if (session.status !== 'ready' || session.setup_idempotency_key_hash !== idempotencyHash) {
            await client.query('ROLLBACK')
            return 'invalid_state'
          }
          const profile = PatientScenarioProfileSchema.parse(savedRow.profile_json)
          const scenario = ImmutablePatientScenarioSchema.parse({
            scenarioId: savedRow.scenario_id,
            schemaVersion: versions.schemaVersion,
            createdAt: savedRow.created_at.toISOString(),
            profileDigest: savedRow.profile_digest,
            profile
          })
          const digest = createHash('sha256').update(JSON.stringify(scenario.profile)).digest('hex')
          if (digest !== scenario.profileDigest) {
            await client.query('ROLLBACK')
            throw new Error('Stored patient scenario digest does not match its profile')
          }
          await client.query('COMMIT')
          return toSetupResponse(sessionId, scenario, versions)
        }

        if (session.status !== 'initializing') {
          await client.query('ROLLBACK')
          return 'invalid_state'
        }
        if (
          versions.promptVersion !== PATIENT_SCENARIO_PROMPT_VERSION ||
          versions.policyVersion !== PATIENT_SCENARIO_POLICY_VERSION ||
          versions.schemaVersion !== PATIENT_SCENARIO_SCHEMA_VERSION
        ) {
          await client.query('ROLLBACK')
          return 'version_unavailable'
        }

        const generated = await generateScenario(versions, session.created_at)
        const profile = PatientScenarioProfileSchema.parse(generated.profile)
        if (!isPatientScenarioConsistent(profile, session.created_at)) {
          throw new Error('Generated patient profile failed session-time consistency validation')
        }
        if (typeof generated.conversationId !== 'string' || !generated.conversationId.trim()) {
          throw new Error('Generated patient scenario has no provider Conversation ID')
        }
        const scenario = ImmutablePatientScenarioSchema.parse({
          scenarioId: randomBytes(32).toString('base64url'),
          schemaVersion: versions.schemaVersion,
          createdAt: new Date().toISOString(),
          profileDigest: createHash('sha256').update(JSON.stringify(profile)).digest('hex'),
          profile
        })
        derivePatientSetup(scenario.profile)
        await client.query(
          `INSERT INTO patient_scenarios (
             scenario_id, session_id, schema_version, created_at, profile_digest,
             profile_json, provider_conversation_id, prompt_version, model_version, policy_version
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            scenario.scenarioId,
            sessionId,
            versions.schemaVersion,
            scenario.createdAt,
            scenario.profileDigest,
            scenario.profile,
            generated.conversationId,
            versions.promptVersion,
            versions.modelVersion,
            versions.policyVersion
          ]
        )
        await client.query(
          `UPDATE app_sessions
           SET status = 'ready', setup_idempotency_key_hash = $2, updated_at = now()
           WHERE session_id = $1`,
          [sessionId, idempotencyHash]
        )
        await client.query('COMMIT')
        return toSetupResponse(sessionId, scenario, versions)
      } catch (error) {
        await rollback(client)
        throw error
      } finally {
        client.release()
      }
    },

    async getOwnedSession(principal, sessionId) {
      const result = await pool.query<{
        session_id: string
        status: SessionStatus
        created_at: Date
        updated_at: Date
        prompt_version: string
        model_version: string
        schema_version: number
        policy_version: string
      }>(
        `SELECT session_id, status, created_at, updated_at,
                prompt_version, model_version, schema_version, policy_version
         FROM app_sessions
         WHERE session_id = $1 AND tenant_id = $2 AND subject_id = $3`,
        [sessionId, principal.tenantId, principal.subjectId]
      )
      const row = result.rows[0]
      return row ? {
        sessionId: row.session_id,
        status: row.status,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        versions: toVersionPins(row)
      } : null
    }
  }
}

async function reserveMonthlyQuota(
  client: PoolClient,
  tenantId: string,
  feature: QuotaFeature,
  quota: number | null
): Promise<boolean> {
  const result = await client.query(
    `INSERT INTO tenant_monthly_usage (tenant_id, feature, month_start, used)
     SELECT $1, $2, date_trunc('month', now() AT TIME ZONE 'UTC')::date, 1
     WHERE $3::integer IS NULL OR $3::integer > 0
     ON CONFLICT (tenant_id, feature, month_start)
     DO UPDATE SET used = tenant_monthly_usage.used + 1
       WHERE $3::integer IS NULL OR tenant_monthly_usage.used < $3::integer
     RETURNING used`,
    [tenantId, feature, quota]
  )
  return (result.rowCount ?? 0) === 1
}
