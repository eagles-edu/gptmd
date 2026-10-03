import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalJsonStringify } from '../../services/api/src/canonical-json.ts'

describe('canonical JSON digest input', () => {
  it('keeps object key order stable across PostgreSQL JSONB round trips', () => {
    const generated = { name: 'Ari', nested: { second: 2, first: 1 }, values: ['a', 'b'] }
    const jsonbOrder = { values: ['a', 'b'], nested: { first: 1, second: 2 }, name: 'Ari' }

    expect(canonicalJsonStringify(generated)).toBe(canonicalJsonStringify(jsonbOrder))
    expect(createHash('sha256').update(canonicalJsonStringify(generated)).digest('hex'))
      .toBe(createHash('sha256').update(canonicalJsonStringify(jsonbOrder)).digest('hex'))
  })
})
