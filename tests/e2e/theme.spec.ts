import { expect, test } from '@playwright/test'

test('theme toggle updates the page and persists its preference across reloads', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'light')

  const toggle = page.getByRole('button', { name: 'Switch to dark theme' })
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await toggle.click()

  const lightToggle = page.getByRole('button', { name: 'Switch to light theme' })
  await expect(lightToggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'dark')

  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'dark')
  await expect(page.getByRole('button', { name: 'Switch to light theme' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'dark')
})
