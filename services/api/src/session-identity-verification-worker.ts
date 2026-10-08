import type { Pool } from 'pg'
import type { PatientStateStore } from './patient-state-store.ts'
import {
  SessionIdentityBindingSchema,
  verifySessionIdentityBinding,
  type SessionIdentityVerificationStatus
} from './session-identity.ts'

type IdentityRow = {
  session_id: string
  tenant_id: string
  subject_id: string
  patient_profile_id: string
  provider_conversation_id: string
  scenario_fingerprint: string
  schema_version: number
}

export type SessionIdentityVerificationMetrics = {
  observedAt: string
  checked: number
  verified: number
  redisMissing: number
  redisUnavailable: number
  mismatches: number
}

export type SessionIdentityVerificationWorker = {
  verifyOnce(): Promise<SessionIdentityVerificationMetrics>
  run(signal?: AbortSignal): Promise<void>
}

export function createSessionIdentityVerificationWorker(
  pool: Pool,
  stateStore: PatientStateStore,
  options: {
    batchSize?: number
    intervalMs?: number
    verificationIntervalSeconds?: number
    onError?: (error: unknown) => void
    onMetrics?: (metrics: SessionIdentityVerificationMetrics) => void
  } = {}
): SessionIdentityVerificationWorker {
  const batchSize = options.batchSize ?? 100
  const intervalMs = options.intervalMs ?? 60_000
  const verificationIntervalSeconds = options.verificationIntervalSeconds ?? 15 * 60

  return {
    async verifyOnce() {
      const selected = await pool.query<IdentityRow>(
        `SELECT i.session_id, i.tenant_id, i.subject_id, i.patient_profile_id,
                i.provider_conversation_id, i.scenario_fingerprint, i.schema_version
         FROM session_identity_binding i
         JOIN app_sessions s ON s.session_id = i.session_id
           AND s.tenant_id = i.tenant_id AND s.subject_id = i.subject_id
         WHERE s.status IN ('ready', 'active')
           AND (i.last_check_at IS NULL OR
                i.last_check_at < now() - make_interval(secs => $1))
         ORDER BY i.last_check_at NULLS FIRST, i.created_at
         LIMIT $2`,
        [verificationIntervalSeconds, batchSize]
      )
      let verified = 0
      let redisMissing = 0
      let redisUnavailable = 0
      let mismatches = 0

      for (const row of selected.rows) {
        const binding = SessionIdentityBindingSchema.parse({
          sessionId: row.session_id,
          tenantId: row.tenant_id,
          subjectId: row.subject_id,
          patientProfileId: row.patient_profile_id,
          providerConversationId: row.provider_conversation_id,
          scenarioFingerprint: row.scenario_fingerprint,
          schemaVersion: row.schema_version
        })
        let status: SessionIdentityVerificationStatus | 'redis_unavailable' = 'redis_unavailable'
        let live: Awaited<ReturnType<PatientStateStore['read']>> | undefined
        try {
          live = await stateStore.read(binding.sessionId)
        } catch {
          status = 'redis_unavailable'
        }
        if (live === null) status = 'redis_missing'
        else if (live !== undefined) {
          try {
            status = verifySessionIdentityBinding(binding, live)
          } catch {
            status = 'mismatch'
          }
        }
        await pool.query(
          `UPDATE session_identity_binding
           SET last_check_at = now(),
               last_verified_at = CASE WHEN $2 = 'verified' THEN now() ELSE last_verified_at END,
               last_verification_status = $2
           WHERE session_id = $1`,
          [binding.sessionId, status]
        )
        if (status === 'verified') verified += 1
        else if (status === 'redis_missing') redisMissing += 1
        else if (status === 'redis_unavailable') redisUnavailable += 1
        else mismatches += 1
      }

      return {
        observedAt: new Date().toISOString(),
        checked: selected.rows.length,
        verified,
        redisMissing,
        redisUnavailable,
        mismatches
      }
    },

    async run(signal = new AbortController().signal) {
      while (!signal.aborted) {
        try {
          const metrics = await this.verifyOnce()
          if (metrics.checked > 0 || metrics.mismatches > 0 || metrics.redisUnavailable > 0) {
            options.onMetrics?.(metrics)
          }
        } catch (error) {
          options.onError?.(error)
        }
        await delay(intervalMs, signal)
      }
    }
  }
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds)
    function done(): void {
      clearTimeout(timer)
      signal.removeEventListener('abort', done)
      resolve()
    }
    signal.addEventListener('abort', done, { once: true })
  })
}
