import { expect, test } from '@playwright/test'
import { Buffer } from 'node:buffer'

function makeAuthCookie(): string {
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const accessToken = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({
      sub: 'a18f0de1-7b60-49b6-8eaf-19ac1e6b1c0d',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'learner@example.test',
      iat: now,
      exp: now + 3600
    }),
    'test-signature'
  ].join('.')

  return `base64-${encode({
    access_token: accessToken,
    refresh_token: 'home-test-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600
  })}`
}

test('home exposes the planned learning and account entry points', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Your practice space' })).toBeVisible()
  const entryCards = page.locator('.entry-grid')
  await expect(entryCards.getByRole('link', { name: /Instructions/ })).toHaveAttribute('href', '/tutorial')
  await expect(entryCards.getByRole('link', { name: /History-Taking Overview/ })).toHaveAttribute('href', '/history-taking')
  await expect(entryCards.getByRole('link', { name: /Account Status/ })).toHaveAttribute('href', '/account')
  await expect(entryCards.getByRole('link', { name: /Contact Us/ })).toHaveAttribute('href', '/contact')

  await page.getByRole('link', { name: 'Begin Visit' }).first().click()
  await expect(page).toHaveURL(/\/login\?redirect=\/encounter$/)
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Account' })).toBeVisible()
})

test('main navigation has icons and collapses behind a mobile hamburger', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')

  const navigation = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(page.getByRole('button', { name: 'Open main menu' })).toBeHidden()
  await expect(navigation.getByRole('link', { name: 'Begin Visit' })).toBeVisible()
  await expect(navigation.locator('a svg')).toHaveCount(6)

  await page.setViewportSize({ width: 390, height: 844 })
  const menuButton = page.getByRole('button', { name: 'Open main menu' })
  await expect(menuButton).toBeVisible()
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
  await expect(navigation.getByRole('link', { name: 'Instructions' })).toBeHidden()

  await menuButton.click()
  await expect(page.getByRole('button', { name: 'Close main menu' })).toHaveAttribute('aria-expanded', 'true')
  await expect(navigation.getByRole('link', { name: 'Instructions' })).toBeVisible()
  await navigation.getByRole('link', { name: 'Instructions' }).click()
  await expect(page).toHaveURL(/\/tutorial$/)
  await expect(page.getByRole('button', { name: 'Open main menu' })).toHaveAttribute('aria-expanded', 'false')
})

test('account requires sign-in when Supabase is configured', async ({ page }) => {
  await page.goto('/account')

  await expect(page).toHaveURL(/\/login\?redirect=\/account$/)
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
})

test('login navigates to Supabase to start Google OAuth', async ({ page }) => {
  let authorizationUrl = ''
  await page.route('**/auth/v1/authorize**', async (route) => {
    authorizationUrl = route.request().url()
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<title>Supabase OAuth endpoint reached</title>'
    })
  })

  await page.goto('/login')

  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
  await expect(page).toHaveTitle('Sign in | GPTpatient')
  const button = page.getByRole('button', { name: 'Continue with Google' })
  await expect(button).toBeEnabled()
  await button.click()

  await expect(page).toHaveURL(/\/auth\/v1\/authorize\?/)
  await expect(page).toHaveTitle('Supabase OAuth endpoint reached')
  expect(authorizationUrl).toContain('/auth/v1/authorize?')
  expect(new URL(authorizationUrl).searchParams.get('provider')).toBe('google')
  expect(new URL(authorizationUrl).searchParams.get('redirect_to')).toBe('http://127.0.0.1:3001/confirm')
})

test('signed-in account workspace context carries through the home into Begin Visit', async ({ page }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  let sessionTenantId = ''
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.route('**/auth/v1/user', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: 'a18f0de1-7b60-49b6-8eaf-19ac1e6b1c0d',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'learner@example.test',
      app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { full_name: 'Test Learner' },
      created_at: '2026-01-01T00:00:00.000Z'
    })
  }))
  await page.route('**/api/account/tenants', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tenantIds: ['tenant-one', 'tenant-two'] })
  }))
  const sessionId = 's'.repeat(43)
  const versionPins = {
    promptVersion: 'patient-scenario-prompt-v1',
    modelVersion: 'gpt-6-luna',
    schemaVersion: 1,
    policyVersion: 'patient-scenario-policy-v1'
  }
  await page.route('**/api/sessions', async (route) => {
    sessionTenantId = route.request().headers()['x-gptmd-tenant-id'] ?? ''
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId,
        status: 'initializing',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
        versions: versionPins
      })
    })
  })
  await page.route(`**/api/sessions/${sessionId}/setup`, async (route) => route.fulfill({
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
        reasonForVisit: 'Pelvic pain'
      },
      versions: versionPins,
      readiness: { profile: true, redis: true, conversation: true }
    })
  }))
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token',
    value: makeAuthCookie(),
    url: 'http://127.0.0.1:3001',
    sameSite: 'Lax'
  }])

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'learner@example.test' })).toBeVisible()
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Account' }).click()
  await expect(page.getByText('Signed in as learner@example.test')).toBeVisible()
  const accountWorkspace = page.getByRole('combobox', { name: 'GPTpatient workspace' })
  await expect(accountWorkspace).toBeVisible()
  await expect(accountWorkspace.locator('option')).toHaveText(['Workspace 1', 'Workspace 2'])
  await accountWorkspace.selectOption('tenant-two')
  await expect(page.getByText('Choose the workspace you want to use before starting an encounter.')).toBeHidden()
  await page.screenshot({ path: '/tmp/gptmd-signed-in-account-desktop.png', fullPage: false })

  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Home' }).click()
  await expect(page.getByRole('heading', { name: 'learner@example.test' })).toBeVisible()
  await expect(page.getByLabel('Practice workspace')).toHaveValue('tenant-two')
  await page.screenshot({ path: '/tmp/gptmd-signed-in-home-desktop.png', fullPage: false })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '/tmp/gptmd-signed-in-home-mobile.png', fullPage: false })

  await page.getByRole('link', { name: 'Begin Visit' }).first().click()
  const preflight = page.getByRole('dialog', { name: 'Before you begin' })
  await expect(preflight).toBeVisible()
  await preflight.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await preflight.getByRole('button', { name: 'Continue with voice' }).click()
  await page.getByRole('button', { name: 'Create patient session' }).click()
  await expect(page.getByText('Ari Nguyen')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Enter Room' })).toBeEnabled()
  await page.getByRole('button', { name: 'Enter Room' }).click()
  await expect(page.getByRole('button', { name: 'Start voice conversation' })).toBeEnabled()
  expect(sessionTenantId).toBe('tenant-two')
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})
