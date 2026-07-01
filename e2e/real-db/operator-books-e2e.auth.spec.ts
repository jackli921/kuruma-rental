import { expect, test } from '@playwright/test'
import { RENTER_STORAGE_STATE } from './constants'
import { testSql } from './pg'

// #1257 — operator-authored bookable inventory, end to end on the REAL Vite web ->
// Hono API -> seeded Postgres stack, across TWO authenticated actors:
//
//   "an operator creates a location + an AVAILABLE vehicle (with a pickup location,
//    #1262) purely through the fleet UI -> a renter searches, finds THAT vehicle,
//    and books it -> the operator sees the booking".
//
// This is the first real-DB spec that mints inventory through the fleet form rather
// than reading the seed. It is the acceptance test for #1262: before that fix a
// UI-created vehicle had pickupLocationId = null and never surfaced in storefront
// search, so this whole journey was impossible. The operator half runs on the
// project-default OPERATOR_OWNER `page`; the renter half runs in a RENTER context
// (the API forces renterId = ctx.userId for non-staff, so the booking is made AS
// the renter). Renter selectors are the shipped #458 search / #460 wizard / #511
// confirmation, mirrored from marketplace-happy-path.auth.spec.ts.

// Booking-code alphabet (api/lib/booking-code.ts BOOKING_CODE_PATTERN). Inlined:
// @kuruma/api TS can't be required from this CJS-transformed Playwright file.
const BOOKING_CODE_RE = /^[2-9A-HJ-NP-Z]{8}$/
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

const RENTER_NAME = 'Sarah Smith'

// A stable marker prefix (NOT a per-run random): teardown runs before AND after via
// LIKE so a crashed mid-run can never leave orphans that accumulate across re-runs
// of a reused local branch. Fixed names also keep the region-slug lookup + the
// storefront/vehicle selectors deterministic.
const MARKER = 'e2e-1257'
const LOCATION_NAME = `${MARKER} Namba depot`
const VEHICLE_NAME = `${MARKER} Aqua`
const LOCATION_ADDRESS = '2-1-1 Namba, Chuo-ku, Osaka'

// Far-future window, clear of the seed's demo-relative (~-5..+7d) and every other
// real-DB spec's window (Jul/Aug 2026, Aug 2027). The vehicle we mint carries far-
// future compliance dates (below) so it is road-legal through this window.
const FROM = '2027-03-16T10:00'
const TO = '2027-03-18T10:00'
const OPERATOR_MONTH = '2027-03-16'

// Compliance dates must be future-dated at create time (createVehicleSchema, #916)
// and stay valid through the booking window — a fixed far-future date satisfies both.
const COMPLIANCE_DATE = '2032-12-31'
const DAILY_RATE_JPY = '9000'

test.describe('operator-authored inventory — operator lists a car, renter books it (real DB)', () => {
  test.beforeAll(cleanupInventory)
  test.afterAll(cleanupInventory)

  test('operator creates location + vehicle via the fleet UI, renter finds and books it', async ({
    page,
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000) // Vite builds each route on first hit; real-DB round-trips

    await test.step('1. operator creates a pickup location via the UI', async () => {
      await page.goto('/en/manage/locations')
      await page.getByRole('button', { name: 'Add location' }).click()
      const dialog = page.getByRole('dialog')
      await dialog.locator('#location-name').fill(LOCATION_NAME)
      await dialog.locator('#location-address').fill(LOCATION_ADDRESS)
      // Only the leaf (area) selection yields a regionId; prefecture + city narrow it.
      await dialog.locator('#region-prefecture').selectOption({ label: 'Osaka' })
      await dialog.locator('#region-city').selectOption({ label: 'Osaka City' })
      await dialog.locator('#region-area').selectOption({ label: 'Namba' })
      await dialog.getByRole('button', { name: 'Save location' }).click()
      await expect(page.getByRole('heading', { name: LOCATION_NAME, exact: true })).toBeVisible()
    })

    await test.step('2. operator creates an AVAILABLE vehicle attached to that location (#1262)', async () => {
      await page.goto('/en/manage/fleet')
      await page.getByRole('button', { name: 'Add vehicle' }).click()
      const sheet = page.getByRole('dialog')
      await expect(sheet.getByRole('heading', { name: 'Add vehicle' })).toBeVisible()

      await sheet.locator('#name').fill(VEHICLE_NAME)
      // index 0 is the "Unassigned" placeholder; index 1 is the operator's first
      // seeded class. A class is required for the car to be bookable/substitutable.
      await sheet.locator('#classId').selectOption({ index: 1 })
      // The #1262 field under test: without it the car never surfaces in search.
      await sheet.locator('#pickupLocationId').selectOption({ label: LOCATION_NAME })
      await sheet.locator('#dailyRateJpy').fill(DAILY_RATE_JPY)
      await sheet.locator('#shakenExpiryDate').fill(COMPLIANCE_DATE)
      await sheet.locator('#insuranceExpiryDate').fill(COMPLIANCE_DATE)
      await sheet.getByRole('button', { name: 'Save vehicle' }).click()

      // The sheet closes and the fleet list refetches with the new car (status
      // defaults to AVAILABLE, api/services/vehicle.ts).
      await expect(page.getByText(VEHICLE_NAME).first()).toBeVisible({ timeout: 20_000 })
    })

    // Discover the region slug the cascade assigned, so the renter can run a region-
    // scoped search (a tiny result set that is robust against ungeocoded stores
    // ranking last). Resolve from the DB rather than hardcoding the seed's slug.
    const regionSlug = await lookupRegionSlug()
    expect(regionSlug, 'created location should be tied to a region').toBeTruthy()

    const renterContext = await browser.newContext({ storageState: RENTER_STORAGE_STATE, baseURL })
    const renter = await renterContext.newPage()
    let bookingCode = ''

    try {
      await test.step('3. renter search surfaces the newly-created storefront', async () => {
        await renter.goto(`/en/search?from=${FROM}&to=${TO}&region=${regionSlug}`)
        await expect(renter.getByRole('heading', { level: 2, name: LOCATION_NAME })).toBeVisible({
          timeout: 20_000,
        })
      })

      await test.step('4. renter opens the storefront and starts booking the new car', async () => {
        await renter.getByRole('link').filter({ hasText: LOCATION_NAME }).first().click()
        await expect(renter).toHaveURL(new RegExp(`/storefronts/${UUID}`))
        await expect(renter.getByRole('heading', { name: LOCATION_NAME })).toBeVisible()
        // The new location holds exactly one car (the one we just listed), so
        // "Book this car" is unambiguous.
        await renter.getByRole('link', { name: 'Book this car' }).first().click()
        await expect(renter).toHaveURL(
          new RegExp(`/bookings/new\\?vehicleId=${UUID}&locationId=${UUID}`),
        )
        await expect(renter.getByRole('button', { name: 'Continue', exact: true })).toBeVisible()
      })

      await test.step('5. renter steps through the wizard; booking confirms', async () => {
        await renter.getByRole('button', { name: 'Continue', exact: true }).click() // dates → addOns
        await expect(renter.getByText('Add optional extras')).toBeVisible()
        await renter.getByRole('button', { name: 'Continue', exact: true }).click() // addOns → insurance
        await expect(renter.getByText('No insurance')).toBeVisible()
        await renter.getByRole('button', { name: 'Continue', exact: true }).click() // insurance → confirm
        await expect(renter.getByText('Review your booking')).toBeVisible()
        await renter.getByRole('button', { name: 'Continue to payment' }).click() // confirm → payment
        await expect(renter.getByRole('heading', { name: 'Confirm and reserve' })).toBeVisible()
        await renter.getByRole('checkbox').check() // liability-disclaimer consent (#613)
        await renter.getByRole('button', { name: 'Reserve now' }).click() // instant-book submit

        await expect(renter).toHaveURL(/\/bookings\/confirmation\?bookingId=.+/)
        await expect(renter.getByRole('heading', { name: 'Booking confirmed' })).toBeVisible()
        bookingCode = (await renter.locator('span.font-mono').first().innerText()).trim()
        expect(bookingCode).toMatch(BOOKING_CODE_RE)
        await expect(renter.getByText('Confirmed', { exact: true })).toBeVisible()
      })
    } finally {
      await renterContext.close()
    }

    await test.step('6. operator sees the booking against the car it listed', async () => {
      await page.goto(`/en/manage/bookings?view=month&date=${OPERATOR_MONTH}`)
      await expect(page.getByRole('heading', { name: 'Bookings' })).toBeVisible()
      const chip = page.getByRole('button', { name: new RegExp(RENTER_NAME) }).first()
      await expect(chip).toBeVisible({ timeout: 20_000 })
      await chip.click() // pins the quick-view card
      await page.getByRole('link', { name: /View full details/ }).click()
      await expect(page).toHaveURL(new RegExp(`/manage/bookings/${UUID}`))
      await expect(page.getByText(bookingCode)).toBeVisible({ timeout: 20_000 })
    })

    // Prove the booking really attached to the operator-authored car, not a seed car.
    await test.step('7. the booking is tied to the UI-created vehicle at the UI-created location', async () => {
      const row = await lookupBookingLink()
      expect(row).toMatchObject({
        status: 'CONFIRMED',
        vehicleName: VEHICLE_NAME,
        locationName: LOCATION_NAME,
        renterEmail: 'sarah@example.test',
      })
    })
  })
})

/** The region slug assigned to the freshly-created location (drives the region search). */
async function lookupRegionSlug(): Promise<string | undefined> {
  const sql = testSql()
  try {
    const rows = await sql<{ slug: string }[]>`
      SELECT r.slug FROM regions r
      JOIN locations l ON l."regionId" = r.id
      WHERE l.name = ${LOCATION_NAME}
      LIMIT 1`
    return rows[0]?.slug
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** The booking's status + the names of the vehicle/location/renter it points at. */
async function lookupBookingLink(): Promise<{
  status: string
  vehicleName: string | null
  locationName: string | null
  renterEmail: string
} | null> {
  const sql = testSql()
  try {
    const rows = await sql<
      {
        status: string
        vehicleName: string | null
        locationName: string | null
        renterEmail: string
      }[]
    >`
      SELECT b.status,
             v.name  AS "vehicleName",
             l.name  AS "locationName",
             u.email AS "renterEmail"
      FROM bookings b
      JOIN vehicles v ON v.id = b."assignedVehicleId"
      JOIN users u ON u.id = b."renterId"
      LEFT JOIN locations l ON l.id = b."pickupLocationId"
      WHERE v.name = ${VEHICLE_NAME}
      LIMIT 1`
    return rows[0] ?? null
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/**
 * Remove every row this spec creates, in FK order, keyed on the stable marker so a
 * crashed run leaves nothing behind. bookings' RESTRICT children go first, then the
 * bookings, then the vehicle (RESTRICT-referenced by bookings), then the location
 * (RESTRICT-referenced by both).
 */
async function cleanupInventory(): Promise<void> {
  const sql = testSql()
  try {
    const like = `${MARKER}%`
    const vids = (await sql<{ id: string }[]>`SELECT id FROM vehicles WHERE name LIKE ${like}`).map(
      (r) => r.id,
    )
    if (vids.length > 0) {
      const bids = (
        await sql<{ id: string }[]>`
          SELECT id FROM bookings
          WHERE "assignedVehicleId" IN ${sql(vids)} OR "requestedVehicleId" IN ${sql(vids)}`
      ).map((r) => r.id)
      if (bids.length > 0) {
        await sql`DELETE FROM notification_log WHERE "bookingId" IN ${sql(bids)}`
        await sql`DELETE FROM booking_events WHERE "bookingId" IN ${sql(bids)}`
        await sql`DELETE FROM payment_events WHERE "bookingId" IN ${sql(bids)}`
        await sql`DELETE FROM threads WHERE "bookingId" IN ${sql(bids)}`
        await sql`DELETE FROM bookings WHERE id IN ${sql(bids)}`
      }
      await sql`DELETE FROM vehicles WHERE id IN ${sql(vids)}`
    }
    await sql`DELETE FROM locations WHERE name LIKE ${like}`
  } finally {
    await sql.end({ timeout: 5 })
  }
}
