// https://nuxt.com/docs/api/configuration/nuxt-config
import { defineNuxtConfig } from 'nuxt/config'
import { nuxtH3ReexportPlugin, removeLegacyEsbuildOptions } from './scripts/nuxt-build-compat'

export default defineNuxtConfig({
  compatibilityDate: '2026-09-29',
  devtools: { enabled: true },
  debug: false,
  css: ['~/assets/css/fonts.css', '~/assets/scss/main.scss', '~/assets/css/main.css'],
  routeRules: {
    '/': { prerender: true },
    '/about': { prerender: true },
    '/commands': { prerender: true },
    '/help': { prerender: true },
    '/tutorial': { prerender: true }
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://127.0.0.1:4000'
    }
  },
  vuetify: {
    moduleOptions: {
      prefixComposables: ['useLayout'],
      styles: {
        utilities: false,
        colors: false
      },
      ssrClientHints: {
        prefersColorScheme: true,
        prefersColorSchemeOptions: {
          darkThemeName: 'myCustomDarkTheme',
          lightThemeName: 'myCustomLightTheme',
          cookie: {
            name: 'gptmd-vuetify-theme',
            sameSite: 'lax'
          }
        }
      }
    }
  },
  modules: [
    'vuetify-nuxt-module',
    '@nuxt/eslint',
    'nuxt-security'
  ],
  vite: {
    build: {
      rolldownOptions: {
        checks: {
          pluginTimings: false
        },
        output: {
          minify: {
            compress: {
              dropConsole: true,
              dropDebugger: true
            }
          }
        }
      }
    }
  },
  hooks: {
    'vite:extend': ({ config }) => {
      // Nuxt still supplies this legacy option, which Vite 8 ignores in favor
      // of Oxc. The equivalent Oxc options are configured above.
      removeLegacyEsbuildOptions(config)
    },
    'nitro:config': async (config) => {
      const rollupConfig = config.rollupConfig ??= {}
      const plugins = await rollupConfig.plugins
      rollupConfig.plugins = [
        ...(Array.isArray(plugins) ? plugins : plugins ? [plugins] : []),
        nuxtH3ReexportPlugin
      ]
    }
  }
})
