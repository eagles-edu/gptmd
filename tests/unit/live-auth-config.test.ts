import { describe, expect, it } from 'vitest'
import { appendEnvListValue, setEnvValue } from '../../scripts/live-auth-config.mjs'

describe('live authentication environment configuration', () => {
  it('updates one key without changing unrelated environment values', () => {
    expect(setEnvValue('A=one\nB=two\n', 'B', 'three')).toBe('A=one\nB=three\n')
  })

  it('rejects duplicate keys instead of silently changing an ambiguous config', () => {
    expect(() => setEnvValue('A=one\nA=two\n', 'A', 'three')).toThrow('Expected at most one A setting.')
  })

  it('appends the public confirmation redirect exactly once', () => {
    const source = 'ADDITIONAL_REDIRECT_URLS=http://localhost:3000/confirm\n'
    const first = appendEnvListValue(source, 'ADDITIONAL_REDIRECT_URLS', 'https://obgyn.eaglesvn.club/confirm')
    expect(first).toContain('http://localhost:3000/confirm,https://obgyn.eaglesvn.club/confirm')
    expect(appendEnvListValue(first, 'ADDITIONAL_REDIRECT_URLS', 'https://obgyn.eaglesvn.club/confirm')).toBe(first)
  })
})
