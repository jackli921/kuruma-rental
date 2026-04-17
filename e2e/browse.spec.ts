import { expect, test } from '@playwright/test'

const TEST_VEHICLE_NAME = 'E2E Test Honda N-BOX'
const TEST_VEHICLE_ID = 'e2e-test-vehicle-1'

test.describe('Renter public browse flow', () => {
  test('vehicles list renders mocked fleet with correct card link', async ({ page }) => {
    await page.goto('/en/vehicles')

    await expect(page.getByRole('heading', { level: 1, name: 'Browse vehicles' })).toBeVisible()

    // Card link — only the correct render path produces a link whose href
    // matches the detail route for this specific vehicle ID.
    const cards = page.getByRole('link', { name: new RegExp(TEST_VEHICLE_NAME) })
    await expect(cards).toHaveCount(1)
    await expect(cards.first()).toHaveAttribute('href', new RegExp(`/vehicles/${TEST_VEHICLE_ID}$`))
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

  test('detail page surfaces the book CTA with correct href', async ({ page }) => {
    await page.goto(`/en/vehicles/${TEST_VEHICLE_ID}`)

    // CTA must route to the booking flow for THIS vehicle — a naive
    // toBeVisible() would pass even if the link pointed to the wrong ID
    // or to a dead route.
    const cta = page.getByRole('link', { name: 'Book this car' })
    await expect(cta).toBeVisible()
    await expect(cta).toHaveAttribute(
      'href',
      new RegExp(`/bookings/new\\?vehicleId=${TEST_VEHICLE_ID}$`),
    )
  })
})
