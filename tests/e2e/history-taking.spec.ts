import { expect, test } from '@playwright/test'

test('clinician can filter the educator prompt library without implying audio or scoring', async ({ page }) => {
  await page.goto('/history-taking')

  await expect(page.getByRole('heading', { name: 'Practice the questions' })).toBeVisible()
  await expect(page.locator('.audio-status')).toContainText('Reference recordings are not available yet')
  await expect(page.locator('.audio-status')).toContainText('No learner recording or automated score is collected here')
  await expect(page.locator('.result-count')).toHaveText('510 / 510')

  await page.getByLabel('Search prompts').fill('What brings you in today?')
  await expect(page.locator('.result-count')).toHaveText('1 / 510')
  await expect(page.locator('.prompt-list')).toContainText('What brings you in today?')

  await page.getByLabel('Search prompts').fill('')
  await page.getByLabel('Prompt type').selectOption('communication_repair')
  await expect(page.locator('.result-count')).toHaveText('10 / 510')
  await expect(page.locator('.prompt-group summary').first()).toContainText('Useful repair phrases')
})
