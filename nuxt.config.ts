// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2026-09-29',
  devtools: { enabled: false },
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
      ssrClientHints: {
        prefersColorScheme: true,
        prefersColorSchemeOptions: {
          darkThemeName: 'myCustomDarkTheme',
          lightThemeName: 'myCustomLightTheme',
          cookie: {
            name: 'gptmd-theme',
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
  ]
})
