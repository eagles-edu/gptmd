import { expect, test } from '@playwright/test'
import { Buffer } from 'node:buffer'
import * as XLSX from 'xlsx'
import { TEST_LEARNER_CHART_VITAL_SIGNS } from '../fixtures/patient-vital-signs.ts'

const appOrigin = `https://localhost:${process.env.GPTMD_E2E_HTTPS_PORT ?? '3001'}`

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

test('learner can download an available session archive from Account', async ({ page }) => {
  const sessionId = 't'.repeat(43)
  let downloadHeaders: Record<string, string> = {}
  await page.route('**/auth/v1/user', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: 'a18f0de1-7b60-49b6-8eaf-19ac1e6b1c0d', aud: 'authenticated', role: 'authenticated',
      email: 'learner@example.test', app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { full_name: 'Test Learner' }, created_at: '2026-01-01T00:00:00.000Z'
    })
  }))
  await page.route('**/api/account/tenants', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ memberships: [{
      tenantId: 'tenant-one', role: 'learner', sessionsEnabled: true, responsesEnabled: true,
      audioTranscriptionAvailable: false
    }] })
  }))
  await page.route('**/api/account/archives', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ archives: [{
      archiveId: sessionId, sessionId, updatedAt: '2026-10-15T10:00:00.000Z',
      status: 'available', artifactId: 'artifact-1', downloadExpiresAt: '2027-10-15T10:00:00.000Z',
      errorCode: null
    }] })
  }))
  await page.route('**/api/account/usage', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z',
      usage: { totalTokens: '12345', responseCount: 8 }
    })
  }))
  await page.route('**/api/account/usage-ledger', async (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ entries: [{
      occurredAt: '2026-10-08T12:00:00.000Z', sessionId: 'session-usage-1',
      provider: 'openai', operation: 'patient_turn', inputTokens: 100,
      outputTokens: 20, totalTokens: '120'
    }] })
  }))
  await page.route('**/api/account/token-buckets', async (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ buckets: [{
      accountScope: 'consumer', bucketKind: 'included', groupCode: null,
      grantedTokens: '10000', usedTokens: '2500', reservedTokens: '500',
      remainingTokens: '7000', renewalAt: '2026-11-01T00:00:00.000Z',
      expiresAt: '2026-11-01T00:00:00.000Z', daysRemaining: 16
    }, {
      accountScope: 'consumer', bucketKind: 'addon', groupCode: null,
      grantedTokens: '5000', usedTokens: '0', reservedTokens: '0',
      remainingTokens: '5000', renewalAt: null,
      expiresAt: '2027-10-10T12:00:00.000Z', daysRemaining: 359
    }] })
  }))
  await page.route('**/api/store/consumer-tokens', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ storefront: {
      revision: 3, currency: 'USD', checkoutEnabled: false,
      products: [
        { code: 'lunar', kind: 'monthly_tier', tokens: 25_000, priceMinor: 900, currency: 'USD' },
        { code: 'solar', kind: 'monthly_tier', tokens: 50_000, priceMinor: 1700, currency: 'USD' },
        { code: 'extra-small', name: 'Extra Small', description: 'Expires 365 days after purchase', kind: 'token_addon', tokens: 10_000, priceMinor: 300, currency: 'USD' }
      ]
    } })
  }))
  await page.route(`**/api/sessions/${sessionId}/archive/download`, async (route) => {
    downloadHeaders = route.request().headers()
    await route.fulfill({
      status: 200,
      contentType: 'text/plain; charset=utf-8',
      headers: { 'content-disposition': 'attachment; filename="gptmd-transcript-test.txt"' },
      body: 'GPTMD simulated encounter transcript\nLearner: hello\nPatient: hello\n'
    })
  })
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token', value: makeAuthCookie(), url: appOrigin, sameSite: 'Lax'
  }])

  const identityResolved = page.waitForResponse((response) => response.url().includes('/auth/v1/user'))
  const membershipsResolved = page.waitForResponse((response) => response.url().includes('/api/account/tenants'))
  await page.goto('/')
  await Promise.all([identityResolved, membershipsResolved])
  const navigation = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(navigation.getByRole('link', { name: 'Begin Visit' })).toBeVisible()
  await navigation.getByRole('link', { name: 'Account' }).click()
  await expect(page.getByRole('heading', { name: 'Downloads' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Usage ledger' })).toBeVisible()
  await expect(page.getByRole('row', { name: /session-.*Patient response.*openai.*120/ })).toBeVisible()
  await expect(page.getByText('12,345 provider tokens this UTC month')).toBeVisible()
  await expect(page.getByText('8 recorded provider responses')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Token balances' })).toBeVisible()
  await expect(page.getByText('Monthly included allowance', { exact: true })).toBeVisible()
  await expect(page.getByText('Personal add-on tokens', { exact: true })).toBeVisible()
  await expect(page.getByText('7,000 remaining')).toBeVisible()
  await expect(page.getByText('359 days left.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Plans and add-ons' })).toBeVisible()
  await expect(page.getByRole('row', { name: /Lunar.*25,000.*Checkout unavailable/ })).toBeVisible()
  await expect(page.getByRole('row', { name: /Extra Small.*10,000.*Checkout unavailable/ })).toBeVisible()
  await expect(page.getByText('Viewing an offer does not grant token credit.')).toBeVisible()
  await expect(page.getByText(`Encounter ${sessionId.slice(0, 8)}`)).toBeVisible()
  await expect(page.getByText('Ready to download')).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download archive' }).click()
  expect((await download).suggestedFilename()).toBe(`gptmd-session-${sessionId.slice(0, 8)}.txt`)
  await expect(page.getByRole('status').filter({ hasText: 'Session archive download started.' })).toBeVisible()
  expect(downloadHeaders.authorization).toMatch(/^Bearer /)
  expect(downloadHeaders['x-gptmd-tenant-id']).toBe('tenant-one')
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

  await page.goto('/login', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
  await expect(page).toHaveTitle('Sign in | GPTpatient')
  const button = page.getByRole('button', { name: 'Continue with Google' })
  await expect(button).toBeEnabled()
  await button.click()

  await expect(page).toHaveURL(/\/auth\/v1\/authorize\?/)
  await expect(page).toHaveTitle('Supabase OAuth endpoint reached')
  expect(authorizationUrl).toContain('/auth/v1/authorize?')
  expect(new URL(authorizationUrl).searchParams.get('provider')).toBe('google')
  expect(new URL(authorizationUrl).searchParams.get('redirect_to')).toBe(`${appOrigin}/confirm`)
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
  await page.route('**/api/account/archives', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ archives: [] })
  }))
  await page.route('**/api/account/usage', async (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z',
      usage: { totalTokens: '0', responseCount: 0 }
    })
  }))
  await page.route('**/api/account/usage-ledger', async (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ entries: [{
      occurredAt: '2026-10-08T12:00:00.000Z', sessionId: 'session-one',
      provider: 'openai', operation: 'patient_turn', inputTokens: 100,
      outputTokens: 20, totalTokens: '120'
    }] })
  }))
  await page.route('**/api/account/token-buckets', async (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ buckets: [] })
  }))
  await page.route('**/api/store/consumer-tokens', async (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ storefront: { revision: 0, currency: null, products: [], checkoutEnabled: false } })
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
    body: JSON.stringify({ settings: null, usage: null, reservationSummary: null })
  }))
  await page.route('**/api/admin/ai-time-budget/assignments', async (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ members: [], groups: [], departments: [] })
  }))
  await page.route('**/api/admin/ai-time-budget/member-usage', async (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z', members: [] })
  }))
  await page.route('**/api/admin/ai-time-budget/completed-sessions', async (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({
      periodStart: '2026-10-01T00:00:00.000Z', periodEnd: '2026-11-01T00:00:00.000Z',
      records: [], hasMore: false, certificateBasis: 'completed_simulation_no_ceu_credit'
    })
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
    url: appOrigin,
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
    url: appOrigin,
    sameSite: 'Lax'
  }])

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'single-admin@example.test' })).toBeVisible()
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Account' }).click()

  await expect(page.getByRole('combobox', { name: 'GPTpatient workspace' })).toHaveCount(0)
  await expect(page.getByText('Your role in this workspace: Customer administrator. Visit setup is available to learners only.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Entitlements and limits' })).toBeVisible()
})

test('selected corporate workspace shows its own tenant logo and name in the header', async ({ page }) => {
  await page.route('**/auth/v1/user', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: 'vinmed-admin-subject', aud: 'authenticated', role: 'authenticated',
      email: 'ayeyamsam@gmail.com', app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { full_name: 'VinMed Admin' }, created_at: '2026-01-01T00:00:00.000Z'
    })
  }))
  await page.route('**/api/account/tenants', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ memberships: [{
      tenantId: 'vinmed-hospital-demo', role: 'customer_admin', sessionsEnabled: false,
      responsesEnabled: false, audioTranscriptionAvailable: false,
      branding: { displayName: 'VinMed Hospital', logoPath: '/assets/images/vinmed-logo.svg' }
    }] })
  }))
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token',
    value: makeAuthCookie('vinmed-admin-subject', 'ayeyamsam@gmail.com'),
    url: appOrigin,
    sameSite: 'Lax'
  }])

  await page.goto('/')

  const brand = page.getByRole('link', { name: 'GPTpatient home' })
  const logo = brand.getByRole('img', { name: 'VinMed Hospital' })
  await expect(logo).toHaveAttribute('src', '/assets/images/vinmed-logo.svg')
  await expect.poll(() => logo.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  await expect(brand.getByText('VinMed Hospital')).toBeVisible()
  await expect(brand.getByRole('img', { name: 'GPTpatient' })).toHaveCount(0)
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
  let savedAssignment = {
    subjectId: 'learner-subject',
    role: 'learner',
    groupCodes: [] as string[],
    departmentCode: null as string | null,
    departmentAssignedAt: null as string | null
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
          usage: { totalTokens: '3210', responseCount: 7 },
          reservationSummary: { reservedTokens: '9216', reservedCount: 2, heldTokens: '4096', heldCount: 1 }
        })
      })
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ settings: null, usage: null, reservationSummary: null })
      })
    }
  })
  await page.route('**/api/admin/ai-time-budget/assignments', async (route) => {
    if (route.request().method() === 'PUT') {
      const assignment = route.request().postDataJSON() as typeof savedAssignment
      savedAssignment = { ...assignment, role: 'learner', departmentAssignedAt: '2026-10-15T00:00:00.000Z' }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assignment: savedAssignment }) })
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          members: [savedAssignment],
          groups: savedAssignment.groupCodes.map((code) => ({ code, name: 'GPT Nursing' })),
          departments: []
        })
      })
    }
  })
  await page.route('**/api/admin/ai-time-budget/member-usage', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
      members: [{
        subjectId: 'learner-subject', role: 'learner', sessionsStarted: 4, sessionsCompleted: 2,
        providerResponseCount: 7, totalTokens: '3210', lastAiActivityAt: '2026-10-15T12:00:00.000Z',
        estimatedEngagementSeconds: 930, lastEngagementAt: '2026-10-15T12:15:00.000Z'
      }]
    })
  }))
  await page.route('**/api/admin/ai-time-budget/completed-sessions', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      periodStart: '2026-10-01T00:00:00.000Z',
      periodEnd: '2026-11-01T00:00:00.000Z',
      records: [{
        sessionId: 'completed-session-ref', subjectId: 'learner-subject',
        startedAt: '2026-10-15T12:00:00.000Z', completedAt: '2026-10-15T12:20:00.000Z',
        estimatedEngagementSeconds: 930
      }],
      hasMore: false,
      certificateBasis: 'completed_simulation_no_ceu_credit'
    })
  }))
  await page.route('**/api/admin/ai-time-budget/assignments/import', async (route) => {
    const body = route.request().postDataJSON() as { assignments: typeof savedAssignment[] }
    savedAssignment = { ...body.assignments[0]!, role: 'learner', departmentAssignedAt: savedAssignment.departmentAssignedAt }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ imported: 1, failures: [] }) })
  })
  let importedInvitation: unknown
  await page.route('**/api/admin/member-roster/invitations/import', async (route) => {
    importedInvitation = route.request().postDataJSON()
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ imported: 1, alreadyAccepted: 0 }) })
  })
  await page.context().addCookies([{ name: 'sb-localhost-auth-token', value: makeAuthCookie('test-admin-subject', 'scsstx@gmail.com'), url: appOrigin, sameSite: 'Lax' }])

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
  await expect(page.getByRole('heading', { name: 'Entitlements and limits' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'AI time pool' })).toHaveCount(0)
  await accountWorkspace.selectOption(controlTenantId)
  await expect(page.getByRole('heading', { name: 'Entitlements and limits' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'AI time pool' })).toBeVisible()
  const memberUsage = page.getByRole('group', { name: 'Member usage report' })
  await expect(page.getByText(/not continuous monitoring or CEU evidence/)).toBeVisible()
  await expect(memberUsage.getByRole('cell', { name: 'learner-subject' })).toBeVisible()
  await expect(memberUsage.getByRole('cell', { name: '3,210' })).toBeVisible()
  await expect(memberUsage.getByRole('cell', { name: '15.5' })).toBeVisible()
  await expect(memberUsage.getByRole('columnheader', { name: 'Estimated active min' })).toBeVisible()
  for (const extension of ['csv', 'xlsx', 'ods']) {
    const usageDownload = page.waitForEvent('download')
    await memberUsage.getByRole('group', { name: 'Export member usage report' })
      .getByRole('button', { name: `Download ${extension.toUpperCase()}` }).click()
    expect((await usageDownload).suggestedFilename()).toBe(`gptmd-member-usage.${extension}`)
  }
  const completionRecords = page.getByRole('group', { name: 'Completed-session records' })
  await expect(completionRecords.getByRole('cell', { name: 'learner-subject' })).toBeVisible()
  await expect(completionRecords.getByRole('cell', { name: '15.5' })).toBeVisible()
  const completionPopupPromise = page.waitForEvent('popup')
  await completionRecords.getByRole('button', { name: 'Print record' }).click()
  const completionPopup = await completionPopupPromise
  await expect(completionPopup.getByRole('heading', { name: 'Simulation completion record' })).toBeVisible()
  await expect(completionPopup.getByText('learner-subject')).toBeVisible()
  await expect(completionPopup.getByText('15.5 minutes')).toBeVisible()
  await expect(completionPopup.getByText(/No CEU credit is awarded or represented/)).toBeVisible()
  await expect(page.getByText(/Minute values are estimates/)).toBeVisible()
  await page.getByRole('button', { name: 'Add group' }).click()
  await page.getByLabel('Group code').fill('gptnursing')
  await page.getByLabel('Group name').fill('GPT Nursing')
  await page.getByLabel('Token pool').fill('100000')
  await page.getByRole('spinbutton', { name: 'Estimated minutes', exact: true }).fill('600')
  await page.getByRole('button', { name: 'Add department' }).click()
  const departmentRow = page.locator('.department-row')
  await departmentRow.getByLabel('Department code').fill('obgyn')
  await departmentRow.getByLabel('Department name').fill('OBGYN')
  await departmentRow.getByLabel('Monthly tokens per user').fill('10000')
  await page.getByLabel('First period start date').fill('2026-10-01')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Draft saved. AI usage remains unenforced.' })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /tokens across 7 responses/ })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /In-flight: 9,216 reserved tokens \(2 calls\)/ })).toBeVisible()
  await expect(page.getByRole('status').filter({ hasText: /Held for reconciliation: 4,096 tokens \(1 call\)/ })).toBeVisible()
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Activate limits' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Token enforcement settings saved.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Pause enforcement' })).toBeVisible()
  await page.getByRole('checkbox', { name: 'GPT Nursing' }).check()
  await page.getByRole('combobox', { name: 'Department' }).selectOption('obgyn')
  await expect(page.getByRole('status').filter({ hasText: /Department allowance preview: .* of 10,000 monthly tokens/ })).toBeVisible()
  await page.getByRole('button', { name: 'Save member assignment' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Member assignment saved.' })).toBeVisible()
  const rosterDownloads = page.getByRole('group', { name: 'Download roster' })
  for (const [label, extension] of [['Download CSV', 'csv'], ['Download Excel', 'xlsx'], ['Download ODS', 'ods']]) {
    const rosterDownload = page.waitForEvent('download')
    await rosterDownloads.getByRole('button', { name: label }).click()
    expect((await rosterDownload).suggestedFilename()).toBe(`gptmd-member-department-roster.${extension}`)
  }
  const rosterInput = page.getByLabel('Import CSV, XLSX, or ODS')
  await rosterInput.setInputFiles({
    name: 'roster.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from('subjectId,groupCodes,departmentCode\n"learner-subject","gptnursing",obgyn\n')
  })
  await expect(page.getByRole('status').filter({ hasText: 'Imported 1 member assignments.' })).toBeVisible()
  const rosterWorkbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(rosterWorkbook, XLSX.utils.aoa_to_sheet([
    ['subjectId', 'groupCodes', 'departmentCode'], ['learner-subject', 'gptnursing', 'obgyn']
  ]), 'Roster')
  for (const extension of ['xlsx', 'ods'] as const) {
    const buffer = XLSX.write(rosterWorkbook, { bookType: extension, type: 'buffer' })
    await rosterInput.setInputFiles({
      name: `roster.${extension}`,
      mimeType: extension === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/vnd.oasis.opendocument.spreadsheet',
      buffer: Buffer.from(buffer)
    })
    await expect(page.getByRole('status').filter({ hasText: 'Imported 1 member assignments.' })).toBeVisible()
  }
  const invitationTemplate = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download learner roster template' }).click()
  expect((await invitationTemplate).suggestedFilename()).toBe('gptmd-learner-email-roster.xlsx')
  const invitationInput = page.getByLabel('Import learners by email')
  await invitationInput.setInputFiles({
    name: 'learners.csv', mimeType: 'text/csv',
    buffer: Buffer.from('email,groupCodes,departmentCode\nEmployee@Example.test,gptnursing,obgyn\n')
  })
  await expect(page.getByRole('status').filter({ hasText: 'Imported 1 learner invitations; 0 already active.' })).toBeVisible()
  expect(importedInvitation).toEqual({ invitations: [{
    email: 'employee@example.test', groupCodes: ['gptnursing'], departmentCode: 'obgyn'
  }] })
  const learnerRoster = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(learnerRoster, XLSX.utils.aoa_to_sheet([
    ['email', 'groupCodes', 'departmentCode'], ['employee@example.test', 'gptnursing', 'obgyn']
  ]), 'Learners')
  for (const extension of ['xlsx', 'ods'] as const) {
    const buffer = XLSX.write(learnerRoster, { bookType: extension, type: 'buffer' })
    await invitationInput.setInputFiles({
      name: `learners.${extension}`,
      mimeType: extension === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'application/vnd.oasis.opendocument.spreadsheet',
      buffer: Buffer.from(buffer)
    })
    await expect(page.getByRole('status').filter({ hasText: 'Imported 1 learner invitations; 0 already active.' })).toBeVisible()
  }
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
