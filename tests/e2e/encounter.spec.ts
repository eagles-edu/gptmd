import { expect, test } from '@playwright/test'

test('creates a patient session and completes a validated interview turn', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname
    let response: object

    if (path === '/api/sessions') {
      response = { sessionId: 'session-123' }
    } else if (path === '/api/sessions/session-123/setup') {
      response = {
        profile: {
          patientName: 'Ari Nguyen',
          patientDob: '1990-01-01',
          patientBodytype: 'average',
          patientReason: 'Pelvic pain'
        }
      }
    } else if (path === '/api/sessions/session-123/turns') {
      const body = route.request().postDataJSON() as { turnId: string }
      response = { turnId: body.turnId, text: 'It began yesterday.' }
    } else {
      await route.fulfill({ status: 404, body: 'Not found' })
      return
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) })
  })

  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-app-theme', 'light')
  await page.getByRole('button', { name: 'Create patient session' }).click()
  await expect(page.getByText('Ari Nguyen')).toBeVisible()
  await expect(page.locator('#doctor-question')).toBeEnabled()

  await page.locator('#doctor-question').fill('When did the pain begin?')
  await page.getByRole('button', { name: 'Send question' }).click()

  await expect(page.getByText('It began yesterday.')).toBeVisible()
  await expect(page.locator('.status-row')).toContainText('Ready for interview')
})
