import { expect, test } from '@playwright/test'
import { RENTER_STORAGE_STATE } from './constants'
import { testSql } from './pg'

// #840 / #651 §9 — renter region search on the REAL Vite web -> Hono API ->
// seeded Postgres stack. Proves the two things the component unit tests (which
// mock the API + <Link>) cannot reach end to end:
//   1. the REAL recursive region-subtree filter (the Drizzle BFS over `regions`)
//      narrows results to the chosen node's descendants, and
//   2. Slice C: the chosen region slug survives search -> detail -> back on the
//      real TanStack router, and a region-filtered store is genuinely bookable.
//
// Distance *ordering* across many stores stays unit-tested (StoreGrid FAR/NEAR):
// each seeded AREA holds exactly one store and the multi-store nodes
// (city/prefecture) are coordless by design, so the UI can show breadth OR a
// ranking anchor, never both — there is nothing extra for an e2e to prove there.

const RENTER_EMAIL = 'sarah@example.test'

// Booking-code alphabet (api/lib/booking-code.ts BOOKING_CODE_PATTERN), inlined —
// @kuruma/api TS can't be required from this CJS-transformed Playwright file.
const BOOKING_CODE_RE = /^[2-9A-HJ-NP-Z]{8}$/
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

// Far-future window, clear of the demo-relative seeded bookings (~-5..+7d): every
// store keeps a free fleet, so the region filter — not availability — drives the
// result set. `datetime-local` wall-clock (parsed as JST).
const FROM = '2026-07-15T10:00'
const TO = '2026-07-17T10:00'

// The KIX area (slug `kix`) is a leaf: its subtree is one store, Best Car Rental's
// "Kansai Airport (KIX)". Its region centre == that store's coords, so the store
// ranks at ~0.0 km — convenient: a chosen-area search must render a distance label.
const KIX_STORE = 'Kansai Airport (KIX)'
const NAMBA_STORE = 'Namba' // Osaka City -> a different child city than KIX's Izumisano
const KYOTO_STORE = 'Kyoto Station' // a different PREFECTURE — must be filtered out

test.describe('renter region search — subtree filter + nav threading + book (real DB)', () => {
  test.afterAll(cleanupFutureSarahBookings)

  test('pick an area: filtered + labelled, region survives detail/back, then books', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000) // Vite builds each route on first hit; real-DB round-trips

    const renterContext = await browser.newContext({ storageState: RENTER_STORAGE_STATE, baseURL })
    const renter = await renterContext.newPage()

    await test.step('1. pick the KIX area chip, then search', async () => {
      // Seed the pickup/return range via the URL (the route prefills the refine
      // form from it, #965) so this step exercises the region chip + Search.
      await renter.goto(`/en/search?from=${FROM}&to=${TO}`)
      // The quick-pick chip resolves to ?region=kix (the slug, never the re-seed-
      // unstable UUID — §6 Decision 6). It is a type="button", so it never submits.
      await renter.getByRole('button', { name: KIX_STORE }).click()
      await renter.getByRole('button', { name: 'Search' }).click()
      await expect(renter).toHaveURL(/[?&]region=kix\b/)
    })

    await test.step('2. the real subtree filter shows only the in-region store, with a distance label', async () => {
      await expect(renter.getByRole('heading', { level: 2, name: KIX_STORE })).toBeVisible()
      // Out-of-subtree stores are excluded by the real Drizzle descendant filter.
      await expect(renter.getByRole('heading', { level: 2, name: KYOTO_STORE })).toHaveCount(0)
      await expect(renter.getByRole('heading', { level: 2, name: NAMBA_STORE })).toHaveCount(0)
      // Anchor -> Haversine -> "~N km" label, proven against the real coords
      // projection (the StorefrontCard DTO gained latitude/longitude in #841).
      await expect(renter.getByText(/~\d+\.\d+ km/).first()).toBeVisible()
    })

    await test.step('3. region survives the drill-down into the storefront (#840)', async () => {
      await renter.getByRole('link').filter({ hasText: KIX_STORE }).first().click()
      await expect(renter).toHaveURL(new RegExp(`/storefronts/${UUID}\\?.*[?&]region=kix\\b`))
      await expect(renter.getByRole('heading', { name: KIX_STORE })).toBeVisible()
    })

    await test.step('4. region survives the back-to-search link (#840)', async () => {
      await renter.getByRole('link', { name: 'Back to search' }).click()
      await expect(renter).toHaveURL(/[?&]region=kix\b/)
      // Still the region-filtered view after returning.
      await expect(renter.getByRole('heading', { level: 2, name: KIX_STORE })).toBeVisible()
    })

    let bookingCode = ''
    await test.step('5. a region-filtered store is a real, bookable storefront (§9)', async () => {
      await renter.getByRole('link').filter({ hasText: KIX_STORE }).first().click()
      await renter.getByRole('link', { name: 'Book this car' }).first().click()
      await expect(renter).toHaveURL(
        new RegExp(`/bookings/new\\?vehicleId=${UUID}&locationId=${UUID}`),
      )

      // 5-step wizard (#460): dates(read-only) -> addOns -> insurance -> confirm ->
      // payment. Gate each step on its own marker before advancing.
      await renter.getByRole('button', { name: 'Continue', exact: true }).click()
      await expect(renter.getByText('Add optional extras')).toBeVisible()
      await renter.getByRole('button', { name: 'Continue', exact: true }).click()
      await expect(renter.getByText('No insurance')).toBeVisible()
      await renter.getByRole('button', { name: 'Continue', exact: true }).click()
      await expect(renter.getByText('Review your booking')).toBeVisible()
      await renter.getByRole('button', { name: 'Continue to payment' }).click()
      // Reserve is gated on the liability-disclaimer consent (#613).
      await renter.getByRole('checkbox').check()
      await renter.getByRole('button', { name: 'Reserve now' }).click()

      await expect(renter).toHaveURL(/\/bookings\/confirmation\?bookingId=.+/)
      await expect(renter.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible()
      bookingCode = (await renter.locator('span.font-mono').first().innerText()).trim()
      expect(bookingCode).toMatch(BOOKING_CODE_RE)
    })

    await renterContext.close()
  })

  test('pick a prefecture: the whole subtree is shown across cities; other prefectures excluded', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000)

    const renterContext = await browser.newContext({ storageState: RENTER_STORAGE_STATE, baseURL })
    const renter = await renterContext.newPage()

    await renter.goto(`/en/search?from=${FROM}&to=${TO}`)
    // Anchor at the prefecture level (coordless): a subtree filter only, no ranking.
    // The cascade emits that node's slug at any level (§6).
    await renter.getByLabel('Prefecture').selectOption({ label: 'Osaka' })
    await renter.getByRole('button', { name: 'Search' }).click()
    await expect(renter).toHaveURL(/[?&]region=osaka\b/)

    // Osaka prefecture -> descendants across TWO different child cities: Namba
    // (Osaka City) AND Kansai Airport (Izumisano). Both appear -> the recursive
    // descendant resolution walks more than one level. "All stores still shown."
    await expect(renter.getByRole('heading', { level: 2, name: NAMBA_STORE })).toBeVisible()
    await expect(renter.getByRole('heading', { level: 2, name: KIX_STORE })).toBeVisible()
    // A store in a different prefecture is excluded.
    await expect(renter.getByRole('heading', { level: 2, name: KYOTO_STORE })).toHaveCount(0)
    expect(await renter.getByRole('heading', { level: 2 }).count()).toBeGreaterThanOrEqual(2)

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
