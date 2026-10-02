import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  globalSetup: './tests/e2e/preflight.global-setup.ts',
  testDir: './tests/e2e',
  testMatch: 'encounter-preflight.spec.ts',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3002',
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium-preflight',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    command: 'env -u NO_COLOR PORT=3002 node .output/server/index.mjs',
    reuseExistingServer: false,
    url: 'http://127.0.0.1:3002',
    env: {
      NUXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3003',
      NUXT_PUBLIC_SUPABASE_KEY: 'preflight-test-anon-key'
    }
  }
})
