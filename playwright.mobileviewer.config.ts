import { defineConfig, devices } from '@playwright/test'

const mobileViewerHttpsPort = process.env.PLAYWRIGHT_MOBILEVIEWER_HTTPS_PORT ?? '3014'
const mobileViewerAppPort = process.env.PLAYWRIGHT_MOBILEVIEWER_APP_PORT ?? '3015'

export default defineConfig({
  globalSetup: './tests/e2e/mobileviewer.global-setup.ts',
  testDir: './tests/e2e',
  testMatch: 'mobile-viewer.spec.ts',
  fullyParallel: true,
  reporter: 'list',
  use: {
    baseURL: `https://localhost:${mobileViewerHttpsPort}`,
    ignoreHTTPSErrors: true,
    trace: 'on-first-retry'
  },
  projects: [
    {
      name: 'mobileviewer-iphone-15',
      use: { ...devices['Desktop Chrome'], viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true }
    },
    {
      name: 'mobileviewer-iphone-se',
      use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true }
    },
    {
      name: 'mobileviewer-galaxy-s24',
      use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true }
    },
    {
      name: 'mobileviewer-fold-open',
      use: { ...devices['Desktop Chrome'], viewport: { width: 812, height: 882 }, isMobile: true, hasTouch: true }
    },
    {
      name: 'mobileviewer-ipad-mini',
      use: { ...devices['Desktop Chrome'], viewport: { width: 744, height: 1133 }, isMobile: true, hasTouch: true }
    }
  ],
  webServer: {
    command: `env -u NO_COLOR NUXT_PUBLIC_SUPABASE_URL=https://localhost:3005 NUXT_PUBLIC_SUPABASE_KEY=test-publishable-key node scripts/playwright-https-server.mjs ${mobileViewerHttpsPort} ${mobileViewerAppPort}`,
    reuseExistingServer: false,
    ignoreHTTPSErrors: true,
    url: `https://localhost:${mobileViewerHttpsPort}`
  }
})
