import { expect, test } from '@playwright/test'

const policyPages = [
  { path: '/privacy', link: 'Privacy', title: 'Privacy policy', vi: 'Chính sách bảo vệ dữ liệu cá nhân' },
  { path: '/terms', link: 'Terms', title: 'Terms of service', vi: 'Điều khoản sử dụng dịch vụ' },
  { path: '/service-provision', link: 'Service provision', title: 'Service provision and activation', vi: 'Chính sách cung cấp và kích hoạt dịch vụ' },
  { path: '/refunds', link: 'Refunds and cancellation', title: 'Refunds and cancellation', vi: 'Chính sách hoàn tiền và hủy dịch vụ' }
]

test('policy pages show bilingual current terms and footer navigation', async ({ page }) => {
  const pageErrors: string[] = []
  const consoleErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.stack ?? error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  const footer = page.getByRole('navigation', { name: 'Policies' })
  await expect(footer.getByRole('link', { name: 'Privacy' })).toHaveAttribute('href', '/privacy')
  await footer.getByRole('link', { name: 'Privacy' }).click()
  await expect(page).toHaveURL(/\/privacy$/)

  for (const policy of policyPages) {
    if (new URL(page.url()).pathname !== policy.path) {
      await footer.getByRole('link', { name: policy.link }).click()
    }
    await expect(page).toHaveURL(new RegExp(`${policy.path}$`))
    await expect(page).toHaveTitle(new RegExp(policy.title))
    await expect(page.getByRole('heading', { level: 1, name: policy.title })).toBeVisible()
    await expect(page.getByText(policy.vi, { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'English' })).toBeVisible()
    await expect(page.getByText(/paid checkout and automatic billing are not enabled/i)).toBeVisible()
    await expect(page.getByRole('link', { name: 'Contact GPTpatient support' })).toBeVisible()
    await expect(page.getByText(/\[Company Name\]|\[Your Domain URL\]|07 - 14/i)).toHaveCount(0)
  }

  await expect(page.getByRole('region', { name: 'Merchant information' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'MoIT confirmation' })).toHaveCount(0)

  await footer.getByRole('link', { name: 'Terms' }).click()
  await expect(page.getByRole('heading', { name: 'Age requirement' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Governing law and disputes' })).toBeVisible()
  await expect(page.getByText(/transaction limits, cancellation process, and refund terms/)).toBeVisible()
  await page.getByRole('link', { name: 'Contact GPTpatient support' }).click()
  await expect(page.getByRole('heading', { name: 'Complaints and service issues' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Khiếu nại và sự cố dịch vụ' })).toBeVisible()
  await expect(page.getByText(/Complaint intake is not operational/)).toBeVisible()

  await footer.getByRole('link', { name: 'Privacy' }).click()
  await page.screenshot({ path: '/tmp/gptmd-policy-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect(page.getByRole('heading', { name: 'Tiếng Việt' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'English' })).toBeVisible()
  await page.screenshot({ path: '/tmp/gptmd-policy-mobile.png', fullPage: true })
  expect(pageErrors).toEqual([])
  expect(consoleErrors).toEqual([])
})

test('checkout collects digital-service details and opens the ACB2Pay sandbox handoff safely', async ({ page }) => {
  const submittedRequests: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET') submittedRequests.push(`${request.method()} ${request.url()}`)
  })

  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/checkout-demo')
  await page.screenshot({ path: '/tmp/gptmd-checkout-plan-desktop.png', fullPage: true })
  await expect(page.getByText('0 items')).toBeVisible()
  await page.getByRole('button', { name: 'Add plan to cart' }).click()
  await expect(page.getByText('1 item')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Where should access details go?' })).toBeVisible()
  await page.screenshot({ path: '/tmp/gptmd-checkout-details-desktop.png', fullPage: true })
  await page.getByRole('button', { name: /Review details/ }).click()
  await expect(page.getByRole('heading', { name: 'Where should access details go?' })).toBeVisible()

  await page.getByLabel(/Name/).fill('Test Reviewer')
  await page.getByLabel('Email for service information').fill('reviewer@example.test')
  await page.getByLabel('Billing/contact address').fill('Test address, Ha Noi, Viet Nam')
  await expect(page.getByLabel('Delivery method')).toHaveValue('digital')
  await page.getByRole('button', { name: /Review details/ }).click()
  await expect(page.getByRole('heading', { name: 'Everything look right?' })).toBeVisible()
  await expect(page.getByText('Digital workspace access')).toBeVisible()
  await page.screenshot({ path: '/tmp/gptmd-checkout-review-desktop.png', fullPage: true })

  const payButton = page.getByRole('button', { name: /Pay via ACB2Pay sandbox/ })
  await expect(payButton).toBeDisabled()
  await page.getByRole('checkbox', { name: /I have reviewed the/ }).check()
  await expect(payButton).toBeEnabled()
  await payButton.click()
  await expect(page.getByRole('heading', { name: 'Sandbox connection pending' })).toBeVisible()
  await expect(page.getByText(/No payment request was sent\. No order was created, no charge was made/)).toBeVisible()
  await expect(page.getByText(/Màn hình chuyển tiếp ACB2Pay đã sẵn sàng/)).toBeVisible()
  expect(submittedRequests).toEqual([])

  await page.screenshot({ path: '/tmp/gptmd-checkout-handoff-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByRole('heading', { name: 'Sandbox connection pending' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/gptmd-checkout-handoff-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Switch to dark theme' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'dark')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/gptmd-checkout-handoff-dark.png', fullPage: true })
})

test('unknown routes return a server-side 404 status', async ({ request }) => {
  const response = await request.get('/gov-review-route-that-does-not-exist')
  expect(response.status()).toBe(404)
  expect(await response.text()).toContain('Page not found')
})
