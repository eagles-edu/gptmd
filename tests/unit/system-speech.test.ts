import type { Pool, PoolClient } from 'pg'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { createPostgresSystemSpeechStore } from '../../services/api/src/system-speech.ts'

describe('system-managed speech quota', () => {
  it('defines disabled-by-default policy, append-only audit, usage accounting, and per-turn idempotency', () => {
    const migration = readFileSync(new URL('../../services/api/migrations/043_system_speech_quota.sql', import.meta.url), 'utf8')
    expect(migration).toContain('enabled boolean NOT NULL DEFAULT false')
    expect(migration).toContain('CREATE TABLE gptmd_system_speech_policy_audit')
    expect(migration).toContain('CREATE TABLE gptmd_system_speech_usage')
    expect(migration).toContain('ON gptmd_system_speech_usage (subject_id, session_id_hash, turn_id_hash)')
    expect(migration.match(/ENABLE ROW LEVEL SECURITY/g)).toHaveLength(3)
  })

  it('serializes per-learner charges and makes repeated turn charges idempotent', async () => {
    let inserted = false
    const used = 32
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT pg_advisory_xact_lock')) return { rows: [], rowCount: 1 }
      if (sql.includes('SELECT enabled, monthly_characters_per_learner')) {
        return { rows: [{ enabled: true, monthly_characters_per_learner: 100, revision: 2 }], rowCount: 1 }
      }
      if (sql.includes('SELECT usage_id FROM gptmd_system_speech_usage')) {
        return inserted ? { rows: [{ usage_id: 'usage-1' }], rowCount: 1 } : { rows: [], rowCount: 0 }
      }
      if (sql.includes('SELECT COALESCE(sum(character_count)')) return { rows: [{ used: String(used) }], rowCount: 1 }
      if (sql.includes('INSERT INTO gptmd_system_speech_usage')) {
        if (inserted) return { rows: [], rowCount: 0 }
        inserted = true
        return { rows: [{ usage_id: 'usage-1' }], rowCount: 1 }
      }
      return { rows: [], rowCount: 0 }
    })
    const client = { query, release: vi.fn() } as unknown as PoolClient
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool
    const store = createPostgresSystemSpeechStore(pool)
    const charge = {
      tenantId: 'tenant-a', subjectId: 'learner-a', sessionIdHash: 'a'.repeat(64),
      turnIdHash: 'b'.repeat(64), characters: 32,
      now: new Date('2026-10-31T23:59:59-07:00')
    }

    expect(await store.chargeCharacters(charge)).toBe('charged')
    expect(await store.chargeCharacters(charge)).toBe('already_charged')
    expect(query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(hashtext($1))', ['learner-a'])
    expect(query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO gptmd_system_speech_usage'), [
      'tenant-a', 'learner-a', 'a'.repeat(64), 'b'.repeat(64), new Date('2026-11-01T00:00:00.000Z'), 32
    ])
    expect(client.release).toHaveBeenCalledTimes(2)
  })

  it('holds the call when disabled or over quota and never inserts a charge', async () => {
    let enabled = false
    let used = 0
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT enabled, monthly_characters_per_learner')) {
        return { rows: [{ enabled, monthly_characters_per_learner: 100, revision: 0 }], rowCount: 1 }
      }
      if (sql.includes('SELECT usage_id FROM gptmd_system_speech_usage')) return { rows: [], rowCount: 0 }
      if (sql.includes('SELECT COALESCE(sum(character_count)')) return { rows: [{ used: String(used) }], rowCount: 1 }
      return { rows: [], rowCount: 0 }
    })
    const client = { query, release: vi.fn() } as unknown as PoolClient
    const store = createPostgresSystemSpeechStore({ connect: vi.fn().mockResolvedValue(client) } as unknown as Pool)
    const input = {
      tenantId: 'tenant-a', subjectId: 'learner-a', sessionIdHash: 'a'.repeat(64),
      turnIdHash: 'b'.repeat(64), characters: 10, now: new Date('2026-10-16T00:00:00.000Z')
    }

    expect(await store.chargeCharacters(input)).toBe('disabled')
    enabled = true
    used = 95
    expect(await store.chargeCharacters(input)).toBe('quota_exceeded')
    expect(query.mock.calls.filter(([sql]) => String(sql).includes('INSERT INTO gptmd_system_speech_usage'))).toHaveLength(0)
  })
})
