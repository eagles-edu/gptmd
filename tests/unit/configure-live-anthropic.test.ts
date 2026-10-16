import { describe, expect, it } from 'vitest'
import { setAnthropicApiKey } from '../../scripts/configure-live-anthropic.mjs'

describe('live Anthropic environment configuration', () => {
  it('appends a key while preserving the rest of the private environment', () => {
    expect(setAnthropicApiKey('PORT=4100\n', 'sk-ant-test_key'))
      .toBe('PORT=4100\nANTHROPIC_API_KEY=sk-ant-test_key\n')
  })

  it('updates one existing assignment without duplicating it', () => {
    expect(setAnthropicApiKey('PORT=4100\nANTHROPIC_API_KEY=old_key\n', 'new_key'))
      .toBe('PORT=4100\nANTHROPIC_API_KEY=new_key\n')
  })

  it('rejects duplicate assignments and unsupported key characters', () => {
    expect(() => setAnthropicApiKey('ANTHROPIC_API_KEY=a\nANTHROPIC_API_KEY=b\n', 'c'))
      .toThrow('Expected at most one Anthropic API key setting.')
    expect(() => setAnthropicApiKey('PORT=4100\n', 'key with spaces'))
      .toThrow('unsupported characters')
  })
})
