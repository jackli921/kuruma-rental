import { expect, test } from '@playwright/test'

// Renter storefront search happy path (#391, plan §8 E2E + §11 step 8).
// Mock-API read track: the two storefront endpoints are stubbed in
// e2e/mock-api.ts, so this gate does NOT depend on a seeded `test` DB.
// Fixture values below mirror that stub.
const STORE_ID = 'e2e-store-1'
const STORE_NAME = 'Best Car Rental Osaka'
const PICKUP = '2026-07-01T10:00'
const RETURN = '2026-07-03T10:00'

test.describe('Renter storefront search flow', () => {
  test('date-range search surfaces a storefront card with class badge + price', async ({
    page,
  }) => {
    await page.goto('/en/search')

    // No range yet -> the page shows the date prompt, no result cards.
    await expect(
      page.getByText('Choose a pickup and return time to see available stores.'),
    ).toBeVisible()

    // Enter pickup/return and submit the search form.
    await page.locator('#from').fill(PICKUP)
    await page.locator('#to').fill(RETURN)
    await page.getByRole('button', { name: 'Search' }).click()

    // The chosen range lands in the URL (form -> /search?from=&to=).
    await expect(page).toHaveURL(/\/en\/search\?from=.+&to=.+/)

    // One storefront card linking to this store's detail, carrying the range.
    const card = page.getByRole('link', { name: new RegExp(STORE_NAME) })
    await expect(card).toHaveCount(1)
    await expect(card).toHaveAttribute('href', new RegExp(`/storefronts/${STORE_ID}\\?`))

    // Demo target string parts: class-summary badge + "from ¥…" price.
    await expect(page.getByText('Compact ×4')).toBeVisible()
    await expect(page.getByText('From ¥4,500 / day')).toBeVisible()
  })

  test('clicking a card opens the detail with grouped vehicles + a deferred booking CTA', async ({
    page,
  }) => {
    await page.goto(`/en/search?from=${PICKUP}&to=${RETURN}`)

    await page
      .getByRole('link', { name: new RegExp(STORE_NAME) })
      .first()
      .click()

    // Landed on the storefront detail for this store, range preserved.
    await expect(page).toHaveURL(new RegExp(`/en/storefronts/${STORE_ID}\\?from=.+&to=.+`))
    await expect(page.getByRole('heading', { level: 1, name: STORE_NAME })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Available cars' })).toBeVisible()

    // Grouped available vehicles from the fixture (one per class).
    await expect(page.getByRole('heading', { name: 'E2E Honda Fit' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'E2E Toyota Sienta' })).toBeVisible()

    // The booking CTA (/bookings/new) is deferred in the Vite migration, so it
    // renders as an inert disabled button per vehicle rather than a link.
    // Re-assert the live /bookings/new link once the booking flow is ported (#501).
    const bookButtons = page.getByRole('button', { name: 'Book this car' })
    await expect(bookButtons).toHaveCount(2)
    await expect(bookButtons.first()).toBeDisabled()
    await expect(page.getByRole('link', { name: 'Book this car' })).toHaveCount(0)
  })
})
