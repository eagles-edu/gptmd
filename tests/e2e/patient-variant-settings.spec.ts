import { expect, test } from '@playwright/test'
import { Buffer } from 'node:buffer'

function makeAuthCookie(): string {
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const accessToken = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({
      sub: 'variant-instructor-subject', aud: 'authenticated', role: 'authenticated',
      email: 'instructor@example.test', iat: now, exp: now + 3600
    }),
    'test-signature'
  ].join('.')
  return `base64-${encode({
    access_token: accessToken,
    refresh_token: 'variant-instructor-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600
  })}`
}

test('instructor can edit and save draft settings for all ten variants', async ({ page, baseURL }) => {
  const variantKeys = [
    '1019-average', '1019-heavy', '2029-average', '2029-heavy', '3039-average',
    '3039-heavy', '4049-average', '4049-heavy', '5059-average', '5059-heavy'
  ]
  let savedPayload: Record<string, unknown> | null = null
  let selectedTenant = ''
  await page.route('**/auth/v1/user', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: 'variant-instructor-subject', aud: 'authenticated', role: 'authenticated',
      email: 'instructor@example.test', app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { full_name: 'Variant Instructor' }, created_at: '2026-01-01T00:00:00.000Z'
    })
  }))
  await page.route('**/api/account/tenants', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ memberships: [{
      tenantId: 'instructor-tenant', role: 'instructor', sessionsEnabled: false,
      responsesEnabled: false, audioTranscriptionAvailable: false
    }] })
  }))
  await page.route('**/api/instructor/patient-variant-settings', async (route) => {
    selectedTenant = route.request().headers()['x-gptmd-tenant-id'] ?? ''
    if (route.request().method() === 'PUT') {
      savedPayload = route.request().postDataJSON() as Record<string, unknown>
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ settings: { ...savedPayload, revision: 1 } })
      })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: null }) })
  })
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token',
    value: makeAuthCookie(),
    url: new URL(baseURL!).origin,
    sameSite: 'Lax'
  }])

  await page.goto('/')
  await page.getByRole('link', { name: 'Open patient variant settings' }).click()
  await expect(page.getByRole('heading', { name: 'Patient variant settings' })).toBeVisible()
  for (const key of variantKeys) await expect(page.getByRole('heading', { name: key })).toBeVisible()
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.locator('.status-message')).toContainText('Revision 1 · draft')

  expect(selectedTenant).toBe('instructor-tenant')
  expect(savedPayload?.status).toBe('draft')
  expect((savedPayload?.variants as Array<{ variantKey: string }>).map((variant) => variant.variantKey)).toEqual(variantKeys)
})
