import { describe, expect, it } from 'vitest'
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
})
