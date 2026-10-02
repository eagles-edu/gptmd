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
      email: 'preflight@example.test',
      iat: now,
      exp: now + 3600
    }),
    'test-signature'
  ].join('.')

  return `base64-${encode({
    access_token: accessToken,
    refresh_token: 'preflight-test-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: now + 3600
  })}`
}

test('preflight explains readiness and falls back to transcript after microphone denial', async ({ page }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.addInitScript(() => {
    Object.defineProperty(window, '__microphoneRequests', { configurable: true, value: 0, writable: true })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => {
          ;(window as Window & { __microphoneRequests: number }).__microphoneRequests += 1
          throw new DOMException('Permission denied', 'NotAllowedError')
        }
      }
    })
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token',
    value: makeAuthCookie(),
    url: 'http://127.0.0.1:3002',
    sameSite: 'Lax'
  }])
  await page.goto('/encounter')
  const dialog = page.getByRole('dialog', { name: 'Before you begin' })
  await expect(page).toHaveURL(/\/encounter$/)
  await expect(dialog).toBeVisible()
  await page.waitForTimeout(300)
  await expect(dialog.getByText(/local storage is not a secure session vault/)).toBeVisible()
  expect(await page.evaluate(() => (window as Window & { __microphoneRequests: number }).__microphoneRequests)).toBe(0)
  await page.screenshot({ path: '/tmp/gptmd-encounter-preflight-desktop.png', fullPage: false })

  await dialog.getByRole('radio', { name: /Audio/ }).check()
  await dialog.getByRole('button', { name: 'Allow microphone access' }).click()
  await expect(dialog.getByRole('status')).toContainText(/permission was denied/i)
  await expect(dialog.getByRole('radio', { name: /Transcript only/ })).toBeChecked()
  expect(await page.evaluate(() => (window as Window & { __microphoneRequests: number }).__microphoneRequests)).toBe(1)
  await expect(dialog.getByRole('button', { name: 'Continue with transcript' })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await expect(dialog.getByRole('button', { name: 'Continue with transcript' })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Continue with transcript' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { name: 'A patient history, one question at a time' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Create patient session' })).toBeEnabled()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  const mobileDialog = page.getByRole('dialog', { name: 'Before you begin' })
  await expect(mobileDialog).toBeVisible()
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const storageExplanation = mobileDialog.getByText(/local storage is not a secure session vault/)
  await storageExplanation.evaluate((element) => element.scrollIntoView({ block: 'start', inline: 'nearest' }))
  await expect(storageExplanation).toBeInViewport()
  const consentCheckbox = mobileDialog.getByRole('checkbox', { name: /use fictional details only/i })
  const continueButton = mobileDialog.getByRole('button', { name: 'Continue with transcript' })
  await expect(consentCheckbox).toBeInViewport({ ratio: 1 })
  await expect(continueButton).toBeInViewport({ ratio: 1 })
  expect(await storageExplanation.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    return bounds.top >= 0 && bounds.bottom <= window.innerHeight
  })).toBe(true)
  expect(await storageExplanation.evaluate((element) => {
    const explanationBounds = element.getBoundingClientRect()
    const consentBounds = element.closest('.preflight-content')?.querySelector('.preflight-actions')?.getBoundingClientRect()
    return Boolean(consentBounds && explanationBounds.bottom <= consentBounds.top)
  })).toBe(true)
  await page.screenshot({ path: '/tmp/gptmd-encounter-preflight-mobile.png', fullPage: false })
  await mobileDialog.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await mobileDialog.getByRole('button', { name: 'Continue with transcript' }).click()
  await expect(mobileDialog).toBeHidden()
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

test('successful microphone permission check stops the stream and returns to transcript', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, '__microphoneTracksStopped', { configurable: true, value: 0, writable: true })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getTracks: () => [{
            stop: () => {
              ;(window as Window & { __microphoneTracksStopped: number }).__microphoneTracksStopped += 1
            }
          }]
        })
      }
    })
  })
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token',
    value: makeAuthCookie(),
    url: 'http://127.0.0.1:3002',
    sameSite: 'Lax'
  }])
  await page.goto('/encounter')

  const dialog = page.getByRole('dialog', { name: 'Before you begin' })
  await dialog.getByRole('radio', { name: /Audio/ }).check()
  expect(await page.evaluate(() => (window as Window & { __microphoneTracksStopped: number }).__microphoneTracksStopped)).toBe(0)
  await dialog.getByRole('button', { name: 'Allow microphone access' }).click()
  await expect(dialog.getByRole('status')).toContainText(/permission granted/i)
  await expect(dialog.getByRole('radio', { name: /Transcript only/ })).toBeChecked()
  expect(await page.evaluate(() => (window as Window & { __microphoneTracksStopped: number }).__microphoneTracksStopped)).toBe(1)
  await expect(dialog.getByRole('checkbox', { name: /use fictional details only/i })).toBeVisible()
})

test('keeps Enter Room amber and disabled until Redis setup and the patient portrait are ready', async ({ page }) => {
  const sessionId = 's'.repeat(43)
  const versionPins = {
    promptVersion: 'patient-scenario-prompt-v1',
    modelVersion: 'gpt-6-luna',
    schemaVersion: 1,
    policyVersion: 'patient-scenario-policy-v1'
  }
  let releasePortrait: (() => void) | undefined
  const portraitGate = new Promise<void>((resolve) => { releasePortrait = resolve })

  await page.route('**/api/account/tenants', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ tenantIds: ['tenant-test'] })
  }))
  await page.route('**/api/sessions', async (route) => route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({
      sessionId,
      status: 'initializing',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
      versions: versionPins
    })
  }))
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
  await page.route('**/assets/images/3039-average/01.png', async (route) => {
    await portraitGate
    await route.continue()
  })
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token',
    value: makeAuthCookie(),
    url: 'http://127.0.0.1:3002',
    sameSite: 'Lax'
  }])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/encounter')

  const dialog = page.getByRole('dialog', { name: 'Before you begin' })
  await dialog.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await dialog.getByRole('button', { name: 'Continue with transcript' }).click()
  await page.getByRole('button', { name: 'Create patient session' }).click()

  const readiness = page.getByRole('list', { name: 'Patient setup readiness' })
  const enterRoom = page.getByRole('button', { name: 'Enter Room' })
  await expect(page.getByText('Loading patient portrait')).toBeVisible()
  await expect(readiness.locator('li').nth(0)).toHaveAttribute('data-ready', 'true')
  await expect(readiness.locator('li').nth(1)).toHaveAttribute('data-ready', 'false')
  await expect(enterRoom).toBeDisabled()
  await expect(page.getByText('The patient is responding…')).toBeHidden()
  await page.screenshot({ path: '/tmp/gptmd-patient-setup-pending-desktop.png', fullPage: true })

  releasePortrait?.()
  await expect(enterRoom).toBeEnabled()
  await expect(page.getByText('Ready for interview')).toBeVisible()
  await page.screenshot({ path: '/tmp/gptmd-patient-setup-ready-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '/tmp/gptmd-patient-setup-ready-mobile.png', fullPage: true })
  await enterRoom.click()
  await expect(page.getByRole('textbox', { name: 'Your next question' })).toBeEnabled()
})
