import { expect, test } from '@playwright/test'
import { renterSessionCookie } from './auth'

// Slice 6 renter booking flow (#392), form-onwards E2E. Mock-API track: the
// storefront, insurance, and booking endpoints are stubbed in e2e/mock-api.ts,
// so this gate does not depend on a seeded DB. The session is a forged Auth.js
// cookie (e2e/auth.ts) — no real OAuth, Resend is slice 7.
const STORE_ID = 'e2e-store-1'
const STORE_NAME = 'Best Car Rental Osaka'
const PICKUP = '2026-07-01T10:00'
const RETURN = '2026-07-03T10:00'

test.describe('Renter booking flow', () => {
  test('books a storefront vehicle through to the confirmation page', async ({ page, context }) => {
    await context.addCookies([await renterSessionCookie()])

    // From the storefront detail, click "Book this car" on the first vehicle.
    await page.goto(`/en/storefronts/${STORE_ID}?from=${PICKUP}&to=${RETURN}`)
    await expect(page.getByRole('heading', { level: 1, name: STORE_NAME })).toBeVisible()
    await page.getByRole('link', { name: 'Book this car' }).first().click()

    // Booking form: shows the chosen vehicle; renter picks insurance.
    await expect(page).toHaveURL(/\/en\/bookings\/new\?vehicleId=e2e-store-vehicle-1/)
    await expect(page.getByRole('heading', { name: 'E2E Honda Fit' })).toBeVisible()
    await page.getByLabel('Insurance').selectOption('e2e-ins-1')
    await page.getByRole('button', { name: 'Confirm booking' }).click()

    // Confirmation: reservation code, the selected insurance, and the fees block.
    await expect(page).toHaveURL(/\/en\/bookings\/confirmation\?bookingId=.+/)
    await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible()
    await expect(page.getByText(/^E2E[A-Z0-9]{6}$/)).toBeVisible()
    await expect(page.getByText('Collision Damage Waiver', { exact: false })).toBeVisible()
    await expect(page.getByText('Potential additional charges')).toBeVisible()
    await expect(page.getByText('Cleaning', { exact: true })).toBeVisible()

    // Slice 7 (#393): pre-auth handoff CTA links to the operator's EXTERNAL
    // pre-auth URL (plain anchor, new tab) — not the i18n Link.
    const preAuth = page.getByRole('link', { name: 'Complete pre-authorization' })
    await expect(preAuth).toHaveAttribute('href', 'https://pay.example.com/preauth')
    await expect(preAuth).toHaveAttribute('target', '_blank')
  })

  test('redirects to login when the renter is not authenticated', async ({ browser }) => {
    const ctx = await browser.newContext()
    const page = await ctx.newPage()

    await page.goto(
      `/en/bookings/new?vehicleId=e2e-store-vehicle-1&locationId=${STORE_ID}&from=${PICKUP}&to=${RETURN}`,
    )

    await expect(page).toHaveURL(/\/en\/login/)
    await ctx.close()
  })
})
