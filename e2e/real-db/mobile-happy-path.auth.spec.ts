import { expect, test } from '@playwright/test'
import { RENTER_SEED_EMAIL, RENTER_STORAGE_STATE } from './constants'
import { testSql } from './pg'

// #1259 mobile-viewport renter happy path. International tourists (the primary
// audience) book on phones, but marketplace-happy-path.auth.spec.ts runs desktop
// Chrome only. This is the real-DB, actually-running mobile version of the dead
// mock skeleton retired in #1255 — same journey (search -> storefront -> wizard ->
// confirmation) on a 390x844 phone viewport, guarding mobile layout/interaction
// (tap targets, wizard step layout) rather than the funnel logic the desktop
// spec already proves.
//
// Viewport override in a dedicated spec (not a mobile PROJECT in the config):
// a project would re-run every *.auth.spec.ts on mobile, most of which target
// operator surfaces irrelevant to phone booking. describe-level test.use keeps
// the mobile emulation scoped to this journey. `isMobile`/`hasTouch` are Chromium
// context options — the lane's authenticated-real-db project is Desktop Chrome
// (chromium), so overriding viewport + isMobile + hasTouch stays same-browser.
//
// The default `page` is the OPERATOR storageState; override it to the renter here
// (the API forces renterId = ctx.userId for non-staff, so the booking must be
// made AS the renter). No operator-portal step: the desktop spec covers that.

// Booking-code alphabet (api/lib/booking-code.ts BOOKING_CODE_PATTERN). Inlined:
// @kuruma/api TS can't be required from this CJS-transformed Playwright file.
const BOOKING_CODE_RE = /^[2-9A-HJ-NP-Z]{8}$/

// Real ids are UUIDs (db/seed-id.ts); asserting the shape also proves the mobile
// flow carries a UUID the .uuid() API guard accepts through every hop.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

// Best Car Rental storefront (same operator as the desktop spec). KIX seeds only
// 4 vehicles, so this run consumes one for its window.
const STOREFRONT_NAME = 'Kansai Airport (KIX)'
const OPERATOR_NAME = 'Best Car Rental'

// An AUGUST window — distinct from the desktop spec's July window so the two
// never contend for the same KIX vehicle and each cleans up only its own rows.
// `datetime-local` wall-clock (parsed as JST).
const FROM = '2026-08-15T10:00'
const TO = '2026-08-17T10:00'
const WINDOW_START = '2026-08-01'
const WINDOW_END = '2026-09-01'

const PHONE_VIEWPORT = { width: 390, height: 844 }

test.describe('mobile happy path — renter books on a phone viewport (real DB)', () => {
  test.use({
    storageState: RENTER_STORAGE_STATE,
    viewport: PHONE_VIEWPORT,
    isMobile: true,
    hasTouch: true,
  })

  test.afterAll(cleanupWindowRenterBookings)

  test('search -> storefront -> vehicle -> wizard -> confirmation (mobile)', async ({ page }) => {
    test.setTimeout(120_000) // Vite builds each route on first hit; real-DB round-trips

    await test.step('1. mobile search surfaces the operator storefront', async () => {
      await page.goto(`/en/search?from=${FROM}&to=${TO}`)
      await expect(page).toHaveURL(/\/search\?from=.+&to=.+/)
      await expect(
        page.getByRole('link').filter({ hasText: STOREFRONT_NAME }).first(),
      ).toBeVisible()
    })

    await test.step('2. storefront result lists this operator and its available cars', async () => {
      await page.getByRole('link').filter({ hasText: STOREFRONT_NAME }).first().click()
      await expect(page).toHaveURL(new RegExp(`/storefronts/${UUID}\\?from=.+&to=.+`))
      await expect(page.getByRole('heading', { name: STOREFRONT_NAME })).toBeVisible()
      await expect(page.getByText(OPERATOR_NAME).first()).toBeVisible()
    })

    await test.step('3. vehicle selection carries vehicle + location + dates into the wizard', async () => {
      await page.getByRole('link', { name: 'Book this car' }).first().click()
      await expect(page).toHaveURL(
        new RegExp(`/bookings/new\\?vehicleId=${UUID}&locationId=${UUID}`),
      )
      await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
    })

    let bookingCode = ''
    await test.step('4-5. step through the wizard; booking confirms with a no-confusables code', async () => {
      // 5-step wizard (#460): dates -> addOns -> insurance -> confirm -> payment.
      // Each step gates on its own marker so a tap never fires before the next
      // step has laid out on the narrow viewport (the mobile-layout guarantee).
      await page.getByRole('button', { name: 'Continue', exact: true }).click() // dates -> addOns
      await expect(page.getByText('Add optional extras')).toBeVisible()

      await page.getByRole('button', { name: 'Continue', exact: true }).click() // addOns -> insurance
      await expect(page.getByText('No insurance')).toBeVisible()

      await page.getByRole('button', { name: 'Continue', exact: true }).click() // insurance -> confirm
      await expect(page.getByText('Review your booking')).toBeVisible()

      await page.getByRole('button', { name: 'Continue to payment' }).click() // confirm -> payment
      await expect(page.getByRole('heading', { name: 'Confirm and reserve' })).toBeVisible()
      // Reserve is gated on the liability-disclaimer consent (#613).
      await page.getByRole('checkbox').check()
      await page.getByRole('button', { name: 'Reserve now' }).click() // instant-book submit

      await expect(page).toHaveURL(/\/bookings\/confirmation\?bookingId=.+/)
      await expect(page.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible()

      bookingCode = (await page.locator('span.font-mono').first().innerText()).trim()
      expect(bookingCode).toMatch(BOOKING_CODE_RE)
      await expect(page.getByText('Confirmed', { exact: true })).toBeVisible()
    })
  })
})

/** Delete the window's renter bookings this spec created, children first (FK order). */
async function cleanupWindowRenterBookings(): Promise<void> {
  const sql = testSql()
  try {
    const ids = await sql<{ id: string }[]>`
      SELECT b.id FROM bookings b
      JOIN users u ON u.id = b."renterId"
      WHERE u.email = ${RENTER_SEED_EMAIL}
        AND b."startAt" >= ${WINDOW_START} AND b."startAt" < ${WINDOW_END}
    `
    if (ids.length === 0) return
    const bookingIds = ids.map((r) => r.id)
    await sql`DELETE FROM notification_log WHERE "bookingId" IN ${sql(bookingIds)}`
    await sql`DELETE FROM booking_events WHERE "bookingId" IN ${sql(bookingIds)}`
    // payment_events has no ON DELETE CASCADE — the confirmation step (#461) writes
    // one per booking, so clear it before the booking or the DELETE below 23503s.
    await sql`DELETE FROM payment_events WHERE "bookingId" IN ${sql(bookingIds)}`
    await sql`DELETE FROM threads WHERE "bookingId" IN ${sql(bookingIds)}`
    await sql`DELETE FROM bookings WHERE id IN ${sql(bookingIds)}`
  } finally {
    await sql.end({ timeout: 5 })
  }
}
