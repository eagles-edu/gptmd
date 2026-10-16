import { expect, test } from '@playwright/test'
import { Buffer } from 'node:buffer'

function makeAuthCookie(): string {
  const encode = (value: object): string => Buffer.from(JSON.stringify(value)).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const accessToken = [
    encode({ alg: 'HS256', typ: 'JWT' }),
    encode({
      sub: 'variant-system-admin-subject', aud: 'authenticated', role: 'authenticated',
      email: 'onlineadmin@eaglesvn.online', iat: now, exp: now + 3600
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

test('system admin can edit and save draft settings for all ten variants', async ({ page, baseURL }) => {
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
      id: 'variant-system-admin-subject', aud: 'authenticated', role: 'authenticated',
      email: 'onlineadmin@eaglesvn.online', app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { full_name: 'GPTMD System Administrator' }, created_at: '2026-01-01T00:00:00.000Z'
    })
  }))
  await page.route('**/api/system-admin/patient-variant-settings/tenants', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tenants: [{ tenantId: 'instructor-tenant', displayName: 'VinMed Hospital' }] })
  }))
  await page.route('**/api/system-admin/tenants/instructor-tenant/patient-variant-settings', async (route) => {
    selectedTenant = 'instructor-tenant'
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

  await page.goto('/system-admin/patient-variants')
  await expect(page.getByRole('heading', { name: 'Patient variant settings' })).toBeVisible()
  await page.getByLabel('Workspace').selectOption('instructor-tenant')
  for (const key of variantKeys) await expect(page.getByRole('heading', { name: key })).toBeVisible()
  await page.getByRole('button', { name: 'Save draft' }).click()
  await expect(page.locator('.status-message')).toContainText('Revision 1 · draft')

  expect(selectedTenant).toBe('instructor-tenant')
  expect(savedPayload?.status).toBe('draft')
  expect((savedPayload?.variants as Array<{ variantKey: string }>).map((variant) => variant.variantKey)).toEqual(variantKeys)
})

test('duplicate primary voices block approval before the API request', async ({ page, baseURL }) => {
  const variantKeys = [
    '1019-average', '1019-heavy', '2029-average', '2029-heavy', '3039-average',
    '3039-heavy', '4049-average', '4049-heavy', '5059-average', '5059-heavy'
  ]
  const serverVoices = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer']
  let saveRequests = 0
  const approvedSettings = {
    schemaVersion: 1,
    status: 'approved',
    revision: 3,
    variants: variantKeys.map((variantKey, index) => ({
      variantKey,
      voiceProfileId: `voice-${variantKey}`,
      voice: {
        provider: 'openai-audio-speech', voiceId: serverVoices[index], locale: 'en',
        rate: null, pitch: null, volume: null, fallbackVoiceId: 'gptmd-test-fallback'
      },
      variabilityProfileId: `variability-${variantKey}`,
      variability: {
        mood: { allowedValues: ['concerned'] },
        maturity: { allowedValues: ['adult'] },
        verbosity: { allowedValues: ['moderate'] },
        educationLevel: { allowedValues: ['college'] },
        willingnessToDisclose: { allowedValues: ['gradual'] }
      }
    }))
  }

  await page.addInitScript(() => {
    const fallbackVoice = { name: 'GPTMD test fallback', lang: 'en-US', voiceURI: 'gptmd-test-fallback' }
    Object.defineProperty(window, 'speechSynthesis', {
      configurable: true,
      value: {
        getVoices: () => [fallbackVoice],
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        cancel: () => undefined,
        speak: () => undefined
      }
    })
  })
  await page.route('**/auth/v1/user', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: 'variant-system-admin-subject', aud: 'authenticated', role: 'authenticated',
      email: 'onlineadmin@eaglesvn.online', app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { full_name: 'GPTMD System Administrator' }, created_at: '2026-01-01T00:00:00.000Z'
    })
  }))
  await page.route('**/api/system-admin/patient-variant-settings/tenants', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tenants: [{ tenantId: 'instructor-tenant', displayName: 'VinMed Hospital' }] })
  }))
  await page.route('**/api/system-admin/tenants/instructor-tenant/patient-variant-settings', async (route) => {
    if (route.request().method() === 'PUT') saveRequests += 1
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ settings: approvedSettings }) })
  })
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token',
    value: makeAuthCookie(),
    url: new URL(baseURL!).origin,
    sameSite: 'Lax'
  }])

  await page.goto('/system-admin/patient-variants')
  await page.getByLabel('Workspace').selectOption('instructor-tenant')
  const approveButton = page.getByRole('button', { name: 'Approve settings' })
  await expect(approveButton).toBeEnabled()
  await page.locator('#voice-1019-heavy').selectOption('alloy')

  await expect(page.getByRole('alert')).toContainText('Every portrait variant needs a distinct primary voice')
  await expect(approveButton).toBeDisabled()
  await expect.poll(() => saveRequests).toBe(0)
})

test('tenant instructors cannot access centrally managed variant settings', async ({ page, baseURL }) => {
  await page.route('**/auth/v1/user', async (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      id: 'variant-instructor-subject', aud: 'authenticated', role: 'authenticated',
      email: 'instructor@example.test', app_metadata: { provider: 'google', providers: ['google'] },
      user_metadata: { full_name: 'Tenant Instructor' }, created_at: '2026-01-01T00:00:00.000Z'
    })
  }))
  await page.route('**/api/system-admin/patient-variant-settings/tenants', async (route) => route.fulfill({
    status: 403,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'GPTMD system administrator access is required' })
  }))
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token',
    value: makeAuthCookie(),
    url: new URL(baseURL!).origin,
    sameSite: 'Lax'
  }])

  await page.goto('/system-admin/patient-variants')
  await expect(page.getByRole('alert')).toContainText('GPTMD system administrator access is required')
  await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0)
})
