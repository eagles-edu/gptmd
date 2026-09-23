import { expect, test } from '@playwright/test'

test('Nuxt renders the application shell', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('body')).toBeVisible()
})
