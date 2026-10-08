import { defineConfig, devices } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const operaExecutablePath = process.env.OPERA_EXECUTABLE_PATH
  ? resolve(process.env.OPERA_EXECUTABLE_PATH)
  : '/usr/bin/opera'

if (process.env.GPTMD_PLAYWRIGHT_OPERA === '1' && !existsSync(operaExecutablePath)) {
  throw new Error(
    `Opera was not found at ${operaExecutablePath}. Set OPERA_EXECUTABLE_PATH to the Opera executable before running this project.`
  )
}

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
    },
    {
      // This runs Playwright WebKit with iPhone 13 viewport, touch, and UA
      // settings. It is mobile WebKit emulation, not an iOS device or Safari.
      name: 'webkit-iphone-emulation-preflight',
      use: { ...devices['iPhone 13'] }
    },
    ...(process.env.GPTMD_PLAYWRIGHT_OPERA === '1' ? [{
      name: 'opera-preflight',
      use: {
        browserName: 'chromium' as const,
        reducedMotion: 'reduce' as const,
        launchOptions: {
          executablePath: operaExecutablePath,
          args: ['--ignore-certificate-errors']
        }
      }
    }] : [])
  ],
  webServer: {
    command: 'env -u NO_COLOR NUXT_PUBLIC_SUPABASE_URL=https://localhost:3003 NUXT_PUBLIC_SUPABASE_KEY=preflight-test-anon-key node scripts/playwright-https-server.mjs 3002 3012',
    reuseExistingServer: false,
    ignoreHTTPSErrors: true,
    url: 'https://localhost:3002'
  }
})
