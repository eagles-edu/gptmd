import { expect, test } from '@playwright/test'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import { TEST_LEARNER_CHART_VITAL_SIGNS } from '../fixtures/patient-vital-signs.ts'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/encounters/current', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ encounter: null })
  }))
})

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

test('resumes a saved encounter and sends the next turn through its existing session', async ({ page }) => {
  const sessionId = 'u'.repeat(43)
  const currentReads: string[] = []
  let createSessionRequests = 0
  let setupRequests = 0
  const submittedTurns: Array<{ pathname: string; body: { turnId: string; text: string; modality: string } }> = []
  await page.route('**/api/account/tenants', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ memberships: [{ tenantId: 'tenant-test', role: 'learner' }] })
  }))
  await page.route('**/api/encounters/current', async (route) => {
    currentReads.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        encounter: {
          sessionId,
          status: 'active',
          createdAt: '2026-10-01T00:00:00.000Z',
          updatedAt: '2026-10-01T00:05:00.000Z',
          versions: { promptVersion: 'patient-scenario-prompt-v10', modelVersion: 'gpt-6-luna', schemaVersion: 7, policyVersion: 'patient-scenario-policy-v3' },
          patient: { fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average', reasonForVisit: 'Pelvic pain', vitalSigns: TEST_LEARNER_CHART_VITAL_SIGNS },
          phase: 'history',
          currentTurnSequence: 1,
          transcript: [{
            turnId: 'turn-resumed-1',
            sequence: 1,
            acceptedAt: '2026-10-01T00:04:00.000Z',
            phase: 'history',
            learnerModality: 'typed',
            learnerMessage: 'When did the pain start?',
            patientResponse: 'It began yesterday afternoon.'
          }],
          localUtterances: [{
            utteranceId: 'repair-resumed-1', ordinal: 1, sequence: 1, kind: 'repair', speaker: 'learner',
            phase: 'history', modality: 'realtime_transcription', content: 'Could you repeat that?',
            occurredAt: '2026-10-01T00:04:30.000Z'
          }],
          assessmentDraft: null,
          assessment: null
        }
      })
    })
  })
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() === 'POST' && new URL(route.request().url()).pathname === '/api/sessions') {
      createSessionRequests += 1
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Resume must not create a session' }) })
      return
    }
    await route.fallback()
  })
  await page.route(`**/api/sessions/${sessionId}/setup`, async (route) => {
    setupRequests += 1
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Resume must not rerun setup' }) })
  })
  await page.route('**/api/sessions/*/turns', async (route) => {
    const body = route.request().postDataJSON() as { turnId: string; text: string; modality: string }
    submittedTurns.push({ pathname: new URL(route.request().url()).pathname, body })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ turnId: body.turnId, text: 'It feels like a dull ache.' }) })
  })
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token', value: makeAuthCookie(), url: 'https://localhost:3002', sameSite: 'Lax'
  }])

  await page.goto('/encounter', { waitUntil: 'domcontentloaded' })
  const recoveryDialog = page.getByRole('dialog', { name: 'A visit is in progress' })
  await expect(recoveryDialog).toContainText('Resume this visit with 1 saved question-and-answer pair')
  await recoveryDialog.getByRole('button', { name: 'Resume visit' }).click()

  const preflightDialog = page.getByRole('dialog', { name: 'Before you begin' })
  await expect(preflightDialog).toBeVisible()
  await preflightDialog.getByRole('radio', { name: /Transcript/ }).check()
  await preflightDialog.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await preflightDialog.getByRole('button', { name: 'Continue with transcript' }).click()
  await page.getByRole('button', { name: 'Enter Room' }).click()

  await expect(page.getByRole('tab', { name: 'Chart' })).toHaveAttribute('aria-selected', 'true')
  const chart = page.getByRole('tabpanel', { name: 'Chart' })
  await expect(chart).toContainText('Ari Nguyen')
  await expect(chart).toContainText('Pelvic pain')
  await expect(chart).toContainText('Vital signs')
  await page.getByRole('tab', { name: 'Interview' }).click()
  const transcript = page.locator('.transcript')
  await expect(transcript).toContainText('When did the pain start?')
  await expect(transcript).toContainText('It began yesterday afternoon.')
  await expect(transcript).toContainText('Could you repeat that?')
  const transcriptItems = await transcript.locator('.message').allTextContents()
  expect(transcriptItems.findIndex((item) => item.includes('It began yesterday afternoon.')))
    .toBeLessThan(transcriptItems.findIndex((item) => item.includes('Could you repeat that?')))

  await page.getByRole('textbox', { name: 'Your next question' }).fill('Does anything make the pain worse?')
  await page.getByRole('button', { name: 'Send question' }).click()
  await expect(transcript).toContainText('It feels like a dull ache.')
  expect(currentReads).toEqual(['GET /api/encounters/current'])
  expect(createSessionRequests).toBe(0)
  expect(setupRequests).toBe(0)
  expect(submittedTurns).toHaveLength(1)
  expect(submittedTurns[0]?.pathname).toBe(`/api/sessions/${sessionId}/turns`)
  expect(submittedTurns[0]?.body).toMatchObject({ text: 'Does anything make the pain worse?', modality: 'typed' })
})

test('transient setup retry reuses the same owned session and idempotency key', async ({ page }) => {
  const sessionId = 'r'.repeat(43)
  const setupKeys: string[] = []
  const lookupPaths: string[] = []
  let createSessionCount = 0
  let setupAttemptCount = 0
  await page.route('**/api/account/tenants', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ memberships: [{ tenantId: 'tenant-test', role: 'learner' }] })
  }))
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() === 'POST' && new URL(route.request().url()).pathname.endsWith('/api/sessions')) {
      createSessionCount += 1
    }
    await route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({ sessionId, status: 'initializing', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', versions: { promptVersion: 'patient-scenario-prompt-v10', modelVersion: 'gpt-6-luna', schemaVersion: 7, policyVersion: 'patient-scenario-policy-v3' } })
    })
  })
  await page.route(`**/api/sessions/${sessionId}`, (route) => {
    lookupPaths.push(`${route.request().method()} ${route.request().url()}`)
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ sessionId, status: 'initializing', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', versions: { promptVersion: 'patient-scenario-prompt-v10', modelVersion: 'gpt-6-luna', schemaVersion: 7, policyVersion: 'patient-scenario-policy-v3' } })
    })
  })
  await page.route(`**/api/sessions/${sessionId}/setup`, async (route) => {
    setupAttemptCount += 1
    setupKeys.push(route.request().headers()['idempotency-key'] ?? '')
    if (setupAttemptCount === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Setup queue is full' }) })
      return
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ sessionId, status: 'ready', createdAt: '2026-10-01T00:01:00.000Z', patient: { fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average', reasonForVisit: 'Pelvic pain', vitalSigns: TEST_LEARNER_CHART_VITAL_SIGNS }, versions: { promptVersion: 'patient-scenario-prompt-v10', modelVersion: 'gpt-6-luna', schemaVersion: 7, policyVersion: 'patient-scenario-policy-v3' }, readiness: { profile: true, redis: true, conversation: true } })
    })
  })
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token', value: makeAuthCookie(), url: 'https://localhost:3002', sameSite: 'Lax'
  }])
  await page.goto('/encounter', { waitUntil: 'domcontentloaded' })
  const retryButton = page.getByRole('button', { name: 'Retry patient setup' })
  await expect(retryButton).toBeVisible()
  await retryButton.click()
  await expect(page.getByRole('dialog', { name: 'Before you begin' })).toBeVisible()

  expect(createSessionCount).toBe(1)
  expect(lookupPaths).toHaveLength(1)
  const sessionLookup = lookupPaths[0] ?? ''
  expect(sessionLookup).toMatch(/^GET https?:\/\/127\.0\.0\.1:4000\/api\/sessions\//)
  expect(new URL(sessionLookup.slice(4)).pathname).toBe(`/api/sessions/${sessionId}`)
  expect(setupAttemptCount).toBe(2)
  expect(setupKeys).toEqual([`scenario-setup-${sessionId}`, `scenario-setup-${sessionId}`])
})

test('terminal setup retry creates a fresh session and setup idempotency key', async ({ page }) => {
  const firstSessionId = 'f'.repeat(43)
  const secondSessionId = 'n'.repeat(43)
  const createdSessionIds: string[] = []
  const setupSessionIds: string[] = []
  const setupKeys: string[] = []
  const lookups: Array<{ sessionId: string; status: string }> = []

  await page.route('**/api/account/tenants', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ memberships: [{ tenantId: 'tenant-test', role: 'learner' }] })
  }))
  await page.route('**/api/sessions', async (route) => {
    if (route.request().method() !== 'POST' || !new URL(route.request().url()).pathname.endsWith('/api/sessions')) {
      await route.fallback()
      return
    }

    const sessionId = createdSessionIds.length === 0 ? firstSessionId : secondSessionId
    createdSessionIds.push(sessionId)
    await route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({ sessionId, status: 'initializing', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', versions: { promptVersion: 'patient-scenario-prompt-v10', modelVersion: 'gpt-6-luna', schemaVersion: 7, policyVersion: 'patient-scenario-policy-v3' } })
    })
  })
  await page.route(`**/api/sessions/${firstSessionId}`, (route) => {
    lookups.push({ sessionId: firstSessionId, status: 'failed' })
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ sessionId: firstSessionId, status: 'failed', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:01:00.000Z', versions: { promptVersion: 'patient-scenario-prompt-v10', modelVersion: 'gpt-6-luna', schemaVersion: 7, policyVersion: 'patient-scenario-policy-v3' } })
    })
  })
  await page.route(`**/api/sessions/${firstSessionId}/setup`, async (route) => {
    setupSessionIds.push(firstSessionId)
    setupKeys.push(route.request().headers()['idempotency-key'] ?? '')
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Setup could not be completed' }) })
  })
  await page.route(`**/api/sessions/${secondSessionId}/setup`, async (route) => {
    setupSessionIds.push(secondSessionId)
    setupKeys.push(route.request().headers()['idempotency-key'] ?? '')
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ sessionId: secondSessionId, status: 'ready', createdAt: '2026-10-01T00:02:00.000Z', patient: { fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average', reasonForVisit: 'Pelvic pain', vitalSigns: TEST_LEARNER_CHART_VITAL_SIGNS }, versions: { promptVersion: 'patient-scenario-prompt-v10', modelVersion: 'gpt-6-luna', schemaVersion: 7, policyVersion: 'patient-scenario-policy-v3' }, readiness: { profile: true, redis: true, conversation: true } })
    })
  })
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token', value: makeAuthCookie(), url: 'https://localhost:3002', sameSite: 'Lax'
  }])

  await page.goto('/encounter', { waitUntil: 'domcontentloaded' })
  const retryButton = page.getByRole('button', { name: 'Retry patient setup' })
  await expect(retryButton).toBeVisible()
  await retryButton.click()
  await expect(page.getByRole('dialog', { name: 'Before you begin' })).toBeVisible()

  expect(createdSessionIds).toEqual([firstSessionId, secondSessionId])
  expect(lookups).toEqual([{ sessionId: firstSessionId, status: 'failed' }])
  expect(setupSessionIds).toEqual([firstSessionId, secondSessionId])
  expect(setupKeys).toEqual([`scenario-setup-${firstSessionId}`, `scenario-setup-${secondSessionId}`])
})

test('preflight explains voice privacy and lets the learner choose transcript or voice conversation', async ({ page }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  const setupRequests: string[] = []
  const sessionId = 'p'.repeat(43)
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop: () => undefined }] })
    } })
  })
  await page.route('**/api/account/tenants', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ memberships: [{ tenantId: 'tenant-test', role: 'learner' }] })
  }))
  await page.route('**/api/sessions', async (route) => {
    setupRequests.push('session')
    await route.fulfill({
      status: 201, contentType: 'application/json',
      body: JSON.stringify({ sessionId, status: 'initializing', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', versions: { promptVersion: 'patient-scenario-prompt-v10', modelVersion: 'gpt-6-luna', schemaVersion: 7, policyVersion: 'patient-scenario-policy-v3' } })
    })
  })
  await page.route(`**/api/sessions/${sessionId}/setup`, async (route) => {
    setupRequests.push('setup')
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ sessionId, status: 'ready', createdAt: '2026-10-01T00:01:00.000Z', patient: { fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average', reasonForVisit: 'Pelvic pain', vitalSigns: TEST_LEARNER_CHART_VITAL_SIGNS }, versions: { promptVersion: 'patient-scenario-prompt-v10', modelVersion: 'gpt-6-luna', schemaVersion: 7, policyVersion: 'patient-scenario-policy-v3' }, readiness: { profile: true, redis: true, conversation: true } })
    })
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token',
    value: makeAuthCookie(),
    url: 'https://localhost:3002',
    sameSite: 'Lax'
  }])
  await page.goto('/encounter', { waitUntil: 'domcontentloaded' })
  const dialog = page.getByRole('dialog', { name: 'Before you begin' })
  await expect(page).toHaveURL(/\/encounter$/)
  await expect(dialog).toBeVisible()
  await page.waitForTimeout(300)
  await expect(dialog.getByText(/local storage is not a secure session vault/)).toBeVisible()
  await expect(dialog.getByText(/your microphone audio goes to OpenAI Realtime for transcription only/i)).toBeVisible()
  await expect(dialog.getByText(/patient reply audio is not sent to OpenAI/i)).toBeVisible()
  await page.screenshot({ path: '/tmp/gptmd-encounter-preflight-desktop.png', fullPage: false })

  await dialog.getByRole('radio', { name: /Voice conversation/ }).check()
  await expect(dialog.getByText(/your microphone audio goes to OpenAI Realtime for transcription only/i)).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Continue with voice' })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await expect(dialog.getByRole('button', { name: 'Continue with voice' })).toBeDisabled()
  await dialog.getByRole('checkbox', { name: /send my microphone audio to OpenAI/i }).check()
  await expect(dialog.getByRole('button', { name: 'Continue with voice' })).toBeDisabled()
  await dialog.getByRole('button', { name: 'Allow microphone access' }).click()
  await expect(dialog.getByRole('button', { name: 'Continue with voice' })).toBeEnabled()
  expect(setupRequests).toEqual(['session', 'setup'])
  await dialog.getByRole('button', { name: 'Continue with voice' }).click()
  await expect(dialog).toBeHidden()
  await expect(page.getByRole('heading', { name: 'Clinical interview' })).toBeVisible()
  const patientPortrait = page.locator('.profile-image-wrap img')
  await expect(patientPortrait).toHaveAttribute('src', '/assets/images/3039-average/portrait-prototype.webp')
  await expect.poll(() => patientPortrait.evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const turnLightBounds = await page.locator('.status-dot').boundingBox()
  expect(turnLightBounds).not.toBeNull()
  expect(turnLightBounds!.width).toBeGreaterThan(12)
  expect(turnLightBounds!.height).toBeGreaterThan(12)
  await expect(page.locator('.intro')).toHaveCount(0)
  const encounterColumns = await Promise.all([
    page.locator('.conversation-card').boundingBox(),
    page.locator('.profile-card').boundingBox()
  ])
  expect(encounterColumns[0]).not.toBeNull()
  expect(encounterColumns[1]).not.toBeNull()
  expect(encounterColumns[0]!.x + encounterColumns[0]!.width).toBeLessThanOrEqual(encounterColumns[1]!.x)
  expect(Math.abs(encounterColumns[0]!.width - encounterColumns[1]!.width)).toBeLessThan(2)
  await expect(page.getByRole('button', { name: 'Enter Room' })).toBeEnabled()

  await page.setViewportSize({ width: 390, height: 844 })
  await page.reload()
  const mobileDialog = page.getByRole('dialog', { name: 'Before you begin' })
  await expect(mobileDialog).toBeVisible()
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  const storageExplanation = mobileDialog.getByText(/local storage is not a secure session vault/)
  await storageExplanation.evaluate((element) => element.scrollIntoView({ block: 'start', inline: 'nearest' }))
  await expect(storageExplanation).toBeInViewport()
  const consentCheckbox = mobileDialog.getByRole('checkbox', { name: /send my microphone audio to OpenAI/i })
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
  await mobileDialog.getByRole('checkbox', { name: /send my microphone audio to OpenAI/i }).check()
  await mobileDialog.getByRole('button', { name: 'Allow microphone access' }).click()
  await mobileDialog.getByRole('button', { name: 'Continue with voice' }).click()
  await expect(mobileDialog).toBeHidden()
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

test('voice turns auto-send after seven seconds, confirm spoken phase changes, and render written replies as notes', async ({ page }) => {
  // This covers several timed voice turns plus a mobile WebKit full-page screenshot.
  test.setTimeout(60_000)
  const sessionId = 'v'.repeat(43)
  const sessionResponse = {
    sessionId,
    status: 'initializing',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    versions: {
      promptVersion: 'patient-scenario-prompt-v10', modelVersion: 'gpt-6-luna',
      schemaVersion: 7, policyVersion: 'patient-scenario-policy-v3'
    }
  }
  const submittedTurns: Array<{ turnId: string; text: string; modality: string }> = []
  const savedLocalUtterances: Array<{ utteranceId: string; kind: string; speaker: string; content: string }> = []
  let assessmentTransitions = 0
  await page.clock.install()
  await page.addInitScript(() => {
    const pageWindow = window as Window & {
      __mockTranscriptionChannel?: { onmessage?: (event: { data: string }) => void }
      __emitFinalTranscript?: (transcript: string) => void
      __synthesizedReplies?: string[]
      __synthesizedSettings?: Array<{ volume: number; rate: number }>
      __holdSpeech?: boolean
      __startSpeech?: () => void
      __finishSpeech?: () => void
      __mockMicrophoneTrack?: { enabled: boolean }
      __mockAudioTrackAdds?: number
      __mockMicrophoneRms?: number
      __realtimeClientEvents?: string[]
      __setMicrophoneRms?: (rms: number) => void
      __deferNextRealtimeOpen?: boolean
      __openDeferredRealtime?: () => void
    }
    class MockTrack {
      enabled = true
      addEventListener() {}
      stop() { this.enabled = false }
    }
    class MockDataChannel {
      readyState = 'open'
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      addEventListener() {}
      close() { this.readyState = 'closed' }
      send(data: string) {
        pageWindow.__realtimeClientEvents ??= []
        pageWindow.__realtimeClientEvents.push(data)
      }
    }
    class MockPeerConnection extends EventTarget {
      iceGatheringState = 'complete'
      localDescription: { type: string; sdp: string } | null = null
      private channel: MockDataChannel | undefined
      createDataChannel() {
        const channel = new MockDataChannel()
        this.channel = channel
        pageWindow.__mockTranscriptionChannel = channel
        return channel
      }
      addTrack() { pageWindow.__mockAudioTrackAdds = (pageWindow.__mockAudioTrackAdds ?? 0) + 1 }
      async createOffer() { return { type: 'offer', sdp: 'mock-offer' } }
      async setLocalDescription(description: { type: string; sdp: string }) { this.localDescription = description }
      async setRemoteDescription() {
        if (pageWindow.__deferNextRealtimeOpen) {
          pageWindow.__deferNextRealtimeOpen = false
          pageWindow.__openDeferredRealtime = () => this.channel?.onopen?.()
          return
        }
        this.channel?.onopen?.()
      }
      close() {}
    }
    Object.defineProperty(window, 'RTCPeerConnection', { configurable: true, value: MockPeerConnection })
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => {
        const track = new MockTrack()
        pageWindow.__mockMicrophoneTrack = track
        return { getAudioTracks: () => [track], getTracks: () => [track] }
      }
    } })
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: class {
      createAnalyser() {
        return {
          fftSize: 512,
          getByteTimeDomainData: (samples: Uint8Array) => {
            const sample = 128 + Math.round((pageWindow.__mockMicrophoneRms ?? 0) * 128)
            samples.fill(sample)
          }
        }
      }
      createMediaStreamSource() { return { connect: () => undefined } }
      close() { return Promise.resolve() }
    } })
    pageWindow.__setMicrophoneRms = (rms) => { pageWindow.__mockMicrophoneRms = rms }
    pageWindow.__emitFinalTranscript = (transcript) => {
      pageWindow.__mockTranscriptionChannel?.onmessage?.({
        data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript })
      })
    }
    Object.defineProperty(window, 'SpeechSynthesisUtterance', { configurable: true, value: class {
      text: string
      lang = ''
      volume = 1
      rate = 1
      onstart: (() => void) | null = null
      onend: (() => void) | null = null
      onerror: (() => void) | null = null
      constructor(text: string) { this.text = text }
    } })
    Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: {
      speak: (utterance: { text: string; volume: number; rate: number; onstart: (() => void) | null; onend: (() => void) | null }) => {
        pageWindow.__synthesizedReplies ??= []
        pageWindow.__synthesizedReplies.push(utterance.text)
        pageWindow.__synthesizedSettings ??= []
        pageWindow.__synthesizedSettings.push({ volume: utterance.volume, rate: utterance.rate })
        pageWindow.__startSpeech = () => utterance.onstart?.()
        pageWindow.__finishSpeech = () => utterance.onend?.()
        if (!pageWindow.__holdSpeech) {
          pageWindow.__startSpeech()
          pageWindow.__finishSpeech()
        }
      },
      cancel: () => undefined
    } })
    pageWindow.__holdSpeech = true
  })
  await page.route('**/api/account/tenants', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ memberships: [{ tenantId: 'tenant-test', role: 'learner' }] })
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
      patient: { fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average', reasonForVisit: 'Pelvic pain', vitalSigns: TEST_LEARNER_CHART_VITAL_SIGNS },
      versions: sessionResponse.versions,
      readiness: { profile: true, redis: true, conversation: true }
    })
  }))
  await page.route('**/api/sessions/*/local-utterances', async (route) => {
    const request = route.request().postDataJSON() as { utteranceId: string; kind: string; speaker: string; content: string }
    savedLocalUtterances.push(request)
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ...request,
        ordinal: savedLocalUtterances.length,
        sequence: submittedTurns.length,
        phase: 'history',
        modality: request.speaker === 'patient' ? 'text' : 'realtime_transcription',
        occurredAt: new Date().toISOString()
      })
    })
  })
  await page.route('**/api/sessions/*/turns', async (route) => {
    submittedTurns.push(route.request().postDataJSON() as { turnId: string; text: string; modality: string })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ turnId: submittedTurns.at(-1)?.turnId, text: 'Since yesterday.' }) })
  })
  await page.route('**/api/sessions/*/assessment-phase', async (route) => {
    assessmentTransitions += 1
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ sessionId, phase: 'assessment' })
    })
  })
  await page.route('**/api/sessions/*/audio-transcription', (route) => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ answerSdp: 'mock-answer', maxDurationSeconds: 900 })
  }))
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token', value: makeAuthCookie(), url: 'https://localhost:3002', sameSite: 'Lax'
  }])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/encounter')
  const dialog = page.getByRole('dialog', { name: 'Before you begin' })
  await dialog.getByRole('radio', { name: /Voice conversation/ }).check()
  await expect(dialog.getByText(/your microphone audio goes to OpenAI Realtime for transcription only/i)).toBeVisible()
  await dialog.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await dialog.getByRole('checkbox', { name: /send my microphone audio to OpenAI/i }).check()
  await dialog.getByRole('button', { name: 'Allow microphone access' }).click()
  await dialog.getByRole('button', { name: 'Continue with voice' }).click()
  await page.evaluate(() => { (window as Window & { __deferNextRealtimeOpen?: boolean }).__deferNextRealtimeOpen = true })
  await page.getByRole('button', { name: 'Enter Room' }).click()
  await expect(page.getByRole('tab', { name: 'Chart' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('chart-current-pulse')).toContainText('76 bpm')
  const chart = page.getByRole('tabpanel', { name: 'Chart' })
  await expect(chart).not.toContainText('Lung auscultation')
  await expect(chart).not.toContainText('Skin blanching')
  await expect(chart).not.toContainText('irregular')
  await expect(chart).not.toContainText('regular')
  await expect(chart).not.toContainText('Blood pressure · supine orthostatic')
  await expect(chart).toContainText('Blood pressure · sitting')
  await expect(chart).toContainText('Respiratory rate')
  await expect(chart).toContainText('Temperature · oral')
  await expect(chart).toContainText('Vital signs')
  await page.getByRole('tab', { name: 'Interview' }).click()
  const turnLed = page.locator('.status-row .status-dot')
  await expect(turnLed).toHaveClass(/status-processing/)

  const repairGuide = page.getByRole('region', { name: 'Conversation repair sequence' })
  await expect(repairGuide.locator('li')).toHaveText([
    'Ask the patient to repeat it. Ask again as many as three or four times if needed.',
    'Ask them to speak louder, slower, or more simply.',
    'Ask what an unfamiliar word or phrase means, or ask them to explain it another way.',
    'Ask them to spell the word or phrase.',
    'If those steps do not work, ask them to write it down in English. Keep the original wording and download it to take home.'
  ])
  await page.evaluate(() => (window as Window & { __openDeferredRealtime?: () => void }).__openDeferredRealtime?.())
  await expect(page.locator('.speech-message')).toContainText(/listening/i)
  await expect(turnLed).toHaveClass(/status-listening/)
  await expect.poll(() => page.evaluate(() => (window as Window & { __mockAudioTrackAdds?: number }).__mockAudioTrackAdds)).toBe(1)
  await expect(page.getByRole('button', { name: 'Send question' })).toHaveCount(0)
  await page.evaluate(() => (window as Window & { __setMicrophoneRms: (rms: number) => void }).__setMicrophoneRms(0.12))
  await page.clock.fastForward(100)
  await page.evaluate(() => (window as Window & { __setMicrophoneRms: (rms: number) => void }).__setMicrophoneRms(0))
  await page.clock.fastForward(1_000)
  const audioCommitEvents = await page.evaluate(() => (window as Window & { __realtimeClientEvents?: string[] }).__realtimeClientEvents ?? [])
  expect(audioCommitEvents.map((event) => JSON.parse(event))).toContainEqual({ type: 'input_audio_buffer.commit' })
  await page.evaluate(() => (window as Window & { __emitFinalTranscript: (transcript: string) => void }).__emitFinalTranscript('When did the pain begin?'))

  await page.clock.fastForward(7_000)
  await expect.poll(() => submittedTurns.length).toBe(1)
  await expect(page.getByText('When did the pain begin?')).toBeVisible()
  await expect(page.getByText('Since yesterday.')).toBeVisible()
  const learnerTranscriptRow = page.locator('.message-doctor').filter({ hasText: 'When did the pain begin?' })
  const patientTranscriptRow = page.locator('.message-patient').filter({ hasText: 'Since yesterday.' })
  const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
  await expect(learnerTranscriptRow).toHaveAttribute('data-captured-at', timestampPattern)
  await expect(learnerTranscriptRow).toHaveAttribute('data-displayed-at', timestampPattern)
  await expect(patientTranscriptRow).toHaveAttribute('data-captured-at', timestampPattern)
  await expect(patientTranscriptRow).toHaveAttribute('data-displayed-at', timestampPattern)
  const transcriptTimes = await page.evaluate(() => Array.from(document.querySelectorAll('.message[data-captured-at][data-displayed-at]'))
    .slice(0, 2)
    .map((row) => ({ capturedAt: Date.parse(row.getAttribute('data-captured-at') ?? ''), displayedAt: Date.parse(row.getAttribute('data-displayed-at') ?? '') })))
  expect(transcriptTimes).toHaveLength(2)
  expect(transcriptTimes.every((time) => Number.isFinite(time.capturedAt) && time.displayedAt >= time.capturedAt)).toBe(true)
  await expect.poll(() => page.evaluate(() => (window as Window & { __synthesizedReplies?: string[] }).__synthesizedReplies)).toEqual(['Since yesterday.'])
  const encounter = page.locator('.encounter-page')
  await expect(encounter).toHaveAttribute('data-tts-requested-at', /^\d+(\.\d+)?$/)
  await expect(encounter).not.toHaveAttribute('data-tts-started-at', /.+/)
  await expect(page.locator('.status-row [role="status"]')).toContainText(/patient speaking.*wait for the green light/i)
  await expect(turnLed).toHaveClass(/status-processing/)
  await expect.poll(() => page.evaluate(() => (window as Window & { __mockMicrophoneTrack?: { enabled: boolean } }).__mockMicrophoneTrack?.enabled)).toBe(false)
  const startsWhilePatientSpeaks = await page.locator('.status-row [role="status"]').textContent()
  await page.clock.fastForward(2_000)
  expect(await page.locator('.status-row [role="status"]').textContent()).toBe(startsWhilePatientSpeaks)

  await page.evaluate(() => (window as Window & { __startSpeech?: () => void }).__startSpeech?.())
  await expect(encounter).toHaveAttribute('data-tts-started-at', /^\d+(\.\d+)?$/)
  await expect(encounter).not.toHaveAttribute('data-tts-ended-at', /.+/)
  await page.evaluate(() => (window as Window & { __finishSpeech?: () => void }).__finishSpeech?.())
  await expect(encounter).toHaveAttribute('data-tts-ended-at', /^\d+(\.\d+)?$/)
  const speechTimes = await encounter.evaluate((element) => ({
    requested: Number(element.getAttribute('data-tts-requested-at')),
    started: Number(element.getAttribute('data-tts-started-at')),
    ended: Number(element.getAttribute('data-tts-ended-at'))
  }))
  expect(speechTimes.requested).toBeLessThanOrEqual(speechTimes.started)
  expect(speechTimes.started).toBeLessThanOrEqual(speechTimes.ended)
  await expect(page.locator('.status-row [role="status"]')).toContainText(/green light.*your turn/i)
  await page.clock.fastForward(350)
  await expect(turnLed).toHaveClass(/status-listening/)
  await expect.poll(() => page.evaluate(() => (window as Window & { __mockMicrophoneTrack?: { enabled: boolean } }).__mockMicrophoneTrack?.enabled)).toBe(true)
  await page.evaluate(() => (window as Window & { __emitFinalTranscript: (transcript: string) => void }).__emitFinalTranscript('Excuse me. Repeat that please.'))
  await page.clock.fastForward(7_000)
  await expect.poll(() => page.evaluate(() => (window as Window & { __synthesizedReplies?: string[] }).__synthesizedReplies)).toEqual([
    'Since yesterday.', 'Since yesterday.'
  ])
  expect(submittedTurns).toHaveLength(1)
  await expect(page.locator('.status-row [role="status"]')).toContainText(/patient speaking.*wait for the green light/i)
  await page.evaluate(() => (window as Window & { __finishSpeech?: () => void }).__finishSpeech?.())
  await page.clock.fastForward(350)
  await page.evaluate(() => (window as Window & { __emitFinalTranscript: (transcript: string) => void }).__emitFinalTranscript('Excuse me. Please write that down.'))
  await page.clock.fastForward(7_000)
  await expect.poll(() => submittedTurns.length).toBe(2)
  expect(submittedTurns.map((turn) => turn.text)).toEqual([
    'When did the pain begin?',
    'Excuse me. Please write that down.'
  ])
  expect(submittedTurns.every((turn) => turn.modality === 'realtime_transcription')).toBe(true)
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
  await expect(turnLed).toHaveClass(/status-inactive/)
  await page.getByRole('button', { name: 'Start voice conversation' }).click()
  await page.evaluate(() => (window as Window & { __emitFinalTranscript: (transcript: string) => void }).__emitFinalTranscript('See you next time.'))
  await page.clock.fastForward(7_000)
  await expect(page.locator('.speech-message')).toContainText(/voice conversation ended/i)
  await expect(page.getByRole('button', { name: 'Start voice conversation' })).toBeEnabled()
  await expect(page.getByText('See you next time.', { exact: true })).toBeVisible()
  expect(submittedTurns).toHaveLength(2)
  await page.getByRole('button', { name: 'Start voice conversation' }).click()
  await expect(page.locator('.speech-message')).toContainText(/listening/i)
  await expect(turnLed).toHaveClass(/status-listening/)
  await page.clock.fastForward(900_000)
  await expect(page.locator('.speech-message')).toContainText(/15-minute voice limit was reached/i)
  await expect(page.getByRole('button', { name: 'Start voice conversation' })).toBeEnabled()
  expect(submittedTurns).toHaveLength(2)
  await page.getByRole('button', { name: 'Start voice conversation' }).click()
  await expect(turnLed).toHaveClass(/status-listening/)
  await page.evaluate(() => (window as Window & { __emitFinalTranscript: (transcript: string) => void }).__emitFinalTranscript('Could we start the written assessment now?'))
  await page.clock.fastForward(7_000)
  const voicePhaseConfirmation = page.getByRole('dialog', { name: 'Begin assessment?' })
  await expect(voicePhaseConfirmation).toBeVisible()
  await expect(voicePhaseConfirmation.getByText(/ends history taking/i)).toBeVisible()
  await page.clock.runFor(300)
  expect(submittedTurns).toHaveLength(2)
  expect(assessmentTransitions).toBe(0)
  await voicePhaseConfirmation.getByRole('button', { name: 'Begin assessment' }).click()
  await expect(page.getByLabel('Summary')).toBeVisible()
  expect(assessmentTransitions).toBe(1)
  expect(savedLocalUtterances.map(({ kind, content }) => ({ kind, content }))).toEqual([
    { kind: 'repair', content: 'Excuse me. Repeat that please.' },
    { kind: 'patient_repeat', content: 'Since yesterday.' },
    { kind: 'stop', content: 'See you next time.' },
    { kind: 'phase_transition', content: 'Could we start the written assessment now?' }
  ])
  expect(submittedTurns).toHaveLength(2)
  expect(submittedTurns[0]?.text).toBe('When did the pain begin?')
  expect(submittedTurns[0]?.text).not.toContain('Please write that down')
  expect(submittedTurns[1]?.text).toBe('Excuse me. Please write that down.')
})

test('Realtime channel loss flushes one finalized utterance and leaves transcript conversation usable', async ({ page }) => {
  const sessionId = 'r'.repeat(43)
  const submittedTurns: Array<{ turnId: string; text: string; modality: string }> = []
  await page.clock.install()
  await page.addInitScript(() => {
    const pageWindow = window as Window & {
      __mockRealtimeChannel?: EventTarget & { readyState: string; onopen?: (() => void) | null; onmessage?: ((event: { data: string }) => void) | null }
      __emitFinalTranscript?: (text: string) => void
      __closeRealtimeChannel?: () => void
      __failRealtimePeer?: () => void
      __mockAudioTracks?: Array<{ enabled: boolean; stopped: boolean }>
    }
    class MockTrack extends EventTarget {
      enabled = true
      stopped = false
      stop() {
        this.enabled = false
        this.stopped = true
        this.dispatchEvent(new Event('ended'))
      }
    }
    class MockDataChannel extends EventTarget {
      readyState = 'open'
      onopen: (() => void) | null = null
      onmessage: ((event: { data: string }) => void) | null = null
      send() {}
      close() {
        this.readyState = 'closed'
        this.dispatchEvent(new Event('close'))
      }
    }
    class MockPeerConnection extends EventTarget {
      static instances: MockPeerConnection[] = []
      connectionState = 'connected'
      iceGatheringState = 'complete'
      localDescription: { type: string; sdp: string } | null = null
      private channel?: MockDataChannel
      constructor() {
        super()
        MockPeerConnection.instances.push(this)
      }
      createDataChannel() {
        this.channel = new MockDataChannel()
        pageWindow.__mockRealtimeChannel = this.channel
        return this.channel
      }
      addTrack() {}
      async createOffer() { return { type: 'offer', sdp: 'mock-offer' } }
      async setLocalDescription(description: { type: string; sdp: string }) { this.localDescription = description }
      async setRemoteDescription() { this.channel?.onopen?.() }
      close() { this.dispatchEvent(new Event('close')) }
      fail() {
        this.connectionState = 'failed'
        this.dispatchEvent(new Event('connectionstatechange'))
      }
    }
    Object.defineProperty(window, 'RTCPeerConnection', { configurable: true, value: MockPeerConnection })
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => {
        const track = new MockTrack()
        pageWindow.__mockAudioTracks ??= []
        pageWindow.__mockAudioTracks.push(track)
        const tracks = [track]
        return { getAudioTracks: () => tracks, getTracks: () => tracks }
      }
    } })
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: class {
      createAnalyser() {
        return { fftSize: 512, getByteTimeDomainData: (samples: Uint8Array) => samples.fill(128) }
      }
      createMediaStreamSource() { return { connect: () => undefined } }
      close() { return Promise.resolve() }
    } })
    pageWindow.__emitFinalTranscript = (text) => pageWindow.__mockRealtimeChannel?.onmessage?.({
      data: JSON.stringify({ type: 'conversation.item.input_audio_transcription.completed', transcript: text })
    })
    pageWindow.__closeRealtimeChannel = () => pageWindow.__mockRealtimeChannel?.dispatchEvent(new Event('close'))
    pageWindow.__failRealtimePeer = () => {
      for (const peer of MockPeerConnection.instances) peer.fail()
    }
  })
  await page.route('**/api/account/tenants', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ memberships: [{ tenantId: 'tenant-test', role: 'learner' }] })
  }))
  await page.route('**/api/sessions', (route) => route.fulfill({
    status: 201, contentType: 'application/json', body: JSON.stringify({
      sessionId, status: 'initializing', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
      versions: { promptVersion: 'patient-scenario-prompt-v10', modelVersion: 'gpt-6-luna', schemaVersion: 7, policyVersion: 'patient-scenario-policy-v3' }
    })
  }))
  await page.route(`**/api/sessions/${sessionId}/setup`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      sessionId, status: 'ready', createdAt: '2026-10-01T00:01:00.000Z',
      patient: { fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average', reasonForVisit: 'Pelvic pain', vitalSigns: TEST_LEARNER_CHART_VITAL_SIGNS },
      versions: { promptVersion: 'patient-scenario-prompt-v10', modelVersion: 'gpt-6-luna', schemaVersion: 7, policyVersion: 'patient-scenario-policy-v3' },
      readiness: { profile: true, redis: true, conversation: true }
    })
  }))
  await page.route('**/api/sessions/*/audio-transcription', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ answerSdp: 'mock-answer', maxDurationSeconds: 900 })
  }))
  await page.route('**/api/sessions/*/turns', async (route) => {
    const turn = route.request().postDataJSON() as { turnId: string; text: string; modality: string }
    submittedTurns.push(turn)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ turnId: turn.turnId, text: 'Since yesterday.' }) })
  })
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token', value: makeAuthCookie(), url: 'https://localhost:3002', sameSite: 'Lax'
  }])

  await page.goto('/encounter')
  const preflight = page.getByRole('dialog', { name: 'Before you begin' })
  await preflight.getByRole('radio', { name: /Voice conversation/ }).check()
  await preflight.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await preflight.getByRole('checkbox', { name: /send my microphone audio to OpenAI/i }).check()
  await preflight.getByRole('button', { name: 'Allow microphone access' }).click()
  await preflight.getByRole('button', { name: 'Continue with voice' }).click()
  await page.getByRole('button', { name: 'Enter Room' }).click()
  await page.getByRole('tab', { name: 'Interview' }).click()
  const turnLed = page.locator('.status-row .status-dot')
  await expect(turnLed).toHaveClass(/status-listening/)
  await page.evaluate(() => (window as Window & { __emitFinalTranscript: (text: string) => void }).__emitFinalTranscript('When did the pain begin?'))
  await page.evaluate(() => (window as Window & { __closeRealtimeChannel: () => void }).__closeRealtimeChannel())

  await expect(page.locator('.api-error')).toContainText(/live transcription channel closed.*transcript mode is available instead/i)
  await expect.poll(() => submittedTurns.length).toBe(1)
  expect(submittedTurns).toMatchObject([{ text: 'When did the pain begin?', modality: 'realtime_transcription' }])
  await expect(page.getByRole('textbox', { name: 'Your next question' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send question' })).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => (window as Window & { __mockAudioTracks?: Array<{ stopped: boolean }> }).__mockAudioTracks?.at(-1)?.stopped)).toBe(true)

  await page.evaluate(() => {
    const testWindow = window as Window & { __closeRealtimeChannel: () => void; __failRealtimePeer: () => void }
    testWindow.__closeRealtimeChannel()
    testWindow.__failRealtimePeer()
  })
  await page.clock.fastForward(7_000)
  expect(submittedTurns).toHaveLength(1)
  await page.getByRole('textbox', { name: 'Your next question' }).fill('Are there other symptoms?')
  await page.getByRole('button', { name: 'Send question' }).click()
  await expect.poll(() => submittedTurns.length).toBe(2)
  expect(submittedTurns[1]).toMatchObject({ text: 'Are there other symptoms?', modality: 'typed' })
})

test('assessment phase is confirmed and keeps the draft editable after field validation errors', async ({ page }) => {
  const sessionId = 'a'.repeat(43)
  const sessionResponse = {
    sessionId,
    status: 'initializing',
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    versions: { promptVersion: 'patient-scenario-prompt-v10', modelVersion: 'gpt-6-luna', schemaVersion: 7, policyVersion: 'patient-scenario-policy-v3' }
  }
  let assessmentAttempts = 0
  let assessmentPhaseTransitions = 0
  await page.route('**/api/account/tenants', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ memberships: [{ tenantId: 'tenant-test', role: 'learner' }] }) }))
  await page.route('**/api/sessions', (route) => route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(sessionResponse) }))
  await page.route(`**/api/sessions/${sessionId}/setup`, (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({
      sessionId, status: 'ready', createdAt: '2026-10-01T00:01:00.000Z',
      patient: { fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average', reasonForVisit: 'Pelvic pain', vitalSigns: TEST_LEARNER_CHART_VITAL_SIGNS },
      versions: sessionResponse.versions, readiness: { profile: true, redis: true, conversation: true }
    })
  }))
  await page.route('**/api/sessions/*/turns', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ turnId: route.request().postDataJSON().turnId, text: 'Since yesterday.' })
  }))
  await page.route('**/api/sessions/*/assessment-phase', (route) => {
    assessmentPhaseTransitions += 1
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ sessionId, phase: 'assessment' }) })
  })
  await page.route('**/api/sessions/*/assessment-draft', async (route) => {
    const { revision, ...fields } = route.request().postDataJSON() as {
      revision: number
      summary: string
      differential: string
      rationale: string
      plan: string
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ revision, fields, updatedAt: '2026-10-01T00:02:00.000Z' })
    })
  })
  await page.route('**/api/sessions/*/assessment', async (route) => {
    assessmentAttempts += 1
    if (assessmentAttempts === 1) {
      await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: 'Complete each assessment field before submitting.', fieldErrors: { rationale: 'Enter at least 1 character.' } }) })
    } else {
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ assessmentId: route.request().postDataJSON().assessmentId, status: 'unscored', submittedAt: '2026-10-01T00:02:00.000Z' }) })
    }
  })
  await page.context().addCookies([{ name: 'sb-localhost-auth-token', value: makeAuthCookie(), url: 'https://localhost:3002', sameSite: 'Lax' }])
  await page.goto('/encounter')
  const preflight = page.getByRole('dialog', { name: 'Before you begin' })
  await preflight.getByRole('radio', { name: /Transcript/ }).check()
  await preflight.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await preflight.getByRole('button', { name: 'Continue with transcript' }).click()
  await page.getByRole('button', { name: 'Enter Room' }).click()
  await expect(page.getByRole('tab', { name: 'Chart' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Interview' }).click()
  await page.getByLabel('Your next question').fill('When did the pain begin?')
  await page.getByRole('button', { name: 'Send question' }).click()
  await expect(page.getByText('Since yesterday.')).toBeVisible()
  await page.getByRole('button', { name: 'Begin assessment' }).click()
  const confirm = page.getByRole('dialog', { name: 'Begin assessment?' })
  await expect(confirm.getByText(/ends history taking/i)).toBeVisible()
  await confirm.getByRole('button', { name: 'Begin assessment' }).click()
  await expect.poll(() => assessmentPhaseTransitions).toBe(1)
  await expect(page.getByLabel('Summary')).toBeVisible()
  await expect(confirm).toBeHidden()
  await page.getByLabel('Summary').fill('Acute pelvic pain since yesterday.')
  await page.getByLabel('Differential diagnosis').fill('Ovarian cyst; ectopic pregnancy.')
  await page.getByLabel('Clinical rationale').fill('')
  await page.getByLabel('Plan').fill('Obtain pregnancy testing and ultrasound.')
  await page.getByRole('button', { name: 'Submit unscored assessment' }).click()
  await expect(page.getByText('Enter at least 1 character.')).toBeVisible()
  await expect(page.getByLabel('Summary')).toHaveValue('Acute pelvic pain since yesterday.')
  await page.getByLabel('Clinical rationale').fill('Assess urgency and possible pregnancy-related causes.')
  await page.getByRole('button', { name: 'Submit unscored assessment' }).click()
  await expect(page.getByRole('heading', { name: 'Assessment submitted' })).toBeVisible()
  await expect(page.getByText(/recorded without a score/i)).toBeVisible()
  expect(assessmentAttempts).toBe(2)
})

test('restores and autosaves an unsubmitted assessment draft through the owner session', async ({ page }) => {
  const sessionId = 'd'.repeat(43)
  const draftFields = {
    summary: 'Pelvic pain began yesterday.',
    differential: '',
    rationale: 'Acute onset.',
    plan: ''
  }
  const saveRequests: Array<{ revision: number; summary: string; plan: string }> = []
  await page.route('**/api/account/tenants', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ memberships: [{ tenantId: 'tenant-test', role: 'learner' }] })
  }))
  await page.route('**/api/encounters/current', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ encounter: {
      sessionId,
      status: 'active',
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:05:00.000Z',
      versions: { promptVersion: 'patient-scenario-prompt-v10', modelVersion: 'gpt-6-luna', schemaVersion: 7, policyVersion: 'patient-scenario-policy-v3' },
      patient: { fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average', reasonForVisit: 'Pelvic pain', vitalSigns: TEST_LEARNER_CHART_VITAL_SIGNS },
      phase: 'assessment',
      currentTurnSequence: 1,
      transcript: [{
        turnId: 'turn-draft-restore', sequence: 1, acceptedAt: '2026-10-01T00:04:00.000Z',
        phase: 'history', learnerModality: 'typed', learnerMessage: 'When did the pain start?',
        patientResponse: 'It began yesterday afternoon.'
      }],
      localUtterances: [],
      assessmentDraft: { revision: 4, fields: draftFields, updatedAt: '2026-10-01T00:05:00.000Z' },
      assessment: null
    } })
  }))
  await page.route(`**/api/sessions/${sessionId}/assessment-draft`, async (route) => {
    const body = route.request().postDataJSON() as { revision: number; summary: string; plan: string }
    saveRequests.push(body)
    const { revision, ...fields } = body
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ revision, fields, updatedAt: '2026-10-01T00:06:00.000Z' })
    })
  })
  await page.context().addCookies([{ name: 'sb-localhost-auth-token', value: makeAuthCookie(), url: 'https://localhost:3002', sameSite: 'Lax' }])
  await page.goto('/encounter')
  await page.getByRole('dialog', { name: 'A visit is in progress' }).getByRole('button', { name: 'Resume visit' }).click()
  const preflight = page.getByRole('dialog', { name: 'Before you begin' })
  await preflight.getByRole('radio', { name: /Transcript/ }).check()
  await preflight.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await preflight.getByRole('button', { name: 'Continue with transcript' }).click()
  await page.getByRole('button', { name: 'Enter Room' }).click()
  await page.getByRole('tab', { name: 'Interview' }).click()
  await expect(page.getByLabel('Summary')).toHaveValue(draftFields.summary)
  await expect(page.getByLabel('Clinical rationale')).toHaveValue(draftFields.rationale)
  await expect(page.getByText('Draft restored.')).toBeVisible()
  await page.getByLabel('Plan').fill('Arrange appropriate evaluation.')
  await expect.poll(() => saveRequests.length).toBe(1)
  expect(saveRequests[0]).toMatchObject({ revision: 5, summary: draftFields.summary, plan: 'Arrange appropriate evaluation.' })
  await expect(page.getByText('Draft saved.')).toBeVisible()
})

test('voice conversation falls back to transcript when Realtime WebRTC is unsupported', async ({ page }) => {
  const sessionId = 'u'.repeat(43)
  await page.addInitScript(() => {
    Reflect.deleteProperty(window, 'RTCPeerConnection')
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
      getUserMedia: async () => ({ getTracks: () => [{ stop: () => undefined }] })
    } })
  })
  await page.route('**/api/account/tenants', (route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ memberships: [{ tenantId: 'tenant-test', role: 'learner' }] })
  }))
  await page.route('**/api/sessions', (route) => route.fulfill({
    status: 201,
    contentType: 'application/json',
    body: JSON.stringify({
      sessionId, status: 'initializing', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
      versions: { promptVersion: 'patient-scenario-prompt-v10', modelVersion: 'gpt-6-luna', schemaVersion: 7, policyVersion: 'patient-scenario-policy-v3' }
    })
  }))
  await page.route(`**/api/sessions/${sessionId}/setup`, (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      sessionId, status: 'ready', createdAt: '2026-10-01T00:01:00.000Z',
      patient: { fullName: 'Ari Nguyen', dateOfBirth: '1990-01-01', bodyType: 'average', reasonForVisit: 'Pelvic pain', vitalSigns: TEST_LEARNER_CHART_VITAL_SIGNS },
      versions: { promptVersion: 'patient-scenario-prompt-v10', modelVersion: 'gpt-6-luna', schemaVersion: 7, policyVersion: 'patient-scenario-policy-v3' },
      readiness: { profile: true, redis: true, conversation: true }
    })
  }))
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token', value: makeAuthCookie(), url: 'https://localhost:3002', sameSite: 'Lax'
  }])
  await page.goto('/encounter')
  const dialog = page.getByRole('dialog', { name: 'Before you begin' })
  await dialog.getByRole('radio', { name: /Voice conversation/ }).check()
  await dialog.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await dialog.getByRole('checkbox', { name: /send my microphone audio to OpenAI/i }).check()
  await dialog.getByRole('button', { name: 'Allow microphone access' }).click()
  await dialog.getByRole('button', { name: 'Continue with voice' }).click()
  await page.getByRole('button', { name: 'Enter Room' }).click()
  await expect(page.getByRole('tab', { name: 'Chart' })).toHaveAttribute('aria-selected', 'true')
  await page.getByRole('tab', { name: 'Interview' }).click()
  await expect(page.locator('.api-error')).toContainText(/live voice transcription is unavailable/i)
  await page.getByRole('textbox', { name: 'Your next question' }).fill('I can still type my question.')
  await expect(page.getByRole('button', { name: 'Send question' })).toBeEnabled()
})

test('starts setup on entry and withholds preflight until Redis setup and the patient portrait are ready', async ({ page }) => {
  const sessionId = 's'.repeat(43)
  const versionPins = {
    promptVersion: 'patient-scenario-prompt-v10',
    modelVersion: 'gpt-6-luna',
    schemaVersion: 7,
    policyVersion: 'patient-scenario-policy-v3'
  }
  let releasePortrait: (() => void) | undefined
  const portraitGate = new Promise<void>((resolve) => { releasePortrait = resolve })

  await page.route('**/api/account/tenants', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ memberships: [{ tenantId: 'tenant-test', role: 'learner' }] })
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
        reasonForVisit: 'Pelvic pain',
        vitalSigns: TEST_LEARNER_CHART_VITAL_SIGNS
      },
      versions: versionPins,
      readiness: { profile: true, redis: true, conversation: true }
    })
  }))
  await page.route('**/assets/images/3039-average/portrait-prototype.webp', async (route) => {
    await portraitGate
    await route.continue()
  })
  await page.context().addCookies([{
    name: 'sb-localhost-auth-token',
    value: makeAuthCookie(),
    url: 'https://localhost:3002',
    sameSite: 'Lax'
  }])
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/encounter')

  const patientPortrait = page.locator('.profile-image-wrap')
  const patientPortraitImage = patientPortrait.locator('img')
  await expect(patientPortraitImage).toHaveAttribute('src', '/assets/images/3039-average/portrait-prototype.webp')
  const desktopPortraitBounds = await patientPortrait.boundingBox()
  expect(desktopPortraitBounds).not.toBeNull()
  await page.getByRole('tab', { name: 'Chart' }).click()
  const patientChart = page.getByRole('tabpanel', { name: 'Chart' })
  await expect(patientChart).toContainText('Ari Nguyen')
  await expect(patientChart).toContainText('1990-01-01')
  await expect(patientChart).toContainText('Pelvic pain')
  await expect(patientChart).not.toContainText('average')
  await page.getByRole('tab', { name: 'Interview' }).click()

  const readiness = page.getByRole('list', { name: 'Patient setup readiness' })
  const enterRoom = page.getByRole('button', { name: 'Enter Room' })
  const dialog = page.getByRole('dialog', { name: 'Before you begin' })
  await expect(dialog).toBeHidden()
  await expect(page.getByText('Loading patient portrait')).toBeVisible()
  await expect(readiness.locator('li').nth(0)).toHaveAttribute('data-ready', 'true')
  await expect(readiness.locator('li').nth(1)).toHaveAttribute('data-ready', 'false')
  await expect(enterRoom).toBeDisabled()
  await expect(page.getByText('The patient is responding…')).toBeHidden()
  await page.screenshot({ path: '/tmp/gptmd-patient-setup-pending-desktop.png', fullPage: true })

  releasePortrait?.()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('radio', { name: /Transcript/ }).check()
  await dialog.getByRole('checkbox', { name: /use fictional details only/i }).check()
  await dialog.getByRole('button', { name: 'Continue with transcript' }).click()
  await expect(enterRoom).toBeEnabled()
  await expect.poll(() => patientPortraitImage.evaluate((image) => (image as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)
  await expect(patientPortraitImage).toHaveCSS('opacity', '1')
  await expect(page.locator('.status-row [role="status"]')).toContainText(/red light.*enter the room/i)
  await page.screenshot({ path: '/tmp/gptmd-patient-setup-ready-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  const mobilePortraitBounds = await patientPortrait.boundingBox()
  expect(mobilePortraitBounds).not.toBeNull()
  const mobileConversationBounds = await page.locator('.conversation-card').boundingBox()
  expect(mobileConversationBounds).not.toBeNull()
  expect(mobilePortraitBounds!.y).toBeLessThan(mobileConversationBounds!.y)
  await expect(patientPortraitImage).toHaveCSS('object-position', '50% 20%')
  await page.screenshot({ path: '/tmp/gptmd-patient-setup-ready-mobile.png', fullPage: true })
  await enterRoom.click()
  await expect(page.locator('.status-row [role="status"]')).toContainText(/green light.*your turn/i)
  await expect(page.locator('.status-dot')).toHaveClass(/status-listening/)
})
