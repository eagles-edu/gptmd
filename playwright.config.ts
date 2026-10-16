import { defineConfig, devices } from '@playwright/test'

const httpsPort = process.env.GPTMD_E2E_HTTPS_PORT ?? '3001'
const appPort = process.env.GPTMD_E2E_APP_PORT ?? '3011'
const appOrigin = `https://localhost:${httpsPort}`

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['encounter-preflight.spec.ts', 'mobile-viewer.spec.ts', 'mobileviewer-tool.spec.ts'],
  fullyParallel: true,
  // Browser engines contend for the local Nuxt server; serialize this suite so
  // cross-browser flows stay within their per-test timeouts on the live host.
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: appOrigin,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] }
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] }
    }
  ],
  webServer: {
    command: `env -u NO_COLOR NUXT_PUBLIC_SUPABASE_URL=${appOrigin} NUXT_PUBLIC_SUPABASE_KEY=test-publishable-key node scripts/playwright-https-server.mjs ${httpsPort} ${appPort}`,
    reuseExistingServer: false,
    ignoreHTTPSErrors: true,
    url: appOrigin
  }
})
