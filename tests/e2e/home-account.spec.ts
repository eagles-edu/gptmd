import { expect, test } from '@playwright/test'

test('home exposes the planned learning and account entry points', async ({ page }) => {
  await page.goto('/')

  await expect(page.getByRole('heading', { name: 'Your practice space' })).toBeVisible()
  const entryCards = page.locator('.entry-grid')
  await expect(entryCards.getByRole('link', { name: /Instructions/ })).toHaveAttribute('href', '/tutorial')
  await expect(entryCards.getByRole('link', { name: /History-Taking Overview/ })).toHaveAttribute('href', '/history-taking')
  await expect(entryCards.getByRole('link', { name: /Account Status/ })).toHaveAttribute('href', '/account')
  await expect(entryCards.getByRole('link', { name: /Contact Us/ })).toHaveAttribute('href', '/contact')

  await page.getByRole('link', { name: 'Begin Visit' }).first().click()
  await expect(page).toHaveURL(/\/encounter$/)
  await expect(page.getByRole('heading', { name: 'A patient history, one question at a time' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Account' })).toBeVisible()
})

test('account status does not fabricate unconnected account or billing data', async ({ page }) => {
  await page.goto('/account')

  await expect(page.getByRole('heading', { name: 'Account Status' })).toBeVisible()
  await expect(page.getByText('Live account reporting is not connected yet.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Usage' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Metrics' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Downloads' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Payment gateway' })).toBeVisible()
  await expect(page.getByText('Payment access will be available after a payment provider is configured.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open payment portal' })).toHaveCount(0)
})
