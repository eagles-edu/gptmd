import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const stylesheetPath = resolve(process.cwd(), 'app/assets/css/fonts.css')
const stylesheet = readFileSync(stylesheetPath, 'utf8')

describe('font asset declarations', () => {
  it('resolves every declared font file from the app asset directory', () => {
    const urls = Array.from(
      stylesheet.matchAll(/url\(['"]?([^'")]+)['"]?\)/g),
      match => match[1] ?? ''
    )

    expect(urls).toHaveLength(4)
    for (const url of urls) {
      expect(url).toMatch(/^\.\.\/fonts\/.+\.woff2$/)
      expect(existsSync(resolve(dirname(stylesheetPath), url))).toBe(true)
    }
  })
})
