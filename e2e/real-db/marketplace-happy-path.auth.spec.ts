import { expect, test } from '@playwright/test'
import { RENTER_STORAGE_STATE } from './constants'
import { testSql } from './pg'

// #488 final marketplace demo (Path A: instant-book, no Stripe). Ported from the
// #390 interim spec to the shipped Vite UI. Proves the acceptance sentence end to
// end on the REAL Vite web -> Hono API -> seeded Postgres stack, across TWO
// authenticated actors:
//
//   "renter search -> storefront result -> vehicle selection -> booking ->
//    confirmation notification visible in the operator portal".
//
// Steps 1-5 run in a RENTER browser context (the API forces renterId =
// ctx.userId for non-staff, so the booking must be made AS the renter). Step 6
// reuses the project-default OPERATOR_OWNER `page` to read the operator portal.
//
// Selectors are grounded in the shipped Vite UI (#458 search / #460 5-step
// wizard / #511 confirmation / #512 operator list) — not the mock skeleton in
// e2e/marketplace-happy-path.spec.ts, and not the retired Next.js pages.

// Booking-code alphabet (api/lib/booking-code.ts BOOKING_CODE_PATTERN). Inlined:
// @kuruma/api TS can't be required from this CJS-transformed Playwright file.
const BOOKING_CODE_RE = /^[2-9A-HJ-NP-Z]{8}$/

// The renter persona we mint (seed-data/bookings.ts). The seed mints UUID ids
// (db/seed-id.ts), so we resolve the renter by EMAIL in SQL, never by a slug.
const RENTER_EMAIL = 'sarah@example.test'
const RENTER_NAME = 'Sarah Smith'

// Best Car Rental storefront. Drilling into THIS operator's store scopes the
// booking to the minted owner's portal (the operator token's tenant = this op).
const STOREFRONT_NAME = 'Kansai Airport (KIX)'
const OPERATOR_NAME = 'Best Car Rental'

// Real ids are UUIDs (db/seed-id.ts) — asserting the shape also proves the booking
// flow carries a UUID the .uuid() API guard accepts (the bug the seed fix closes).
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

// A far-future window, clear of the seeded bookings (which span demo-time-relative
// ~-5..+7 days). Keeps a fleet of vehicles available and isolates the new booking.
// `datetime-local` wall-clock (parsed as JST).
const FROM = '2026-07-15T10:00'
const TO = '2026-07-17T10:00'

// KIX seeds only 4 vehicles, so every run consumes one for the window. afterAll
// deletes the bookings this spec created (+ their RESTRICT children, in FK order:
// notification_log, booking_events, threads → thread_messages cascade) so a
// reused local branch stays re-runnable. The CI lane (#445) uses a fresh branch.
test.describe('marketplace happy path — renter books, operator sees it (real DB)', () => {
  test.afterAll(cleanupFutureSarahBookings)

  test('search -> storefront -> vehicle -> booking -> confirmation -> operator portal', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000) // Vite builds each route on first hit; real-DB round-trips

    const renterContext = await browser.newContext({ storageState: RENTER_STORAGE_STATE, baseURL })
    const renter = await renterContext.newPage()

    await test.step('1. renter search surfaces the operator storefront', async () => {
      await renter.goto('/en/search')
      await renter.locator('#from').fill(FROM)
      await renter.locator('#to').fill(TO)
      await renter.getByRole('button', { name: 'Search' }).click()

      await expect(renter).toHaveURL(/\/search\?from=.+&to=.+/)
      await expect(
        renter.getByRole('link').filter({ hasText: STOREFRONT_NAME }).first(),
      ).toBeVisible()
    })

    await test.step('2. storefront result lists this operator and its available cars', async () => {
      await renter.getByRole('link').filter({ hasText: STOREFRONT_NAME }).first().click()

      await expect(renter).toHaveURL(new RegExp(`/storefronts/${UUID}\\?from=.+&to=.+`))
      await expect(renter.getByRole('heading', { name: STOREFRONT_NAME })).toBeVisible()
      // Operator name appears in several places on the detail page (header, vehicle
      // cards) — first() keeps the assertion out of strict-mode multi-match.
      await expect(renter.getByText(OPERATOR_NAME).first()).toBeVisible()
    })

    await test.step('3. vehicle selection carries vehicle + location + dates into the wizard', async () => {
      // "Book this car" is a styled Link → /bookings/new with vehicleId + locationId
      // + the search dates (so the wizard's first step is pre-filled, read-only).
      await renter.getByRole('link', { name: 'Book this car' }).first().click()
      await expect(renter).toHaveURL(
        new RegExp(`/bookings/new\\?vehicleId=${UUID}&locationId=${UUID}`),
      )
      // The wizard opens on the read-only Dates step; its Continue button proves it loaded.
      await expect(renter.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
    })

    let bookingCode = ''
    await test.step('4-5. step through the wizard; booking confirms with a no-confusables code', async () => {
      // 5-step wizard (#460): dates → addOns → insurance → confirm → payment.
      // Dates are pre-filled & read-only; add-ons are optional (skip); insurance
      // defaults to "No insurance" (decline). Each step gates on its own marker so
      // we never click Continue before the next step has rendered.
      await renter.getByRole('button', { name: 'Continue', exact: true }).click() // dates → addOns
      await expect(renter.getByText('Add optional extras')).toBeVisible()

      await renter.getByRole('button', { name: 'Continue', exact: true }).click() // addOns → insurance
      await expect(renter.getByText('No insurance')).toBeVisible()

      await renter.getByRole('button', { name: 'Continue', exact: true }).click() // insurance → confirm
      await expect(renter.getByText('Review your booking')).toBeVisible()

      await renter.getByRole('button', { name: 'Continue to payment' }).click() // confirm → payment
      await expect(renter.getByRole('heading', { name: 'Confirm and reserve' })).toBeVisible()
      await renter.getByRole('button', { name: 'Reserve now' }).click() // instant-book submit

      await expect(renter).toHaveURL(/\/bookings\/confirmation\?bookingId=.+/)
      await expect(renter.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible()

      bookingCode = (await renter.locator('span.font-mono').first().innerText()).trim()
      expect(bookingCode).toMatch(BOOKING_CODE_RE)
      await expect(renter.getByText('Confirmed', { exact: true })).toBeVisible()
    })

    await test.step('6a. operator calendar shows the new booking', async () => {
      // `page` is the project-default OPERATOR_OWNER session. The bookings surface is
      // now a fleet *calendar* (#525), not a table: events are windowed, so anchor on
      // the booking's far-future month (clear of the seeded ~-5..+7d bookings, so this
      // run's booking is the only event in view). Month view ignores the day-view
      // vehicle-resource columns, so the event renders regardless of car assignment.
      // The event is titled with the renter; clicking it opens the trip detail, which
      // carries the per-run unique reservation code — the token that ties it to THIS run.
      await page.goto('/en/manage/bookings?view=month&date=2026-07-15')
      await expect(page.getByRole('heading', { name: 'Bookings' })).toBeVisible()
      const event = page.getByText(RENTER_NAME).first()
      await expect(event).toBeVisible({ timeout: 20_000 })
      await event.click()
      await expect(page).toHaveURL(new RegExp(`/manage/bookings/${UUID}`))
      await expect(page.getByText(bookingCode)).toBeVisible({ timeout: 20_000 })
    })

    await test.step('6b. slice-7 wrote the operator notification for this booking', async () => {
      // The literal "confirmation notification": a renter DIRECT booking emits an
      // OPERATOR_BOOKING_ALERT notification_log row, scoped to this operator
      // (BookingPostCommitDispatcher). Poll briefly — it is written post-commit.
      const count = await pollOperatorAlertCount()
      expect(count).toBeGreaterThanOrEqual(1)
    })

    await renterContext.close()
  })
})

/** Delete the future-window Sarah bookings this spec created, children first (FK order). */
async function cleanupFutureSarahBookings(): Promise<void> {
  const sql = testSql()
  try {
    const ids = await sql<{ id: string }[]>`
      SELECT b.id FROM bookings b
      JOIN users u ON u.id = b."renterId"
      WHERE u.email = ${RENTER_EMAIL} AND b."startAt" >= '2026-07-01'
    `
    if (ids.length === 0) return
    const bookingIds = ids.map((r) => r.id)
    await sql`DELETE FROM notification_log WHERE "bookingId" IN ${sql(bookingIds)}`
    await sql`DELETE FROM booking_events WHERE "bookingId" IN ${sql(bookingIds)}`
    await sql`DELETE FROM threads WHERE "bookingId" IN ${sql(bookingIds)}`
    await sql`DELETE FROM bookings WHERE id IN ${sql(bookingIds)}`
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** Count OPERATOR_BOOKING_ALERT rows for a future Sarah booking; poll post-commit. */
async function pollOperatorAlertCount(): Promise<number> {
  const sql = testSql()
  try {
    for (let attempt = 0; attempt < 10; attempt++) {
      const rows = await sql<{ n: number }[]>`
        SELECT count(*)::int AS n
        FROM notification_log n
        JOIN bookings b ON b.id = n."bookingId"
        JOIN users u ON u.id = b."renterId"
        WHERE u.email = ${RENTER_EMAIL}
          AND b."startAt" >= '2026-07-01'
          AND n.kind = 'OPERATOR_BOOKING_ALERT'
      `
      const n = rows[0]?.n ?? 0
      if (n >= 1) return n
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    return 0
  } finally {
    await sql.end({ timeout: 5 })
  }
}
