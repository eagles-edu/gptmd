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
  await expect(page).toHaveURL(/\/login\?redirect=\/encounter$/)
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Account' })).toBeVisible()
})

test('main navigation has icons and collapses behind a mobile hamburger', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')

  const navigation = page.getByRole('navigation', { name: 'Main navigation' })
  await expect(page.getByRole('button', { name: 'Open main menu' })).toBeHidden()
  await expect(navigation.getByRole('link', { name: 'Begin Visit' })).toBeVisible()
  await expect(navigation.locator('a svg')).toHaveCount(6)

  await page.setViewportSize({ width: 390, height: 844 })
  const menuButton = page.getByRole('button', { name: 'Open main menu' })
  await expect(menuButton).toBeVisible()
  await expect(menuButton).toHaveAttribute('aria-expanded', 'false')
  await expect(navigation.getByRole('link', { name: 'Instructions' })).toBeHidden()

  await menuButton.click()
  await expect(page.getByRole('button', { name: 'Close main menu' })).toHaveAttribute('aria-expanded', 'true')
  await expect(navigation.getByRole('link', { name: 'Instructions' })).toBeVisible()
  await navigation.getByRole('link', { name: 'Instructions' }).click()
  await expect(page).toHaveURL(/\/tutorial$/)
  await expect(page.getByRole('button', { name: 'Open main menu' })).toHaveAttribute('aria-expanded', 'false')
})

test('account requires sign-in when Supabase is configured', async ({ page }) => {
  await page.goto('/account')

  await expect(page).toHaveURL(/\/login\?redirect=\/account$/)
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
})

test('login navigates to Supabase to start Google OAuth', async ({ page }) => {
  let authorizationUrl = ''
  await page.route('**/auth/v1/authorize**', async (route) => {
    authorizationUrl = route.request().url()
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<title>Supabase OAuth endpoint reached</title>'
    })
  })

  await page.goto('/login')

  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible()
  await expect(page).toHaveTitle('Sign in | GPTpatient')
  const button = page.getByRole('button', { name: 'Continue with Google' })
  await expect(button).toBeEnabled()
  await button.click()

  await expect(page).toHaveURL(/\/auth\/v1\/authorize\?/)
  await expect(page).toHaveTitle('Supabase OAuth endpoint reached')
  expect(authorizationUrl).toContain('/auth/v1/authorize?')
  expect(new URL(authorizationUrl).searchParams.get('provider')).toBe('google')
  expect(new URL(authorizationUrl).searchParams.get('redirect_to')).toBe('http://127.0.0.1:3001/confirm')
})
