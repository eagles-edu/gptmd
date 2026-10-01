import { describe, expect, it, vi } from 'vitest'
import nuxtConfig from '../../nuxt.config'

const vuetifyConfig = nuxtConfig.vuetify === false ? undefined : nuxtConfig.vuetify

describe('Nuxt diagnostic prevention config', () => {
  it('disables noisy Rolldown timing labels while retaining build warning checks', () => {
    expect(nuxtConfig.vite?.build?.rolldownOptions?.checks).toEqual({
      pluginTimings: false
    })
  })

  it('keeps OXC console and debugger removal in Rolldown minification options', () => {
    const output = nuxtConfig.vite?.build?.rolldownOptions?.output
    const outputOptions = Array.isArray(output) ? output[0] : output

    expect(outputOptions?.minify).toMatchObject({
      compress: { dropConsole: true, dropDebugger: true }
    })
  })

  it('omits unused Vuetify utility and color styles', () => {
    expect(vuetifyConfig?.moduleOptions?.styles).toEqual({
      utilities: false,
      colors: false
    })
  })

  it('keeps Vuetify client hints in a cookie separate from the app theme preference', () => {
    expect(
      vuetifyConfig?.moduleOptions?.ssrClientHints?.prefersColorSchemeOptions?.cookie?.name
    )
      .toBe('gptmd-vuetify-theme')
  })

  it('uses SSR cookies for Supabase and leaves public routes accessible', () => {
    expect(nuxtConfig.supabase).toMatchObject({ redirect: false, useSsrCookies: true })
    expect(nuxtConfig.routeRules?.['/account']).toBeUndefined()
  })

  it('marks Supabase cookies secure in production without requiring NODE_ENV in .env', async () => {
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    vi.resetModules()

    try {
      const { default: productionConfig } = await import('../../nuxt.config')
      expect(productionConfig.supabase).toMatchObject({
        cookieOptions: { secure: true }
      })
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnv
      vi.resetModules()
    }
  })

  it('resolves Supabase cookie imports through the browser-compatible ESM package', () => {
    expect(nuxtConfig.vite?.resolve?.alias).toContainEqual({
      find: /^cookie$/,
      replacement: 'cookie-es'
    })
  })
})
