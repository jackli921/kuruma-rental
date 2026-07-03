import { expect, test } from '@playwright/test'
import { RENTER_STORAGE_STATE } from './constants'
import { testSql } from './pg'

// #464 renter class-combo booking journey. Sibling of marketplace-happy-path:
// where that proves a SPECIFIC (concrete-car) booking, this proves the CLASS_COMBO
// path end to end on the REAL Vite web -> Hono API -> seeded Postgres stack, as an
// authenticated RENTER:
//
//   "search -> the pickup store -> the store's 'Class deals' section -> the 5-step
//    wizard priced off the class rate plan -> a confirmation that names the CLASS
//    and notes a car is assigned before pickup."
//
// A combo books a vehicle *class*, not a car: the operator assigns the exact car
// before pickup, so the confirmation floats (assignedVehicleId=null) and shows the
// class label + an assignment note instead of a vehicle name. The final step
// assigns a concrete car (via SQL, mirroring how the happy-path reads DB state) and
// proves the renter then sees that car's name and the note disappears.
//
// NOTE on the discovery surface: the class deal is reached via the store's always-on
// "Class deals" section (ClassOfferingCard, #464). The car-first search *also* renders
// a CLASS_COMBO row (SearchResultRow ComboRow), but that view is gated behind the
// build-time VITE_SEARCH_MAP_ENABLED flag — the beta build and this real-DB lane
// (playwright.real-db.config.ts) leave it OFF, so /search renders the store grid.
// Routing through the store card keeps the spec green in the exact config CI runs.
//
// Selectors are grounded in the shipped Vite UI (store grid / storefront
// ClassOfferingCard / #460 wizard / #511 confirmation), preferring role/text over
// brittle CSS, with the exact English strings from packages/web/messages/en.json.

// Booking-code alphabet (api/lib/booking-code.ts BOOKING_CODE_PATTERN). Inlined:
// @kuruma/api TS can't be required from this CJS-transformed Playwright file.
const BOOKING_CODE_RE = /^[2-9A-HJ-NP-Z]{8}$/

// The renter persona the auth setup mints (RENTER_SEED_EMAIL). Resolve the renter
// by EMAIL in SQL, never by a slug — the seed mints UUID ids (db/seed-id.ts).
const RENTER_EMAIL = 'sarah@example.test'

// Best Car Rental's Namba store is the only seeded location with ACTIVE class rate
// plans (seed-data/class-rate-plans.ts — Kei / Compact / SUV) AND road-legal, in-
// class inventory, so a CLASS_COMBO card actually surfaces for the window and is
// not sold out. The Kei class carries two AVAILABLE Namba cars, so the far-future
// window never sees it sold out.
const OPERATOR_NAME = 'Best Car Rental'
const STORE_NAME = 'Namba'
const CLASS_LABEL = 'Kei car'

// Real ids are UUIDs (db/seed-id.ts) — asserting the shape also proves the combo
// flow carries a classId/locationId the .uuid() API guard accepts.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

// A far-future window, clear of the seeded bookings (which span demo-time-relative
// ~-5..+7 days) so the combo class always reads AVAILABLE. Anchored to the 15th of
// the month TWO months out and computed RELATIVE TO TODAY: a hard-coded calendar
// date silently rots into the seed range as real time advances (#1401).
const pad = (n: number) => String(n).padStart(2, '0')
const isoDate = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
const NOW = new Date()
// Date.UTC normalises a month index past 11 into the next year, so +2 stays year-safe.
const WINDOW_START = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 2, 15))
const WINDOW_END = new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() + 2, 17))
// `datetime-local` wall-clock (parsed as JST) carried through the search + booking links.
const FROM = `${isoDate(WINDOW_START)}T10:00`
const TO = `${isoDate(WINDOW_END)}T10:00`

// Acceptance #2: a combo is "priced off the class rate plan (no per-vehicle rate)".
// The Kei plan for Namba (crp_best_kei_namba) charges ¥6,000/day
// (seed-data/class-rate-plans.ts). The window above is 15th 10:00 -> 17th 10:00 JST
// = exactly 48h, and combos bill in whole rental days (rentalDays = ceil(48h/24h) = 2,
// lib/pricing.ts booking-creation.ts:577). No insurance/add-on is selected in the
// wizard below, so composeBookingTotal leaves total == base == 2 x ¥6,000 = ¥12,000.
const CLASS_DAY_RATE_JPY = 6_000
const RENTAL_DAYS = 2
const EXPECTED_TOTAL_JPY = CLASS_DAY_RATE_JPY * RENTAL_DAYS
// The exact rendered figure — mirrors lib/format.ts formatJpy (ja-JP / JPY / no minor
// unit): "￥12,000". Deriving it via the same Intl config guarantees byte-identity with
// what the confirmation DOM renders, so a mispricing (0 / NaN / wrong plan) can't pass.
const yenFmt = new Intl.NumberFormat('ja-JP', {
  style: 'currency',
  currency: 'JPY',
  maximumFractionDigits: 0,
})
const EXPECTED_TOTAL_YEN = yenFmt.format(EXPECTED_TOTAL_JPY)

test.describe('renter class-combo booking journey (real DB)', () => {
  test.afterAll(cleanupFutureComboBookings)

  test('search -> class deal -> store -> wizard -> confirmation names the class', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000) // Vite builds each route on first hit; real-DB round-trips

    const renterContext = await browser.newContext({ storageState: RENTER_STORAGE_STATE, baseURL })
    const renter = await renterContext.newPage()

    await test.step('1. search surfaces the operator storefront for the window', async () => {
      await renter.goto(`/en/search?from=${FROM}&to=${TO}`)
      await expect(renter).toHaveURL(/\/search\?from=.+&to=.+/)

      // The store grid (beta results view) lists each storefront available for the
      // window; only Namba's card carries "Namba", so filtering the links by it
      // targets that store's card unambiguously (mirrors the happy-path).
      const storeLink = renter.getByRole('link').filter({ hasText: STORE_NAME }).first()
      await expect(storeLink).toBeVisible({ timeout: 20_000 })
      await storeLink.click()
    })

    await test.step('2. the store page lists this operator and its "Class deals" section', async () => {
      await expect(renter).toHaveURL(new RegExp(`/storefronts/${UUID}\\?from=.+&to=.+`))
      await expect(
        renter.getByRole('heading', { name: STORE_NAME, level: 1, exact: true }),
      ).toBeVisible()
      await expect(renter.getByText(OPERATOR_NAME).first()).toBeVisible()
      await expect(renter.getByRole('heading', { name: 'Class deals', level: 2 })).toBeVisible()
    })

    await test.step('3. picking the class deal opens the wizard on the class subject', async () => {
      // Scope to the "Class deals" section, then the card that has BOTH the class
      // heading and its "Book this class" link — so the specific card we click is
      // deterministic (its class label is what the confirmation must echo).
      const classDeals = renter
        .locator('section')
        .filter({ has: renter.getByRole('heading', { name: 'Class deals', level: 2 }) })
      const dealCard = classDeals
        .locator('div')
        .filter({ has: renter.getByRole('heading', { name: CLASS_LABEL, level: 3 }) })
        .filter({ has: renter.getByRole('link', { name: 'Book this class' }) })
        .last()
      await expect(dealCard).toBeVisible()
      await dealCard.getByRole('link', { name: 'Book this class' }).click()

      // A combo entry carries classId (not vehicleId) — the loader resolves it to a
      // CLASS_COMBO subject and the wizard prices off the class rate plan (#464).
      await expect(renter).toHaveURL(/\/bookings\/new\?.*classId=/)
      await expect(renter.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
    })

    let bookingCode = ''
    let bookingId = ''
    await test.step('4-5. step the wizard; the combo confirms with a class + assignment note', async () => {
      // 5-step wizard (#460): dates -> addOns -> insurance -> confirm -> payment.
      // Dates are pre-filled & read-only; add-ons are optional (skip); insurance
      // defaults to "No insurance" (decline). Gate each step on its own marker.
      await renter.getByRole('button', { name: 'Continue', exact: true }).click() // dates -> addOns
      await expect(renter.getByText('Add optional extras')).toBeVisible()

      await renter.getByRole('button', { name: 'Continue', exact: true }).click() // addOns -> insurance
      await expect(renter.getByText('No insurance')).toBeVisible()

      await renter.getByRole('button', { name: 'Continue', exact: true }).click() // insurance -> confirm
      await expect(renter.getByText('Review your booking')).toBeVisible()
      // The review step carries the combo-only note that the exact car is assigned
      // later — proof the wizard is on the CLASS_COMBO branch, not a SPECIFIC one.
      await expect(
        renter.getByText('A specific car in this class will be assigned before pickup.'),
      ).toBeVisible()

      await renter.getByRole('button', { name: 'Continue to payment' }).click() // confirm -> payment
      await expect(renter.getByRole('heading', { name: 'Confirm and reserve' })).toBeVisible()
      // Reserve is gated on the liability-disclaimer consent (#613) — acknowledge
      // before the instant-book submit, or the button stays disabled.
      await renter.getByRole('checkbox').check()
      await renter.getByRole('button', { name: 'Reserve now' }).click() // instant-book submit

      await expect(renter).toHaveURL(/\/bookings\/confirmation\?bookingId=.+/)
      await expect(renter.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible()

      // Capture this run's booking id (asserted UUID-shaped) so the assign step targets it.
      bookingId = new URL(renter.url()).searchParams.get('bookingId') ?? ''
      expect(bookingId).toMatch(new RegExp(`^${UUID}$`))

      bookingCode = (await renter.locator('span.font-mono').first().innerText()).trim()
      expect(bookingCode).toMatch(BOOKING_CODE_RE)
      await expect(renter.getByText('Confirmed', { exact: true })).toBeVisible()

      // The confirmation names the CLASS (no car yet) and notes a car is assigned
      // before pickup — the acceptance sentence for a floating combo booking.
      await expect(renter.getByText(CLASS_LABEL)).toBeVisible()
      await expect(renter.getByText('A specific car will be assigned before pickup.')).toBeVisible()

      // Acceptance #2 — the money path. The price-breakdown <dl> (the only one on the
      // confirmation, BookingConfirmationView.tsx) renders one <dd> per row. With no
      // insurance/add-on selected the rows are exactly [base, total], and a combo prices
      // off the class rate plan alone, so both read ¥12,000 (2 days x ¥6,000/day). The
      // count-of-2 fails a stray per-vehicle rate or an unexpected insurance/add-on line;
      // the exact-yen strings fail a mispricing (0 / NaN / wrong plan) — none ship green.
      const priceCells = renter.locator('dl').first().locator('dd')
      await expect(priceCells).toHaveCount(2)
      // The base cell is the exact rendered yen (formatJpy, no trailing note).
      await expect(priceCells.nth(0)).toHaveText(EXPECTED_TOTAL_YEN)
      // The total cell leads with the authoritative yen; an optional indicative "≈ $x"
      // note (#1070 multi-currency, enabled in this lane) may trail it, so match the yen
      // as a scoped substring — the ¥ glyph anchors it, so no wrong total can satisfy it.
      await expect(priceCells.nth(1)).toContainText(EXPECTED_TOTAL_YEN)
    })

    await test.step('6. operator assigns a car; the renter then sees the concrete vehicle', async () => {
      // Assign a same-class, same-location AVAILABLE car directly (mirrors how the
      // happy-path reaches into the seeded DB). The renter's GET /bookings/:id
      // ?expand=vehicle,renter then carries the concrete car, so a reload replaces
      // the class row + note with the assigned vehicle's name.
      const assignedName = await assignConcreteVehicle(bookingId)
      expect(assignedName).not.toBe('')

      await renter.reload()
      await expect(renter.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible()
      await expect(renter.getByText(assignedName)).toBeVisible()
      await expect(renter.getByText('A specific car will be assigned before pickup.')).toHaveCount(
        0,
      )
    })

    await renterContext.close()
  })
})

/**
 * Assign the booking a concrete car of its own class + pickup location (an
 * AVAILABLE seed vehicle the far-future window leaves free). Returns the assigned
 * car's name for the post-assign assertion. Bypasses the operator UI on purpose —
 * this spec proves the RENTER-visible effect of an assignment, not the assign flow.
 */
async function assignConcreteVehicle(bookingId: string): Promise<string> {
  const sql = testSql()
  try {
    const [vehicle] = await sql<{ id: string; name: string }[]>`
      SELECT v.id, v.name
      FROM vehicles v
      JOIN bookings b ON b.id = ${bookingId}
      WHERE v."classId" = b."classId"
        AND v."pickupLocationId" = b."pickupLocationId"
        AND v.status = 'AVAILABLE'
      ORDER BY v."licensePlate"
      LIMIT 1
    `
    if (!vehicle) return ''
    await sql`UPDATE bookings SET "assignedVehicleId" = ${vehicle.id} WHERE id = ${bookingId}`
    return vehicle.name
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** Delete the future-window Sarah bookings this spec created, children first (FK order). */
async function cleanupFutureComboBookings(): Promise<void> {
  const sql = testSql()
  try {
    const ids = await sql<{ id: string }[]>`
      SELECT b.id FROM bookings b
      JOIN users u ON u.id = b."renterId"
      WHERE u.email = ${RENTER_EMAIL} AND b."startAt" >= ${WINDOW_START}
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
