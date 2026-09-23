import { describe, expect, it } from 'vitest'

describe('project test harness', () => {
  it('runs with the browser-like unit-test environment', () => {
    expect(document).toBeDefined()
  })
})
