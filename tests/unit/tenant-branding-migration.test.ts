import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('tenant branding migration', () => {
  it('scopes brand data to one tenant and restricts logos to local SVG assets', async () => {
    const sql = await readFile(new URL('../../services/api/migrations/040_tenant_branding.sql', import.meta.url), 'utf8')
    expect(sql).toMatch(/tenant_id text PRIMARY KEY REFERENCES tenants \(tenant_id\) ON DELETE CASCADE/)
    expect(sql).toMatch(/display_name text NOT NULL CHECK/)
    expect(sql).toMatch(/logo_path text NOT NULL CHECK \(logo_path ~ '\^\/assets\/images/)
    expect(sql).not.toMatch(/https?:\/\//)
  })
})
