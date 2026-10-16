import type { Pool } from 'pg'
import { z } from 'zod'

export const SystemSpeechPolicySchema = z.object({
  enabled: z.boolean(),
  monthlyCharactersPerLearner: z.number().int().min(0).max(2_147_483_647),
  revision: z.number().int().nonnegative()
}).strict()

export type SystemSpeechPolicy = z.infer<typeof SystemSpeechPolicySchema>

export type SystemSpeechUsageSummary = {
  monthStart: string
  charactersUsed: number
  activeLearners: number
}

export interface SystemSpeechStore {
  getPolicy(): Promise<SystemSpeechPolicy>
  getUsageSummary(monthStart: Date): Promise<SystemSpeechUsageSummary>
  savePolicy(changedBy: string, input: Omit<SystemSpeechPolicy, 'revision'> & { expectedRevision: number }): Promise<SystemSpeechPolicy | 'conflict'>
  chargeCharacters(input: {
    tenantId: string
    subjectId: string
    sessionIdHash: string
    turnIdHash: string
    characters: number
    now?: Date
  }): Promise<'charged' | 'already_charged' | 'disabled' | 'quota_exceeded'>
}

type PolicyRow = {
  enabled: boolean
  monthly_characters_per_learner: number
  revision: number
}

function mapPolicy(row: PolicyRow): SystemSpeechPolicy {
  return SystemSpeechPolicySchema.parse({
    enabled: row.enabled,
    monthlyCharactersPerLearner: Number(row.monthly_characters_per_learner),
    revision: Number(row.revision)
  })
}

function monthBounds(now: Date): { start: Date; next: Date } {
  if (!Number.isFinite(now.getTime())) throw new Error('A valid speech usage date is required.')
  return {
    start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    next: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  }
}

export function createPostgresSystemSpeechStore(pool: Pool): SystemSpeechStore {
  return {
    async getPolicy() {
      const result = await pool.query<PolicyRow>(
        `SELECT enabled, monthly_characters_per_learner, revision
         FROM gptmd_system_speech_policy WHERE policy_id = true`
      )
      if (!result.rows[0]) throw new Error('System speech policy is not initialized.')
      return mapPolicy(result.rows[0])
    },

    async getUsageSummary(monthStart) {
      const { start, next } = monthBounds(monthStart)
      const result = await pool.query<{
        characters_used: string
        active_learners: string
      }>(
        `SELECT COALESCE(sum(character_count), 0)::text AS characters_used,
                count(DISTINCT subject_id)::text AS active_learners
         FROM gptmd_system_speech_usage
         WHERE period_start = $1 AND occurred_at >= $1 AND occurred_at < $2`,
        [start, next]
      )
      return {
        monthStart: start.toISOString(),
        charactersUsed: Number(result.rows[0]?.characters_used ?? 0),
        activeLearners: Number(result.rows[0]?.active_learners ?? 0)
      }
    },

    async savePolicy(changedBy, input) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const current = await client.query<PolicyRow>(
          `SELECT enabled, monthly_characters_per_learner, revision
           FROM gptmd_system_speech_policy WHERE policy_id = true FOR UPDATE`
        )
        const row = current.rows[0]
        if (!row) throw new Error('System speech policy is not initialized.')
        if (Number(row.revision) !== input.expectedRevision) {
          await client.query('ROLLBACK')
          return 'conflict'
        }
        const before = mapPolicy(row)
        const updated = await client.query<PolicyRow>(
          `UPDATE gptmd_system_speech_policy
           SET enabled = $1, monthly_characters_per_learner = $2,
               revision = revision + 1, changed_by = $3, changed_at = now()
           WHERE policy_id = true
           RETURNING enabled, monthly_characters_per_learner, revision`,
          [input.enabled, input.monthlyCharactersPerLearner, changedBy]
        )
        const after = mapPolicy(updated.rows[0]!)
        await client.query(
          `INSERT INTO gptmd_system_speech_policy_audit (changed_by, before_state, after_state)
           VALUES ($1, $2::jsonb, $3::jsonb)`,
          [changedBy, JSON.stringify(before), JSON.stringify(after)]
        )
        await client.query('COMMIT')
        return after
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    },

    async chargeCharacters(input) {
      if (!Number.isSafeInteger(input.characters) || input.characters < 1) {
        throw new Error('Speech usage must contain a positive integer character count.')
      }
      const { start, next } = monthBounds(input.now ?? new Date())
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.subjectId])
        const policyResult = await client.query<PolicyRow>(
          `SELECT enabled, monthly_characters_per_learner, revision
           FROM gptmd_system_speech_policy WHERE policy_id = true FOR SHARE`
        )
        const row = policyResult.rows[0]
        if (!row || !row.enabled || Number(row.monthly_characters_per_learner) < 1) {
          await client.query('ROLLBACK')
          return 'disabled'
        }
        const existing = await client.query<{ usage_id: string }>(
          `SELECT usage_id FROM gptmd_system_speech_usage
           WHERE subject_id = $1 AND session_id_hash = $2 AND turn_id_hash = $3`,
          [input.subjectId, input.sessionIdHash, input.turnIdHash]
        )
        if (existing.rows[0]) {
          await client.query('COMMIT')
          return 'already_charged'
        }
        const usage = await client.query<{ used: string }>(
          `SELECT COALESCE(sum(character_count), 0)::text AS used
           FROM gptmd_system_speech_usage
           WHERE subject_id = $1 AND period_start = $2 AND occurred_at >= $2 AND occurred_at < $3`,
          [input.subjectId, start, next]
        )
        if (Number(usage.rows[0]?.used ?? 0) + input.characters > Number(row.monthly_characters_per_learner)) {
          await client.query('ROLLBACK')
          return 'quota_exceeded'
        }
        const inserted = await client.query(
          `INSERT INTO gptmd_system_speech_usage
             (tenant_id, subject_id, session_id_hash, turn_id_hash, period_start, character_count)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (subject_id, session_id_hash, turn_id_hash) DO NOTHING
           RETURNING usage_id`,
          [input.tenantId, input.subjectId, input.sessionIdHash, input.turnIdHash, start, input.characters]
        )
        await client.query('COMMIT')
        return inserted.rowCount ? 'charged' : 'already_charged'
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined)
        throw error
      } finally {
        client.release()
      }
    }
  }
}
