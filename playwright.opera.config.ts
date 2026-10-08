import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

const operaExecutablePath = process.env.OPERA_EXECUTABLE_PATH
  ? resolve(process.env.OPERA_EXECUTABLE_PATH)
  : '/usr/bin/opera'

if (!existsSync(operaExecutablePath)) {
  throw new Error(
    `Opera was not found at ${operaExecutablePath}. Set OPERA_EXECUTABLE_PATH to the Opera executable before running this project.`
  )
}

export default defineConfig({
  globalSetup: './tests/e2e/opera.global-setup.ts',
  testDir: './tests/e2e',
  testIgnore: 'encounter-preflight.spec.ts',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: 'https://localhost:3001',
    ignoreHTTPSErrors: true,
    reducedMotion: 'reduce',
    trace: 'on-first-retry',
    browserName: 'chromium',
    launchOptions: {
      executablePath: operaExecutablePath,
      args: ['--ignore-certificate-errors']
    }
  },
  webServer: {
    command: 'env -u NO_COLOR NUXT_PUBLIC_SUPABASE_URL=https://localhost:3005 NUXT_PUBLIC_SUPABASE_KEY=test-publishable-key node scripts/playwright-https-server.mjs 3001 3011',
    reuseExistingServer: false,
    ignoreHTTPSErrors: true,
    url: 'https://localhost:3001'
  }
})
