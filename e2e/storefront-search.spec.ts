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
  test('auto-seeded search surfaces a storefront card with class badge + price', async ({
    page,
  }) => {
    await page.goto('/en/search')

    // No range in the URL -> beforeLoad seeds a default JST range and redirects,
    // so the search auto-runs results instead of showing the old date prompt.
    await expect(page).toHaveURL(/\/en\/search\?from=.+&to=.+/)

    // One storefront card linking to this store's detail, carrying the range.
    const card = page.getByRole('link', { name: new RegExp(STORE_NAME) })
    await expect(card).toHaveCount(1)
    await expect(card).toHaveAttribute('href', new RegExp(`/storefronts/${STORE_ID}\\?`))

    // Demo target string parts: class-summary badge + "from ¥…" price.
    await expect(page.getByText('Compact ×4')).toBeVisible()
    await expect(page.getByText('From ¥4,500 / day')).toBeVisible()

    // The renter can still override the seeded dates and re-search; the chosen
    // range replaces the seed in the URL and results still render.
    await page.locator('#from').fill(PICKUP)
    await page.locator('#to').fill(RETURN)
    await page.getByRole('button', { name: 'Search' }).click()
    await expect(page).toHaveURL(/from=2026-07-01T10(%3A|:)00/)
    await expect(page).toHaveURL(/to=2026-07-03T10(%3A|:)00/)
    await expect(page.getByRole('link', { name: new RegExp(STORE_NAME) })).toHaveCount(1)
  })

  test('clicking a card opens the detail with grouped vehicles + a live booking CTA', async ({
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

    // #460 wired the booking CTA to the reservation wizard at /bookings/new,
    // carrying the vehicle + pickup location + JST range as search params.
    const bookLinks = page.getByRole('link', { name: 'Book this car' })
    await expect(bookLinks).toHaveCount(2)
    await expect(bookLinks.first()).toHaveAttribute('href', /\/en\/bookings\/new\?.*vehicleId=/)
    await expect(page.getByRole('button', { name: 'Book this car' })).toHaveCount(0)
  })
})
