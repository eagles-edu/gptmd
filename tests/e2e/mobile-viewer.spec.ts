import { expect, test, type Page } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { TEST_LEARNER_CHART_VITAL_SIGNS } from '../fixtures/patient-vital-signs.ts'

function makeAuthCookie(): string {
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const accessToken = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({
      sub: 'a18f0de1-7b60-49b6-8eaf-19ac1e6b1c0d',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'mobile-viewer@example.test',
      iat: now,
      exp: now + 3600
    }),
    'test-signature'
  ].join('.')

  return `base64-${encode({
    access_token: accessToken,
    refresh_token: 'mobile-viewer-test-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600
  })}`
}

async function mockEncounterSetup(page: Page, baseURL: string): Promise<void> {
  const sessionId = 'm'.repeat(43)
  await page.route('**/api/encounters/current', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ encounter: null })
  }))
  await page.route('**/api/account/tenants', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ memberships: [{ tenantId: 'tenant-test', role: 'learner' }] })
  }))
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() !== 'POST' || new URL(route.request().url()).pathname !== '/api/sessions') {
      await route.fallback()
      return
    }
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId,
        status: 'initializing',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
        versions: { promptVersion: 'patient-scenario-prompt-v10', modelVersion: 'gpt-6-luna', schemaVersion: 7, policyVersion: 'patient-scenario-policy-v3' }
      })
    })
  })
  await page.route(`**/api/sessions/${sessionId}/setup`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      sessionId,
      status: 'ready',
      createdAt: '2026-10-01T00:01:00.000Z',
      patient: {
        fullName: 'Ari Nguyen',
        dateOfBirth: '1990-01-01',
        bodyType: 'average',
        reasonForVisit: 'Pelvic pain',
        vitalSigns: TEST_LEARNER_CHART_VITAL_SIGNS
      },
      versions: { promptVersion: 'patient-scenario-prompt-v10', modelVersion: 'gpt-6-luna', schemaVersion: 7, policyVersion: 'patient-scenario-policy-v3' },
      readiness: { profile: true, redis: true, conversation: true }
    })
  }))
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token', value: makeAuthCookie(), url: new URL(baseURL).origin, sameSite: 'Lax'
  }])
}

test('mobile preview viewport has no horizontal overflow and its navigation works', async ({ page }) => {
  await page.goto('/')

  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    page: document.documentElement.scrollWidth
  }))
  expect(widths.page, `page width ${widths.page}px exceeds viewport ${widths.viewport}px`).toBeLessThanOrEqual(widths.viewport)

  const navigation = page.getByRole('navigation', { name: 'Main navigation' })
  const menuButton = page.getByRole('button', { name: 'Open main menu' })
  if (await menuButton.isVisible()) {
    await expect(navigation.getByRole('link', { name: 'Instructions' })).toBeHidden()
    await menuButton.click()
    await expect(page.getByRole('button', { name: 'Close main menu' })).toHaveAttribute('aria-expanded', 'true')
    await expect(navigation.getByRole('link', { name: 'Instructions' })).toBeVisible()
    await navigation.getByRole('link', { name: 'Instructions' }).click()
    await expect(page).toHaveURL(/\/tutorial$/)
  } else {
    await expect(navigation.getByRole('link', { name: 'Instructions' })).toBeVisible()
  }
})

test('encounter chart and patient image fit the device viewport in both orientations', async ({ page }, testInfo) => {
  const baseURL = testInfo.project.use.baseURL
  if (typeof baseURL !== 'string') throw new Error('Mobile browser project must define baseURL')
  await mockEncounterSetup(page, baseURL)
  await page.goto('/encounter', { waitUntil: 'domcontentloaded' })

  const preflight = page.getByRole('dialog', { name: 'Before you begin' })
  await expect(preflight).toBeVisible()
  await preflight.getByRole('radio', { name: /Transcript/ }).check()
  await preflight.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await preflight.getByRole('button', { name: 'Continue with transcript' }).click()

  await expect(page.getByRole('button', { name: 'Enter Room' })).toBeEnabled()
  await page.getByRole('button', { name: 'Enter Room' }).click()

  const chartTab = page.getByRole('tab', { name: 'Chart' })
  await expect(chartTab).toHaveAttribute('aria-selected', 'true')
  const chart = page.getByRole('tabpanel', { name: 'Chart' })
  await expect(chart).toContainText('Ari Nguyen')
  await expect(chart).toContainText('Pelvic pain')
  await expect(chart).toContainText('Vital signs')
  const portrait = page.locator('.profile-image-wrap img')
  await expect(portrait).toHaveAttribute('src', '/assets/images/3039-average/portrait-prototype.webp')
  await expect.poll(() => portrait.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)

  const assertNoHorizontalOverflow = async () => {
    const widths = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      page: document.documentElement.scrollWidth
    }))
    expect(widths.page, `page width ${widths.page}px exceeds viewport ${widths.viewport}px`).toBeLessThanOrEqual(widths.viewport)
  }

  await assertNoHorizontalOverflow()
  const portraitSize = page.viewportSize()
  expect(portraitSize).not.toBeNull()
  await page.setViewportSize({ width: portraitSize!.height, height: portraitSize!.width })
  await assertNoHorizontalOverflow()
  await expect(chart).toBeVisible()
  await expect(portrait).toBeVisible()
})
