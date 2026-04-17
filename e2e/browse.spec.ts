import { expect, test } from '@playwright/test'

const TEST_VEHICLE_NAME = 'E2E Test Honda N-BOX'
const TEST_VEHICLE_ID = 'e2e-test-vehicle-1'

test.describe('Renter public browse flow', () => {
  test('vehicles list renders mocked fleet', async ({ page }) => {
    await page.goto('/en/vehicles')

    await expect(page.getByRole('heading', { level: 1, name: 'Browse vehicles' })).toBeVisible()
    await expect(page.getByText(TEST_VEHICLE_NAME)).toBeVisible()
  })

  test('clicking a vehicle card navigates to detail page', async ({ page }) => {
    await page.goto('/en/vehicles')

    await page
      .getByRole('link', { name: new RegExp(TEST_VEHICLE_NAME) })
      .first()
      .click()

    await expect(page).toHaveURL(new RegExp(`/vehicles/${TEST_VEHICLE_ID}$`))
    await expect(page.getByRole('heading', { level: 1, name: TEST_VEHICLE_NAME })).toBeVisible()
  })

  test('detail page surfaces the book CTA', async ({ page }) => {
    await page.goto(`/en/vehicles/${TEST_VEHICLE_ID}`)

    await expect(page.getByRole('link', { name: 'Book this car' })).toBeVisible()
  })
})
