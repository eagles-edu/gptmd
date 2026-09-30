import { expect, test } from '@playwright/test'

test('loads bundled font assets without failed requests', async ({ page }) => {
  const fontResponses: { status: number, url: string }[] = []
  page.on('response', (response) => {
    if (/\.woff2(?:\?|$)/.test(response.url())) {
      fontResponses.push({ status: response.status(), url: response.url() })
    }
  })

  await page.goto('/')
  await page.evaluate(() => document.fonts.ready)

  expect(fontResponses.length).toBeGreaterThan(0)
  expect(fontResponses.filter(response => response.status !== 200)).toEqual([])
})
