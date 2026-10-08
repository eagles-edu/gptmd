import { expect, test } from '@playwright/test'

const mobileViewerUrl = 'https://mobileviewer.github.io/#viewerStage'
const targetUrl = process.env.GPTMD_MOBILEVIEWER_TARGET_URL ?? 'https://httpbin.org/html'
const expectedTargetText = process.env.GPTMD_MOBILEVIEWER_EXPECTED_TEXT ?? 'Herman Melville - Moby-Dick'

test('Mobile Viewer renders a target and applies phone and landscape presets', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto(mobileViewerUrl, { waitUntil: 'domcontentloaded' })
  await expect(page).toHaveTitle(/Mobile Viewer/)

  await page.locator('#urlInput').fill(targetUrl)
  await page.locator('#loadBtn').click()

  const preview = page.locator('#mainIframe')
  await expect(preview).toHaveAttribute('src', targetUrl)
  await expect(page.locator('#pdPlaceholder')).toBeHidden({ timeout: 15_000 })
  await expect(page.frameLocator('#mainIframe').getByText(expectedTargetText, { exact: false })).toBeVisible()

  await page.getByRole('button', { name: 'Galaxy S24', exact: true }).click()
  await expect(page.locator('#deviceLabel')).toContainText('Galaxy S24')
  await expect(page.locator('#deviceDims')).toContainText('360 × 780 px')
  await expect(preview).toHaveCSS('width', '360px')
  await expect(preview).toHaveCSS('height', '780px')

  await page.getByRole('button', { name: 'Rotate' }).click()
  await expect(page.locator('#deviceDims')).toContainText('780 × 360 px')
  await expect(preview).toHaveCSS('width', '780px')
  await expect(preview).toHaveCSS('height', '360px')

  // The hosted tool currently emits these unrelated errors from its ad and toast scripts.
  const knownHostedViewerErrors = [
    "adsbygoogle.push() error: Only one 'enable_page_level_ads' allowed per page.",
    "Cannot set properties of null (setting 'textContent')"
  ]
  expect(pageErrors.filter((error) => !knownHostedViewerErrors.includes(error))).toEqual([])
})
