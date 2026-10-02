// https://nuxt.com/docs/api/configuration/nuxt-config
import { defineNuxtConfig } from 'nuxt/config'
import { nuxtH3ReexportPlugin, removeLegacyEsbuildOptions } from './scripts/nuxt-build-compat'

const { NODE_ENV: nodeEnvironment } = process.env

export default defineNuxtConfig({
  compatibilityDate: '2026-09-29',
  devtools: { enabled: true },
  debug: false,
  css: ['~/assets/css/fonts.css', '~/assets/scss/main.scss', '~/assets/css/main.css'],
  routeRules: {
    '/': { prerender: true },
    '/about': { prerender: true },
    '/commands': { prerender: true },
    '/contact': { prerender: true },
    '/help': { prerender: true },
    '/history-taking': { prerender: true },
    '/privacy': { prerender: true },
    '/refunds': { prerender: true },
    '/service-provision': { prerender: true },
    '/terms': { prerender: true },
    '/tutorial': { prerender: true }
  },
  runtimeConfig: {
    public: {
      apiBase: process.env.NUXT_PUBLIC_API_BASE ?? 'http://127.0.0.1:4000',
      supabaseUrl: process.env.NUXT_PUBLIC_SUPABASE_URL ?? '',
      supabaseKey: process.env.NUXT_PUBLIC_SUPABASE_KEY ?? '',
      paymentPortalUrl: process.env.NUXT_PUBLIC_PAYMENT_PORTAL_URL ?? '',
      paymentCheckout6MonthUrl: process.env.NUXT_PUBLIC_PAYMENT_CHECKOUT_6_MONTH_URL ?? '',
      paymentCheckout12MonthUrl: process.env.NUXT_PUBLIC_PAYMENT_CHECKOUT_12_MONTH_URL ?? '',
      supportEmail: process.env.NUXT_PUBLIC_SUPPORT_EMAIL ?? '',
      merchantLegalName: process.env.NUXT_PUBLIC_MERCHANT_LEGAL_NAME ?? '',
      merchantTaxId: process.env.NUXT_PUBLIC_MERCHANT_TAX_ID ?? '',
      merchantTaxIdIssued: process.env.NUXT_PUBLIC_MERCHANT_TAX_ID_ISSUED ?? '',
      merchantAddress: process.env.NUXT_PUBLIC_MERCHANT_ADDRESS ?? '',
      merchantPhone: process.env.NUXT_PUBLIC_MERCHANT_PHONE ?? '',
      moitVerificationUrl: process.env.NUXT_PUBLIC_MOIT_VERIFICATION_URL ?? ''
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
    '@nuxtjs/supabase',
    'nuxt-security'
  ],
  supabase: {
    url: process.env.NUXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:8000',
    key: process.env.NUXT_PUBLIC_SUPABASE_KEY || 'not-configured',
    redirect: false,
    useSsrCookies: true,
    types: false,
    cookieOptions: {
      sameSite: 'lax',
      secure: nodeEnvironment === 'production'
    }
  },
  vite: {
    resolve: {
      alias: [{ find: /^cookie$/, replacement: 'cookie-es' }]
    },
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
