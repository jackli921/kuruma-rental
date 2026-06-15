import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { RENTER_STORAGE_STATE } from './constants'
import { testSql } from './pg'

// #656 (Slice 4 of #652): the two real-DB journeys the happy-path lane leaves
// uncovered. (A) a renter books WITH a paid add-on + insurance and the order's
// itemised line items sum to the total (the "S1 composition"); (B) the
// negative-consent refusal — a renter booking POST without the #613 liability
// disclaimer is rejected 400 CONSENT_REQUIRED (routes/bookings.ts:162). The
// happy path already exercises the positive, no-extras path
// (marketplace-happy-path.auth.spec.ts:114); this slice adds the gaps.
//
// Selectors are grounded in the shipped Vite 5-step wizard (#460): AddOnsStep
// checkbox, InsuranceStep radio, ConfirmStep itemised <dl>, PaymentStep consent.

const RENTER_EMAIL = 'sarah@example.test'

// Best Car Rental (the KIX storefront operator) seeds these extras
// (seed-data/add-ons.ts, seed-data/insurance.ts). The add-on is a FLAT per-booking
// charge (deterministic); insurance is per-day so we assert it via the sum identity.
const STOREFRONT_NAME = 'Kansai Airport (KIX)'
const ADD_ON_NAME = 'Child seat'
const ADD_ON_PRICE_JPY = 1100
const INSURANCE_NAME = 'Normal'

// A far-future window distinct from the happy-path's 2026-07 window, so the two
// specs never contend for KIX's 4 vehicles in the same window. `datetime-local`
// wall-clock (parsed as JST).
const FROM = '2026-09-10T10:00'
const TO = '2026-09-12T10:00'

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/

/** Strip yen formatting (¥, commas, spaces) down to the integer amount. */
function yen(text: string): number {
  const digits = text.replace(/[^0-9]/g, '')
  return digits ? Number.parseInt(digits, 10) : Number.NaN
}

test.describe('booking extras + consent (real DB)', () => {
  test.afterAll(cleanupFutureSarahBookings)

  test('A: renter books with an add-on + insurance; line items sum to the total', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000) // Vite builds each route on first hit; real-DB round-trips
    const renterContext = await browser.newContext({ storageState: RENTER_STORAGE_STATE, baseURL })
    const renter = await renterContext.newPage()

    await test.step('search -> storefront -> vehicle opens the wizard', async () => {
      await renter.goto('/en/search')
      await renter.locator('#from').fill(FROM)
      await renter.locator('#to').fill(TO)
      await renter.getByRole('button', { name: 'Search' }).click()

      // Gate each hop on its own landmark so a slow render fails as "storefront
      // never loaded" / "wizard URL wrong", not an opaque late "Continue missing".
      const storefront = renter.getByRole('link').filter({ hasText: STOREFRONT_NAME }).first()
      await expect(storefront).toBeVisible()
      await storefront.click()

      await renter.getByRole('link', { name: 'Book this car' }).first().click()
      await expect(renter).toHaveURL(/\/bookings\/new\?vehicleId=.+&locationId=.+/)
      await expect(renter.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
    })

    await test.step('pick the add-on, then the insurance tier', async () => {
      await renter.getByRole('button', { name: 'Continue', exact: true }).click() // dates -> addOns
      await expect(renter.getByText('Add optional extras')).toBeVisible()
      await renter.getByRole('checkbox', { name: new RegExp(`^${ADD_ON_NAME}`) }).check()

      await renter.getByRole('button', { name: 'Continue', exact: true }).click() // addOns -> insurance
      await expect(renter.getByText('No insurance')).toBeVisible()
      await renter.getByRole('radio', { name: new RegExp(`^${INSURANCE_NAME}`) }).check()
    })

    await test.step('confirm step itemises base + insurance + add-on and they sum to the total', async () => {
      await renter.getByRole('button', { name: 'Continue', exact: true }).click() // insurance -> confirm
      await expect(renter.getByText('Review your booking')).toBeVisible()

      // The chosen extras are itemised by name on the breakdown.
      await expect(renter.getByText(INSURANCE_NAME).first()).toBeVisible()
      await expect(renter.getByText(ADD_ON_NAME).first()).toBeVisible()

      // The price <dl> (first on the page; CancellationPolicy follows it) renders one
      // <dd> per row, in order: base, insurance, add-ons, total — 4 rows because both
      // a paid insurance tier AND an add-on were selected.
      const cells = await renter.locator('dl').first().locator('dd').allInnerTexts()
      expect(cells).toHaveLength(4)
      const [base, insurance, addOns, total] = cells.map(yen)
      expect(addOns).toBe(ADD_ON_PRICE_JPY) // flat per-booking add-on price
      expect(insurance ?? 0).toBeGreaterThan(0) // per-day, > 0 because a paid tier was chosen
      expect(total).toBe((base ?? 0) + (insurance ?? 0) + (addOns ?? 0)) // composition identity
    })

    let bookingId = ''
    await test.step('consent gates the submit; reserve lands on confirmation', async () => {
      await renter.getByRole('button', { name: 'Continue to payment' }).click()
      await expect(renter.getByRole('heading', { name: 'Confirm and reserve' })).toBeVisible()

      // #613: the submit stays disabled until the liability disclaimer is ticked.
      const reserve = renter.getByRole('button', { name: 'Reserve now' })
      await expect(reserve).toBeDisabled()
      await renter.getByRole('checkbox').check()
      await expect(reserve).toBeEnabled()
      await reserve.click()

      await expect(renter).toHaveURL(/\/bookings\/confirmation\?bookingId=.+/)
      await expect(renter.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible()
      bookingId = new URL(renter.url()).searchParams.get('bookingId') ?? ''
      expect(bookingId).toMatch(UUID_RE)
    })

    await test.step('the booking locked the insurance + add-on snapshots onto the row', async () => {
      // The confirmation page renders the insurance snapshot (name + per-day); add-ons
      // are not shown there, so we prove BOTH extras persisted by reading the row.
      await expect(renter.getByText(INSURANCE_NAME).first()).toBeVisible()
      const snap = await readSnapshots(bookingId)
      expect(snap.insuranceName).toBe(INSURANCE_NAME)
      expect(snap.addOnNames).toContain(ADD_ON_NAME)
    })

    await renterContext.close()
  })

  test('B: a renter booking POST without disclaimer consent is refused 400 CONSENT_REQUIRED', async ({
    browser,
    baseURL,
  }) => {
    const renterContext = await browser.newContext({ storageState: RENTER_STORAGE_STATE, baseURL })

    // The UI disables Reserve without consent (journey A), so the API guard is only
    // reachable by a non-UI client. CSRF is double-submit: echo the session's token
    // (GET /auth/session), then POST a schema-valid body that simply OMITS
    // disclaimerAccepted — parseBody passes, then the role-gated consent guard
    // (bookings.ts:162) rejects it before any vehicle/date logic, so random UUIDs
    // are fine here.
    const sessionRes = await renterContext.request.get('/auth/session')
    expect(sessionRes.ok()).toBe(true)
    const csrfToken = (await sessionRes.json()).data.csrfToken as string
    expect(csrfToken).toBeTruthy()

    const requestedVehicleId = randomUUID()
    const res = await renterContext.request.post('/api/bookings', {
      headers: { 'X-CSRF-Token': csrfToken },
      data: {
        requestedVehicleId,
        pickupLocationId: randomUUID(),
        dropoffLocationId: randomUUID(),
        startAt: '2026-09-20T01:00:00.000Z',
        endAt: '2026-09-22T01:00:00.000Z',
        addOnIds: [],
      },
    })

    expect(res.status()).toBe(400)
    expect((await res.json()).code).toBe('CONSENT_REQUIRED')

    // The guard must precede any persistence: a consent-refused POST creates nothing.
    // Keyed on this run's unique requestedVehicleId so it can't alias journey A's row.
    expect(await countBookingsForVehicle(requestedVehicleId)).toBe(0)

    await renterContext.close()
  })
})

/** Read the persisted snapshots for a booking — proves the extras locked onto the row. */
async function readSnapshots(
  bookingId: string,
): Promise<{ insuranceName: string | null; addOnNames: string[] }> {
  const sql = testSql()
  try {
    const rows = await sql<
      { insuranceSnapshot: { name: string } | null; addOnSnapshot: { name: string }[] | null }[]
    >`SELECT "insuranceSnapshot", "addOnSnapshot" FROM bookings WHERE id = ${bookingId}`
    const row = rows[0]
    return {
      insuranceName: row?.insuranceSnapshot?.name ?? null,
      addOnNames: (row?.addOnSnapshot ?? []).map((a) => a.name),
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** Count bookings carrying a given requestedVehicleId — 0 proves a POST persisted nothing. */
async function countBookingsForVehicle(requestedVehicleId: string): Promise<number> {
  const sql = testSql()
  try {
    const rows = await sql<{ n: number }[]>`
      SELECT count(*)::int AS n FROM bookings WHERE "requestedVehicleId" = ${requestedVehicleId}
    `
    return rows[0]?.n ?? 0
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** Delete the future-window Sarah booking this spec created, children first (FK order). */
async function cleanupFutureSarahBookings(): Promise<void> {
  const sql = testSql()
  try {
    const ids = await sql<{ id: string }[]>`
      SELECT b.id FROM bookings b
      JOIN users u ON u.id = b."renterId"
      WHERE u.email = ${RENTER_EMAIL} AND b."startAt" >= '2026-09-01'
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
