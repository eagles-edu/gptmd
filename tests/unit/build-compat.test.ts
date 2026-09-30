import { describe, expect, it } from 'vitest'
import { nuxtH3ReexportPlugin, removeLegacyEsbuildOptions } from '../../scripts/nuxt-build-compat'

const nuxtH3Wrapper = `import { H3Error, H3Event, createError, deleteCookie } from "h3";
export * from "h3";
export { H3Error, H3Event, createError, deleteCookie };`

describe('Nuxt build compatibility fixes', () => {
  it('removes the ignored legacy esbuild option after migrating its behavior to OXC', () => {
    const config = {
      esbuild: { drop: ['console', 'debugger'] },
      define: { __test__: true }
    }

    removeLegacyEsbuildOptions(config)

    expect(config).toEqual({ define: { __test__: true } })
  })

  it('removes only duplicate H3 named imports while preserving wildcard exports', () => {
    const transformed = nuxtH3ReexportPlugin.transform(
      nuxtH3Wrapper,
      '/node_modules/@nuxt/nitro-server/dist/h3.mjs'
    )

    expect(transformed).toContain('import { createError, deleteCookie } from "h3";')
    expect(transformed).toContain('export * from "h3";')
    expect(transformed).toContain('export { createError, deleteCookie };')
    expect(transformed).not.toContain('H3Error')
    expect(transformed).not.toContain('H3Event')
  })

  it('leaves other modules unchanged', () => {
    expect(nuxtH3ReexportPlugin.transform('export const value = 1', '/app/server/api.ts')).toBeNull()
  })
})
