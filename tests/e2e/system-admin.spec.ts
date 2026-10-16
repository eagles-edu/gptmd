import { expect, test, type Page } from '@playwright/test'
import { Buffer } from 'node:buffer'

function makeAuthCookie(subject: string, email: string): string {
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const accessToken = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({ sub: subject, aud: 'authenticated', role: 'authenticated', email, iat: now, exp: now + 3600 }),
    'test-signature'
  ].join('.')
  return `base64-${encode({
    access_token: accessToken,
    refresh_token: 'system-admin-test-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600
  })}`
}

async function mockUser(page: Page, subject: string, email: string): Promise<void> {
  await page.route('**/auth/v1/user', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: subject, aud: 'authenticated', role: 'authenticated', email,
      app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { full_name: 'Test Operator' }, created_at: '2026-01-01T00:00:00.000Z'
    })
  }))
}

async function addAuthCookie(page: Page, baseURL: string, subject: string, email: string): Promise<void> {
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token',
    value: makeAuthCookie(subject, email),
    url: new URL(baseURL).origin,
    sameSite: 'Lax'
  }])
}

const overview = {
  observedAt: '2026-10-16T08:00:00.000Z',
  operatorAvailable: true,
  systemdUnits: [
    { service: 'web', activeState: 'active', subState: 'running', activeSince: null, restartCount: 0, memoryBytes: 1024, cpuNanoseconds: 1_000_000_000 },
    { service: 'api', activeState: 'active', subState: 'running', activeSince: null, restartCount: 1, memoryBytes: 2048, cpuNanoseconds: 2_000_000_000 },
    { service: 'worker', activeState: 'active', subState: 'running', activeSince: null, restartCount: 0, memoryBytes: 3072, cpuNanoseconds: 3_000_000_000 }
  ],
  apiProcess: { intervalMs: 1000, cpuPercentOfOneCore: 1, rssBytes: 4096, heapUsedBytes: 2048, externalBytes: 1024 },
  dependencies: { postgres: 'ready', redis: 'ready', openai: 'configured', authentication: 'configured' }
}

const catalog = {
  schemaVersion: 1,
  revision: 2,
  baseMonthlyTokens: 50_000,
  currency: 'VND',
  tiers: [
    { code: 'lunar', monthlyPriceMinor: 0, status: 'draft' },
    { code: 'solar', monthlyPriceMinor: 0, status: 'draft' },
    { code: 'stellar', monthlyPriceMinor: 0, status: 'draft' }
  ],
  addOns: []
}

test('signed-in non-operator sees denial without platform controls', async ({ page, baseURL }) => {
  let overviewRequests = 0
  await mockUser(page, 'learner-subject', 'learner@example.test')
  await page.route('**/api/system-admin/overview', async (route) => {
    overviewRequests += 1
    await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) })
  })
  await page.route('**/api/account/tenants', async (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ memberships: [] })
  }))
  await addAuthCookie(page, baseURL!, 'learner-subject', 'learner@example.test')

  const authReady = page.waitForResponse((response) => response.url().endsWith('/auth/v1/user'))
  await page.goto('/')
  await authReady
  await expect(page.getByRole('button', { name: 'Checking workspace…' })).toHaveCount(0)
  await page.goto('/system-admin')
  await page.getByRole('button', { name: 'Refresh system status' }).click()
  await expect.poll(() => overviewRequests).toBeGreaterThan(0)
  await expect(page.getByRole('alert')).toContainText('not authorized')
  await expect(page.getByRole('heading', { name: 'Services' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Restart Web' })).toHaveCount(0)
})

test('allowlisted operator can inspect status/logs and submit confirmed fixed actions', async ({ page, baseURL }) => {
  const requests: Array<{ method: string; path: string; body?: unknown }> = []
  const subject = 'system-operator-subject'
  await mockUser(page, subject, 'onlineadmin@eaglesvn.online')
  await page.route('**/api/system-admin/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const body = request.postDataJSON() as unknown
    requests.push({ method: request.method(), path: `${url.pathname}${url.search}`, body })
    if (url.pathname.endsWith('/overview')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(overview) })
      return
    }
    if (url.pathname.endsWith('/consumer-catalog') && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ catalog }) })
      return
    }
    if (url.pathname.endsWith('/logs')) {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ logs: [{ timestamp: '2026-10-16T08:00:00.000Z', priority: 6, event: 'ready', message: 'API listening on loopback' }] })
      })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok' }) })
  })
  await page.route('**/api/account/tenants', async (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ memberships: [] })
  }))
  await addAuthCookie(page, baseURL!, subject, 'onlineadmin@eaglesvn.online')
  page.on('dialog', (dialog) => dialog.accept())

  const authReady = page.waitForResponse((response) => response.url().endsWith('/auth/v1/user'))
  await page.goto('/')
  await authReady
  await expect(page.getByRole('button', { name: 'Checking workspace…' })).toHaveCount(0)
  await page.goto('/system-admin')
  await page.getByRole('button', { name: 'Refresh system status' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Healthy' })).toBeVisible()
  await expect(page.getByRole('row', { name: /API active/ })).toBeVisible()
  await page.getByRole('button', { name: 'View API logs' }).click()
  await expect(page.getByText('API listening on loopback')).toBeVisible()
  await page.getByRole('button', { name: 'Restart Web' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Web restart completed' })).toBeVisible()
  await page.getByRole('button', { name: 'Rotate journal' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'journal rotation completed' })).toBeVisible()

  expect(requests).toContainEqual({ method: 'GET', path: '/api/system-admin/logs?service=api&limit=100', body: null })
  expect(requests).toContainEqual({ method: 'POST', path: '/api/system-admin/restart', body: { service: 'web', confirmation: 'web' } })
  expect(requests).toContainEqual({ method: 'POST', path: '/api/system-admin/rotate-logs', body: { confirmation: 'ROTATE GPTMD LOGS' } })
})
