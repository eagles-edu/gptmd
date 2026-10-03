import { expect, test } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'

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

test('preflight explains voice privacy and lets the learner choose transcript or voice conversation', async ({ page }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
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
  await expect(dialog.getByText(/browser may send speech to its recognition service/i)).toBeVisible()
  await page.screenshot({ path: '/tmp/gptmd-encounter-preflight-desktop.png', fullPage: false })

  await dialog.getByRole('radio', { name: /Voice conversation/ }).check()
  await expect(dialog.getByText(/browser may send speech to its recognition service/i)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Continue with voice' })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await expect(dialog.getByRole('button', { name: 'Continue with voice' })).toBeEnabled()
  await dialog.getByRole('button', { name: 'Continue with voice' }).click()
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
  const continueButton = mobileDialog.getByRole('button', { name: 'Continue with voice' })
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
  await mobileDialog.getByRole('button', { name: 'Continue with voice' }).click()
  await expect(mobileDialog).toBeHidden()
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

test('voice turns auto-send after seven seconds, wait for the patient, and render written replies as notes', async ({ page }) => {
  const sessionId = 'v'.repeat(43)
  const sessionResponse = {
    sessionId,
    status: 'initializing',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    versions: {
      promptVersion: 'patient-scenario-prompt-v1', modelVersion: 'gpt-6-luna',
      schemaVersion: 1, policyVersion: 'patient-scenario-policy-v1'
    }
  }
  const submittedTurns: Array<{ turnId: string; text: string }> = []
  await page.clock.install()
  await page.addInitScript(() => {
    type MockResult = ArrayLike<{ transcript: string }> & { isFinal: boolean }
    type MockRecognition = {
      onstart: (() => void) | null
      onresult: ((event: { resultIndex: number; results: ArrayLike<MockResult> }) => void) | null
      onerror: ((event: { error: string }) => void) | null
      onend: (() => void) | null
      start(): void
      stop(): void
      abort(): void
    }
    const pageWindow = window as Window & {
      __mockRecognition?: MockRecognition
      __recognitionStarts?: number
      __emitSpeechResults?: (transcripts: string[], resultIndex: number) => void
      __synthesizedReplies?: string[]
      __synthesizedSettings?: Array<{ volume: number; rate: number }>
      __holdSpeech?: boolean
      __finishSpeech?: () => void
    }
    class MockSpeechRecognition {
      onstart: (() => void) | null = null
      onresult: ((event: { resultIndex: number; results: ArrayLike<MockResult> }) => void) | null = null
      onerror: ((event: { error: string }) => void) | null = null
      onend: (() => void) | null = null
      start() {
        pageWindow.__mockRecognition = this
        pageWindow.__recognitionStarts = (pageWindow.__recognitionStarts ?? 0) + 1
        this.onstart?.()
      }
      stop() { this.onend?.() }
      abort() { this.onend?.() }
    }
    Object.defineProperty(window, 'SpeechRecognition', { configurable: true, value: MockSpeechRecognition })
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class {
      text: string
      lang = ''
      volume = 1
      rate = 1
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(text: string) { this.text = text }
    } })
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      speak: (utterance: { text: string; volume: number; rate: number; onend: (() => void) | null }) => {
        pageWindow.__synthesizedReplies ??= []
        pageWindow.__synthesizedReplies.push(utterance.text)
        pageWindow.__synthesizedSettings ??= []
        pageWindow.__synthesizedSettings.push({ volume: utterance.volume, rate: utterance.rate })
        pageWindow.__finishSpeech = () => utterance.onend?.()
        if (!pageWindow.__holdSpeech) pageWindow.__finishSpeech()
      },
      cancel: () => undefined
    } })
    pageWindow.__emitSpeechResults = (transcripts, resultIndex) => {
      const results = transcripts.map((transcript) => Object.assign([{ transcript }], { isFinal: true }))
      pageWindow.__mockRecognition?.onresult?.({ resultIndex, results })
    }
    pageWindow.__holdSpeech = true
  })
  await page.route('**/api/account/tenants', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ tenantIds: ['tenant-test'] })
  }))
  await page.route('**/api/sessions', (route) => route.fulfill({
    status: 201, contentType: 'application/json', body: JSON.stringify(sessionResponse)
  }))
  await page.route(`**/api/sessions/${sessionId}/setup`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      sessionId,
      status: 'ready',
      createdAt: '2026-10-01T00:01:00.000Z',
      patient: { fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average', reasonForVisit: 'Pelvic pain' },
      versions: sessionResponse.versions,
      readiness: { profile: true, redis: true, conversation: true }
    })
  }))
  await page.route('**/api/sessions/*/turns', async (route) => {
    submittedTurns.push(route.request().postDataJSON() as { turnId: string; text: string })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ turnId: submittedTurns.at(-1)?.turnId, text: 'Since yesterday.' }) })
  })
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token', value: makeAuthCookie(), url: 'http://127.0.0.1:3002', sameSite: 'Lax'
  }])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/encounter')
  const dialog = page.getByRole('dialog', { name: 'Before you begin' })
  await dialog.getByRole('radio', { name: /Voice conversation/ }).check()
  await expect(dialog.getByText(/browser may send speech to its recognition service/i)).toBeVisible()
  await dialog.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await dialog.getByRole('button', { name: 'Continue with voice' }).click()
  await page.getByRole('button', { name: 'Create patient session' }).click()
  await page.getByRole('button', { name: 'Enter Room' }).click()

  const repairGuide = page.getByRole('region', { name: 'Conversation repair sequence' })
  await expect(repairGuide.locator('li')).toHaveText([
    'Ask the patient to repeat it. Ask again as many as three or four times if needed.',
    'Ask them to speak louder, slower, or more simply.',
    'Ask what an unfamiliar word or phrase means, or ask them to explain it another way.',
    'Ask them to spell the word or phrase.',
    'If those steps do not work, ask them to write it down in English. Keep the original wording and download it to take home.'
  ])
  await page.getByRole('button', { name: 'Start voice conversation' }).click()
  await expect(page.locator('.speech-message')).toContainText(/listening/i)
  await expect(page.getByRole('button', { name: 'Send question' })).toHaveCount(0)
  await page.evaluate(() => (window as Window & { __emitSpeechResults: (transcripts: string[], resultIndex: number) => void }).__emitSpeechResults(['When did the pain begin?'], 0))
  await page.evaluate(() => (window as Window & { __mockRecognition?: { onend?: () => void } }).__mockRecognition?.onend?.())

  await page.clock.fastForward(6_999)
  expect(submittedTurns).toHaveLength(0)
  await page.clock.fastForward(1)
  await expect(page.getByText('When did the pain begin?')).toBeVisible()
  await expect(page.getByText('Since yesterday.')).toBeVisible()
  await expect.poll(() => page.evaluate(() => (window as Window & { __synthesizedReplies?: string[] }).__synthesizedReplies)).toEqual(['Since yesterday.'])
  await expect(page.locator('.status-row [role="status"]')).toContainText(/patient speaking.*wait for the green light/i)
  const startsWhilePatientSpeaks = await page.evaluate(() => (window as Window & { __recognitionStarts?: number }).__recognitionStarts)
  await page.clock.fastForward(2_000)
  expect(await page.evaluate(() => (window as Window & { __recognitionStarts?: number }).__recognitionStarts)).toBe(startsWhilePatientSpeaks)

  await page.evaluate(() => (window as Window & { __finishSpeech?: () => void }).__finishSpeech?.())
  await expect(page.locator('.status-row [role="status"]')).toContainText(/green light.*your turn/i)
  await page.clock.fastForward(350)
  await page.evaluate(() => (window as Window & { __emitSpeechResults: (transcripts: string[], resultIndex: number) => void }).__emitSpeechResults(['Excuse me. Please write that down.'], 0))
  await page.evaluate(() => (window as Window & { __mockRecognition?: { onend?: () => void } }).__mockRecognition?.onend?.())
  await page.clock.fastForward(7_000)
  await expect.poll(() => submittedTurns.length).toBe(1)
  await expect(page.getByText('Patient · written note').first()).toBeVisible()
  await expect(page.locator('.message-patient').last()).toContainText('Since yesterday.')
  const noteDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download note to take home' }).click()
  const download = await noteDownload
  expect(download.suggestedFilename()).toBe('gptmd-patient-note.txt')
  const downloadedPath = await download.path()
  expect(downloadedPath).not.toBeNull()
  expect(await readFile(downloadedPath!, 'utf8')).toBe('Since yesterday.')
  await expect(page.getByRole('button', { name: 'Send question' })).toHaveCount(0)
  await page.screenshot({ path: '/tmp/gptmd-voice-input-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  const endVoiceConversation = page.getByRole('button', { name: 'End voice conversation' })
  await endVoiceConversation.scrollIntoViewIfNeeded()
  await expect(endVoiceConversation).toBeInViewport()
  await page.screenshot({ path: '/tmp/gptmd-voice-input-mobile.png', fullPage: true })
  await endVoiceConversation.click()
  await expect(page.locator('.speech-message')).toContainText(/voice conversation ended/i)
  expect(submittedTurns).toHaveLength(2)
  expect(submittedTurns[0]?.text).toBe('When did the pain begin?')
  expect(submittedTurns[0]?.text).not.toContain('Please write that down')
  expect(submittedTurns[1]?.text).toBe('Excuse me. Please write that down.')
})

test('voice conversation falls back to transcript when speech recognition is unsupported', async ({ page }) => {
  const sessionId = 'u'.repeat(43)
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'SpeechRecognition')
  })
  await page.route('**/api/account/tenants', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ tenantIds: ['tenant-test'] })
  }))
  await page.route('**/api/sessions', (route) => route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({
      sessionId, status: 'initializing', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
      versions: { promptVersion: 'patient-scenario-prompt-v1', modelVersion: 'gpt-6-luna', schemaVersion: 1, policyVersion: 'patient-scenario-policy-v1' }
    })
  }))
  await page.route(`**/api/sessions/${sessionId}/setup`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      sessionId, status: 'ready', createdAt: '2026-10-01T00:01:00.000Z',
      patient: { fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average', reasonForVisit: 'Pelvic pain' },
      versions: { promptVersion: 'patient-scenario-prompt-v1', modelVersion: 'gpt-6-luna', schemaVersion: 1, policyVersion: 'patient-scenario-policy-v1' },
      readiness: { profile: true, redis: true, conversation: true }
    })
  }))
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token', value: makeAuthCookie(), url: 'http://127.0.0.1:3002', sameSite: 'Lax'
  }])
  await page.goto('/encounter')
  const dialog = page.getByRole('dialog', { name: 'Before you begin' })
  await dialog.getByRole('radio', { name: /Voice conversation/ }).check()
  await dialog.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await dialog.getByRole('button', { name: 'Continue with voice' }).click()
  await page.getByRole('button', { name: 'Create patient session' }).click()
  await page.getByRole('button', { name: 'Enter Room' }).click()
  await page.getByRole('button', { name: 'Start voice conversation' }).click()
  await expect(page.locator('.api-error')).toContainText(/voice recognition is unavailable/i)
  await page.getByRole('textbox', { name: 'Your next question' }).fill('I can still type my question.')
  await expect(page.getByRole('button', { name: 'Send question' })).toBeEnabled()
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
  await dialog.getByRole('button', { name: 'Continue with voice' }).click()
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
  await expect(page.locator('.status-row [role="status"]')).toContainText(/red light.*enter the room/i)
  await page.screenshot({ path: '/tmp/gptmd-patient-setup-ready-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: '/tmp/gptmd-patient-setup-ready-mobile.png', fullPage: true })
  await enterRoom.click()
  await expect(page.locator('.status-row [role="status"]')).toContainText(/red light.*voice conversation inactive/i)
  await expect(page.getByRole('button', { name: 'Start voice conversation' })).toBeEnabled()
})
