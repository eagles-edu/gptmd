import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:3001',
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] }
    }
  ],
  webServer: {
    command: 'env -u NO_COLOR PORT=3001 node .output/server/index.mjs',
    reuseExistingServer: false,
    url: 'http://127.0.0.1:3001',
    env: {
      NUXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:3001',
      NUXT_PUBLIC_SUPABASE_KEY: 'test-publishable-key'
    }
  }
})
