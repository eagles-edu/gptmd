import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  globalSetup: './tests/e2e/preflight.global-setup.ts',
  testDir: './tests/e2e',
  testMatch: 'encounter-preflight.spec.ts',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'https://localhost:3002',
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium-preflight',
      use: { ...devices['Desktop Chrome'] }
    },
    {
      name: 'firefox-preflight',
      use: { ...devices['Desktop Firefox'] }
    },
    {
      name: 'webkit-preflight',
      use: { ...devices['Desktop Safari'] }
    }
  ],
  webServer: {
    command: 'env -u NO_COLOR NUXT_PUBLIC_SUPABASE_URL=https://localhost:3003 NUXT_PUBLIC_SUPABASE_KEY=preflight-test-anon-key node scripts/playwright-https-server.mjs 3002 3012',
    reuseExistingServer: false,
    ignoreHTTPSErrors: true,
    url: 'https://localhost:3002'
  }
})
