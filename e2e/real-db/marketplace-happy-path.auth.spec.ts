import { expect, test } from '@playwright/test'
import { RENTER_STORAGE_STATE } from './constants'
import { testSql } from './pg'

// Slice 8 (#390) interim core-path milestone — the merge gate (plan §5/§6.1).
// Proves the acceptance sentence end to end on the REAL web -> Hono API ->
// seeded Neon branch stack (lane #416), across TWO authenticated actors:
//
//   "renter search -> storefront result -> vehicle selection -> booking ->
//    confirmation notification visible in the operator portal".
//
// Steps 1-5 run in a RENTER browser context (the API forces renterId =
// ctx.userId for non-staff, so the booking must be made AS the renter). Step 6
// reuses the project-default OPERATOR_OWNER `page` to read the operator portal.
//
// Selectors are grounded in the merged slice-5/6/7 UI (not the mock skeleton in
// e2e/marketplace-happy-path.spec.ts, whose fixtures predate the real pages).

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
// ~-5..+7 days). Keeps a fleet of vehicles available and isolates the new booking
// on the operator's July calendar. `datetime-local` wall-clock (parsed as JST).
const FROM = '2026-07-15T10:00'
const TO = '2026-07-17T10:00'
const BOOKING_MONTH = '2026-07-15' // operator calendar ?date — month view spans it

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
    test.setTimeout(120_000) // cold Next dev compiles each route on first hit

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
      await expect(renter.getByText(OPERATOR_NAME)).toBeVisible()
    })

    await test.step('3. vehicle selection carries vehicle + location + dates into the form', async () => {
      await renter.getByRole('link', { name: 'Book this car' }).first().click()
      await expect(renter).toHaveURL(
        new RegExp(`/bookings/new\\?vehicleId=${UUID}&locationId=${UUID}`),
      )
      await expect(renter.getByRole('heading', { name: 'Confirm your booking' })).toBeVisible()
    })

    let bookingCode = ''
    await test.step('4-5. booking confirms with a no-confusables reservation code', async () => {
      // Default insurance = decline (optional coverage); the renter just confirms.
      await renter.getByRole('button', { name: 'Confirm booking' }).click()

      await expect(renter).toHaveURL(/\/bookings\/confirmation\?bookingId=.+/)
      await expect(renter.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible()

      bookingCode = (await renter.locator('span.font-mono').first().innerText()).trim()
      expect(bookingCode).toMatch(BOOKING_CODE_RE)
      await expect(renter.getByText('Confirmed', { exact: true })).toBeVisible()
    })

    await test.step('6a. operator portal shows the new booking on the calendar', async () => {
      // `page` is the project-default OPERATOR_OWNER session. Month view spans the
      // booking day regardless of the runner timezone; the calendar event title is
      // the renter name (BookingsCalendar.toCalendarEvents).
      await page.goto(`/en/manage/bookings?view=month&date=${BOOKING_MONTH}`)
      await expect(page.getByRole('heading', { name: 'Bookings' })).toBeVisible()
      await expect(page.getByText(RENTER_NAME).first()).toBeVisible({ timeout: 20_000 })
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
