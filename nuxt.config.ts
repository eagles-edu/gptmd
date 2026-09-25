// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  vuetify: {
    moduleOptions: {
      prefixComposables: ['useLayout']
    }
  },
  modules: [
    'vuetify-nuxt-module',
    '@nuxt/eslint',
    'nuxt-gtag',
    '@nuxt/test-utils',
    '@nuxt/icon',
    '@nuxt/ui',
    '@nuxt/image',
    '@nuxt/scripts',
    '@nuxtjs/stylelint-module',
    'nuxt-svgo',
    'nuxt-swiper',
    'nuxt-security'
  ]
})