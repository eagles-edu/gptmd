import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const archiverFile = require('archiver-utils/file.js') as { expand(pattern: string): string[] }
const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
  overrides?: { glob?: string }
}

describe('archiver glob override', () => {
  it('pins an actively supported glob release for archiver-utils', () => {
    expect(packageJson.overrides?.glob).toBe('^13.0.6')
  })

  it('keeps the synchronous glob API archiver-utils needs', () => {
    expect(archiverFile.expand('package*.json')).toEqual(['package.json', 'package-lock.json'])
  })
})
