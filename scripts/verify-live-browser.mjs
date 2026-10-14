import { chromium } from '@playwright/test'
import { pathToFileURL } from 'node:url'
import { assertGoogleOAuthRedirect } from './verify-live-oauth.mjs'

const hostname = 'obgyn.eaglesvn.club'
const homeUrl = `https://${hostname}/`
const authorizeUrl = `https://${hostname}/auth/v1/authorize?provider=google`

export function assertLiveHomeResponse(status, title, mainVisible, browserErrors) {
  if (status !== 200 || !mainVisible || /\b403\b|forbidden|banned|blocked/i.test(title)) {
    throw new Error(`Browser home preflight expected the GPTpatient home page; received HTTP ${status}.`)
  }
  if (browserErrors.length > 0) {
    throw new Error('Browser home preflight reported console or page errors.')
  }
}

export function assertLiveBrowserOAuthRedirect(status, location) {
  assertGoogleOAuthRedirect(String(status), location, 'Browser OAuth')
}

export async function verifyLiveBrowserRoutes(launch = () => chromium.launch({ headless: true })) {
  const browser = await launch()
  try {
    const page = await browser.newPage()
    const browserErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push('console')
    })
    page.on('pageerror', () => browserErrors.push('page'))

    const homeResponse = await page.goto(homeUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    const mainVisible = await page.locator('main').isVisible().catch(() => false)
    assertLiveHomeResponse(homeResponse?.status() ?? 0, await page.title(), mainVisible, browserErrors)

    const authorizeResponsePromise = page.waitForResponse(
      (response) => response.url() === authorizeUrl,
      { timeout: 15_000 }
    )
    await page.goto(authorizeUrl, { waitUntil: 'domcontentloaded', timeout: 15_000 })
    const authorizeResponse = await authorizeResponsePromise
    assertLiveBrowserOAuthRedirect(
      authorizeResponse.status(),
      authorizeResponse.headers()['location']
    )
  } finally {
    await browser.close()
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    await verifyLiveBrowserRoutes()
    process.stdout.write('Browser home and Google OAuth checks passed.\n')
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
