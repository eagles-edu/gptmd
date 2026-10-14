import { expect, test } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { TEST_LEARNER_CHART_VITAL_SIGNS } from '../fixtures/patient-vital-signs.ts'

function makeAuthCookie(subjectId = 'a18f0de1-7b60-49b6-8eaf-19ac1e6b1c0d', email = 'learner@example.test'): string {
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const accessToken = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({
      sub: subjectId,
      aud: 'authenticated',
      role: 'authenticated',
      email,
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

  await expect(page).toHaveTitle('Home | GPTpatient')
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
  await page.goto('/account', { waitUntil: 'domcontentloaded' })

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
  expect(new URL(authorizationUrl).searchParams.get('redirect_to')).toBe('https://localhost:3001/confirm')
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
    body: JSON.stringify({ memberships: [
      { tenantId: 'tenant-one', role: 'learner', sessionsEnabled: true, responsesEnabled: true, audioTranscriptionAvailable: true },
      { tenantId: 'tenant-two', role: 'customer_admin', sessionsEnabled: true, responsesEnabled: true, audioTranscriptionAvailable: true },
      { tenantId: 'tenant-three', role: 'learner', sessionsEnabled: true, responsesEnabled: false, audioTranscriptionAvailable: false },
      { tenantId: 'tenant-four', role: 'learner', sessionsEnabled: true, responsesEnabled: true, audioTranscriptionAvailable: false }
    ] })
  }))
  await page.route('**/api/admin/entitlements', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ policy: {
      sessionsEnabled: false, responsesEnabled: false,
      monthlySessionQuota: null, monthlySessionQuotaPerUser: null,
      monthlyResponseQuota: null, monthlyResponseQuotaPerUser: null,
      responseQuotaPerSession: null, maxActiveSessions: null,
      audioTranscriptionEnabled: false, audioTranscriptionPrivacyApproved: false,
      monthlyAudioTranscriptionSessionQuota: null
    } })
  }))
  await page.route('**/api/admin/ai-time-budget', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ settings: null, usage: null })
  }))
  await page.route('**/api/admin/ai-time-budget/assignments', async (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ members: [], groups: [], departments: [] })
  }))
  await page.route('**/api/encounters/current', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ encounter: null })
  }))
  const sessionId = 's'.repeat(43)
  const versionPins = {
    promptVersion: 'patient-scenario-prompt-v13',
    modelVersion: 'gpt-6-luna',
    schemaVersion: 8,
    policyVersion: 'patient-scenario-policy-v3'
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
        reasonForVisit: 'Pelvic pain',
        vitalSigns: TEST_LEARNER_CHART_VITAL_SIGNS
      },
      versions: versionPins,
      readiness: { profile: true, redis: true, conversation: true }
    })
  }))
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token',
    value: makeAuthCookie(),
    url: 'https://localhost:3001',
    sameSite: 'Lax'
  }])

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'learner@example.test' })).toBeVisible()
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Account' }).click()
  await expect(page.getByText('Signed in as learner@example.test')).toBeVisible()
  const accountWorkspace = page.getByRole('combobox', { name: 'GPTpatient workspace' })
  await expect(accountWorkspace).toBeVisible()
  await expect(accountWorkspace.locator('option')).toHaveCount(5)
  expect(await accountWorkspace.locator('option').evaluateAll((options) =>
    options.map((option) => option.textContent?.trim())
  )).toEqual([
    'Choose a workspace', 'Workspace 1 (Learner)', 'Workspace 2 (Customer administrator)',
    'Workspace 3 (Learner)', 'Workspace 4 (Learner)'
  ])
  await accountWorkspace.selectOption('tenant-two')
  await expect(page.getByText('Your role in this workspace: Customer administrator. Visit setup is available to learners only.')).toBeVisible()
  await accountWorkspace.selectOption('tenant-three')
  await expect(page.getByText('Visit setup is not enabled for this workspace. Contact your workspace administrator.')).toBeVisible()
  await accountWorkspace.selectOption('tenant-two')
  await expect(page.getByText('Choose the workspace you want to use before starting an encounter.')).toBeHidden()
  await page.screenshot({ path: '/tmp/gptmd-signed-in-account-desktop.png', fullPage: false })

  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Home' }).click()
  await expect(page.getByRole('heading', { name: 'learner@example.test' })).toBeVisible()
  await expect(page.getByLabel('Practice workspace')).toHaveValue('tenant-two')
  await expect(page.getByText(/Your workspace role is customer administrator/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Learner access is required' })).toBeDisabled()
  const mainNavigation = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(mainNavigation.getByRole('button', { name: 'Learner role required' })).toBeDisabled()
  await expect(mainNavigation.getByRole('link', { name: 'Begin Visit' })).toHaveCount(0)
  await page.getByLabel('Practice workspace').selectOption('tenant-three')
  await expect(page.locator('.welcome-panel').getByRole('button', { name: 'Visit access unavailable' })).toBeDisabled()
  await expect(page.locator('.welcome-panel').getByRole('link', { name: 'Begin Visit' })).toHaveCount(0)
  await page.getByLabel('Practice workspace').selectOption('tenant-one')
  await expect(page.locator('.welcome-panel').getByRole('link', { name: 'Begin Visit' })).toBeEnabled()
  await expect(mainNavigation.getByRole('link', { name: 'Begin Visit' })).toBeVisible()
  await page.screenshot({ path: '/tmp/gptmd-signed-in-home-desktop.png', fullPage: false })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '/tmp/gptmd-signed-in-home-mobile.png', fullPage: false })

  await page.locator('.welcome-panel').getByRole('link', { name: 'Begin Visit' }).click()
  const preflight = page.getByRole('dialog', { name: 'Before you begin' })
  await expect(preflight).toBeVisible()
  await expect(preflight.getByRole('heading', { name: 'Before you begin' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Chart' })).toBeEnabled()
  await preflight.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await preflight.getByRole('radio', { name: /Transcript/ }).check()
  await preflight.getByRole('button', { name: 'Continue with transcript' }).click()
  await page.getByRole('tab', { name: 'Chart' }).click()
  await expect(page.getByText('Ari Nguyen')).toBeVisible()
  await page.getByRole('tab', { name: 'Interview' }).click()
  await expect(page.getByRole('button', { name: 'Enter Room' })).toBeEnabled()
  await page.getByRole('button', { name: 'Enter Room' }).click()
  await expect(page.locator('.status-row [role="status"]')).toContainText(/green light.*your turn/i)
  expect(sessionTenantId).toBe('tenant-one')

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Home' }).click()
  await page.getByLabel('Practice workspace').selectOption('tenant-four')
  await page.locator('.welcome-panel').getByRole('link', { name: 'Begin Visit' }).click()
  const transcriptOnlyPreflight = page.getByRole('dialog', { name: 'Before you begin' })
  await expect(transcriptOnlyPreflight.locator('input[name="interaction-mode"][value="transcript"]')).toBeChecked()
  await expect(transcriptOnlyPreflight.getByRole('radio', { name: /Voice conversation/ })).toBeDisabled()
  await expect(transcriptOnlyPreflight.getByText(/voice transcription is unavailable for this workspace/i)).toBeVisible()
  await expect(transcriptOnlyPreflight.getByRole('checkbox', { name: /send my microphone audio to OpenAI/i })).toHaveCount(0)
  await transcriptOnlyPreflight.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await expect(transcriptOnlyPreflight.getByRole('button', { name: 'Continue with transcript' })).toBeEnabled()
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

test('a single customer-admin workspace is auto-selected without a workspace dropdown', async ({ page }) => {
  await page.route('**/auth/v1/user', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: 'single-admin-subject', aud: 'authenticated', role: 'authenticated',
      email: 'single-admin@example.test', app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { full_name: 'Single Workspace Admin' }, created_at: '2026-01-01T00:00:00.000Z'
    })
  }))
  await page.route('**/api/account/tenants', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ memberships: [{
      tenantId: 'single-admin-tenant', role: 'customer_admin',
      sessionsEnabled: false, responsesEnabled: false, audioTranscriptionAvailable: false
    }] })
  }))
  await page.route('**/api/admin/entitlements', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ policy: {
      sessionsEnabled: false, responsesEnabled: false,
      monthlySessionQuota: 5, monthlySessionQuotaPerUser: 5,
      monthlyResponseQuota: 50, monthlyResponseQuotaPerUser: 50,
      responseQuotaPerSession: 12, maxActiveSessions: 1,
      audioTranscriptionEnabled: false, audioTranscriptionPrivacyApproved: false,
      monthlyAudioTranscriptionSessionQuota: 0
    } })
  }))
  await page.route('**/api/admin/ai-time-budget', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ settings: null, usage: null })
  }))
  await page.route('**/api/admin/ai-time-budget/assignments', async (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ members: [], groups: [], departments: [] })
  }))
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token',
    value: makeAuthCookie('single-admin-subject', 'single-admin@example.test'),
    url: 'https://localhost:3001',
    sameSite: 'Lax'
  }])

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'single-admin@example.test' })).toBeVisible()
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Account' }).click()

  await expect(page.getByRole('combobox', { name: 'GPTpatient workspace' })).toHaveCount(0)
  await expect(page.getByText('Your role in this workspace: Customer administrator. Visit setup is available to learners only.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Entitlements and limits' })).toBeVisible()
})

test('customer administrator can change workspace entitlements with bounded controls', async ({ page }) => {
  const controlTenantId = 'gptmd-entitlement-test-scsstx'
  const learnerTenantId = 'gptmd-learner-test-scsstx'
  await page.route('**/auth/v1/user', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: 'test-admin-subject', aud: 'authenticated', role: 'authenticated',
      email: 'scsstx@gmail.com', app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { full_name: 'Test Client' }, created_at: '2026-01-01T00:00:00.000Z'
    })
  }))
  await page.route('**/api/account/tenants', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ memberships: [
      {
        tenantId: controlTenantId, role: 'customer_admin',
        sessionsEnabled: false, responsesEnabled: false, audioTranscriptionAvailable: false
      },
      {
        tenantId: learnerTenantId, role: 'learner',
        sessionsEnabled: true, responsesEnabled: true, audioTranscriptionAvailable: false
      }
    ] })
  }))
  let currentPolicy = {
    sessionsEnabled: false,
    responsesEnabled: false,
    monthlySessionQuota: 5,
    monthlySessionQuotaPerUser: 5,
    monthlyResponseQuota: 50,
    monthlyResponseQuotaPerUser: 50,
    responseQuotaPerSession: 12,
    maxActiveSessions: 1,
    audioTranscriptionEnabled: false,
    audioTranscriptionPrivacyApproved: false,
    monthlyAudioTranscriptionSessionQuota: 0
  }
  await page.route('**/api/admin/entitlements', async (route) => {
    if (route.request().method() === 'PUT') {
      currentPolicy = route.request().postDataJSON() as typeof currentPolicy
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ policy: currentPolicy }) })
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ policy: currentPolicy }) })
    }
  })
  await page.route('**/api/admin/ai-time-budget', async (route) => {
    if (route.request().method() === 'PUT') {
      const settings = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          settings: { ...settings, revision: Number(settings.revision) + 1 },
          usage: { totalTokens: '3210', responseCount: 7 }
        })
      })
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ settings: null, usage: null })
      })
    }
  })
  await page.route('**/api/admin/ai-time-budget/assignments', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ members: [], groups: [], departments: [] })
  }))
  await page.context().addCookies([{ name: 'sb-localhost-auth-token', value: makeAuthCookie('test-admin-subject', 'scsstx@gmail.com'), url: 'https://localhost:3001', sameSite: 'Lax' }])

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'scsstx@gmail.com' })).toBeVisible()
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Account' }).click()

  const accountWorkspace = page.getByRole('combobox', { name: 'GPTpatient workspace' })
  await expect(accountWorkspace.locator('option')).toHaveCount(3)
  expect(await accountWorkspace.locator('option').evaluateAll((options) =>
    options.map((option) => option.textContent?.trim())
  )).toEqual([
    'Choose a workspace',
    'Workspace 1 (Customer administrator)', 'Workspace 2 (Learner)'
  ])
  await expect(accountWorkspace.locator('option').first()).toBeDisabled()
  expect(await accountWorkspace.locator('option').first().evaluate((option) =>
    (option as HTMLOptionElement).selected
  )).toBe(true)
  await expect(page.getByText('Choose the workspace you want to use before starting an encounter.')).toBeVisible()
  await accountWorkspace.selectOption(learnerTenantId)
  await expect(page.getByRole('status').filter({ hasText: 'Your role in this workspace: Learner' })).toBeVisible()
  await expect(page.getByText('Visit setup is included in this workspace. Remaining quota is checked when you begin.')).toBeVisible()
  await accountWorkspace.selectOption(controlTenantId)
  await expect(page.getByRole('heading', { name: 'Entitlements and limits' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'AI time pool' })).toBeVisible()
  await expect(page.getByText(/Minute values are estimates/)).toBeVisible()
  await page.getByRole('button', { name: 'Add group' }).click()
  await page.getByLabel('Group code').fill('gptnursing')
  await page.getByLabel('Group name').fill('GPT Nursing')
  await page.getByLabel('Token pool').fill('100000')
  await page.getByRole('spinbutton', { name: 'Estimated minutes', exact: true }).fill('600')
  await page.getByLabel('First period start date').fill('2026-10-01')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved. AI usage remains unenforced.' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /tokens across 7 responses/ })).toBeVisible()
  const allowVisits = page.getByLabel('Allow visit setup')
  await allowVisits.check()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Entitlement policy saved and applied.' })).toBeVisible()
  await expect(allowVisits).toBeChecked()
  await expect(page.getByLabel('Privacy approval recorded for voice')).not.toBeChecked()

  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Home' }).click()
  const practiceWorkspace = page.getByLabel('Practice workspace')
  await expect(practiceWorkspace).toHaveValue(controlTenantId)
  await expect(page.getByRole('button', { name: 'Learner access is required' })).toBeDisabled()
  await expect(page.locator('.welcome-panel').getByRole('link', { name: 'Begin Visit' })).toHaveCount(0)

  await practiceWorkspace.selectOption(learnerTenantId)
  await expect(page.getByText('Visit setup is included in this workspace. Remaining quota is checked when you begin.')).toBeVisible()
  await expect(page.locator('.welcome-panel').getByRole('link', { name: 'Begin Visit' })).toBeEnabled()
})
