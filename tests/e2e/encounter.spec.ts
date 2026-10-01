import { expect, test } from '@playwright/test'

test('encounter requires sign-in when Supabase is configured', async ({ page }) => {
  await page.goto('/encounter')
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'light')
  await expect(page).toHaveURL(/\/login\?redirect=\/encounter$/)
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
})
