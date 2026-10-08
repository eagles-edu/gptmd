import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: ['encounter-preflight.spec.ts', 'mobile-viewer.spec.ts', 'mobileviewer-tool.spec.ts'],
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'https://localhost:3001',
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
    command: 'env -u NO_COLOR NUXT_PUBLIC_SUPABASE_URL=https://localhost:3001 NUXT_PUBLIC_SUPABASE_KEY=test-publishable-key node scripts/playwright-https-server.mjs 3001 3011',
    reuseExistingServer: false,
    ignoreHTTPSErrors: true,
    url: 'https://localhost:3001'
  }
})
