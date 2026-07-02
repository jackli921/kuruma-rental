import { expect, test } from '@playwright/test'

test.describe('Operator registration', () => {
  test('fills form and sees success panel', async ({ page }) => {
    await page.goto('/en/business/register')

    await page.getByLabel('Business name').fill('Osaka Rentals')
    await page.getByLabel('Contact name').fill('Aiko Tanaka')
    await page.getByRole('textbox', { name: 'Email' }).fill('aiko@example.com')
    await page.getByRole('textbox', { name: 'Phone' }).fill('+81 90-1234-5678')
    await page.getByLabel('Service area (city/prefecture)').fill('Osaka')
    await page.getByLabel('Estimated fleet size').selectOption('6-20')
    await page.getByLabel('I agree to be contacted about my application').check()

    await page.getByRole('button', { name: 'Submit application' }).click()

    await expect(page.getByRole('heading', { name: 'Application received' })).toBeVisible()
    await expect(page.getByText('aiko@example.com')).toBeVisible()
  })
})
