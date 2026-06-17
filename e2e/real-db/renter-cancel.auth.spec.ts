import { expect, test } from '@playwright/test'
import { RENTER_STORAGE_STATE } from './constants'
import { testSql } from './pg'

// #910 (Slice 2 of #868): the real-DB coverage for renter self-cancel that the epic
// flags as its last gap. Slice 1 (#856) shipped the renter CancelBookingDialog; Slice
// 3a (#899) added cancellationFeeSettlement. This drives the SHIPPED Vite confirmation
// route -> Hono API -> seeded Postgres as the RENTER (not the project-default operator).
//
// What it proves (transition rules + fee math are unit-covered; this is wiring + persistence):
//   - MEDIUM tier — a CONFIRMED booking ~36h out cancels to CANCELLED with the tiered
//     70% fee STORED and the settlement recorded ADVISORY (nothing charged online,
//     #868 M5); a BOOKING_CANCELLED event + a RENTER_CANCELLATION notification land;
//     and the slot frees so the vehicle is bookable again.
//   - FREE tier — a >72h cancel still records an ADVISORY settlement, just with a zero
//     fee, so the breakdown is always present, never null (epic review M6).
//
// Surface: the cancel control renders ONLY on the confirmation route's
// BookingConfirmationView (MyBookingsView has none), gated on `status === 'CONFIRMED'
// && csrfToken`. The route's loader fetches the booking via GET /bookings/:id (IDOR-
// sealed, #396), so a raw-SQL seed owned by the session renter is directly reachable at
// /en/bookings/confirmation?bookingId=<id> — no wizard run, no query-cache priming.
//
// Bookings are seeded directly over pg (testSql), like booking-lifecycle.auth.spec.ts:
// it pins startAt to a real fee tier and keeps each case independent. The renter is
// Sarah (RENTER_STORAGE_STATE); both windows sit before the marketplace spec's
// Sarah->=2026-07-01 afterAll sweep, and every row is tagged notes=MARKER so this
// spec's afterAll sweeps it (+ FK children) regardless.

const OPERATOR_NAME = 'Best Car Rental'
const RENTER_EMAIL = 'sarah@example.test'
const MARKER = 'e2e-868-renter-cancel'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// Schedule: 72h free / 48h 30% / 24h 70% / same-day 100% (cancellation-policy.ts).
// ~36h out is comfortably mid-MEDIUM (70%), away from the 24h/48h edges a multi-minute
// run could drift across. fee = round(totalPrice * 0.70).
const MEDIUM_TOTAL_PRICE = 20_000
const MEDIUM_EXPECTED_FEE = 14_000
// >=72h out is FREE (0%). 10 days also clears the demo seed's ~now +/- 7d windows, so a
// free Best Car Rental vehicle is guaranteed for the seed probe.
const FREE_TOTAL_PRICE = 20_000
const FREE_EXPECTED_FEE = 0

interface SeededBooking {
  bookingId: string
  operatorId: string
  renterId: string
  classId: string
  locationId: string
  vehicleId: string
}

test.describe('renter self-cancel — confirmation route (real DB)', () => {
  test.afterAll(cleanupSeededBookings)

  test('MEDIUM tier: ~36h out cancels to CANCELLED with a 70% advisory fee and frees the slot', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000) // Vite builds the confirmation route on first hit

    const startAt = new Date(Date.now() + 36 * HOUR_MS)
    const endAt = new Date(startAt.getTime() + 2 * HOUR_MS)
    const seeded = await seedConfirmedBooking(startAt, endAt, MEDIUM_TOTAL_PRICE)

    const renterContext = await browser.newContext({ storageState: RENTER_STORAGE_STATE, baseURL })
    const renter = await renterContext.newPage()
    try {
      await renter.goto(`/en/bookings/confirmation?bookingId=${seeded.bookingId}`)

      const cancelControl = renter.getByRole('button', { name: 'Cancel booking' })
      await expect(cancelControl).toBeVisible({ timeout: 20_000 })
      await cancelControl.click()

      const dialog = renter.getByRole('dialog')
      await expect(dialog.getByText('Cancel this booking?')).toBeVisible()
      // The tiered branch rendered (not the free or no-show framing): the MEDIUM 70%
      // preview the renter must see BEFORE committing.
      await expect(dialog.getByText(/70%/)).toBeVisible()
      await dialog.getByRole('button', { name: 'Yes, cancel' }).click()

      // The cancel invalidates the bookings query; the page re-reads the now-CANCELLED
      // booking and the whole cancel section unmounts. The control vanishing is the UI
      // proof the cancel took (mirrors the operator trip-detail page, #616).
      await expect(cancelControl).toHaveCount(0, { timeout: 20_000 })
    } finally {
      await renterContext.close()
    }

    // The cancel path is proven by the two columns it WRITES: status flips to CANCELLED
    // and cancellationFee goes from NULL (seed) to the tiered amount — a broken cancel
    // leaves both unchanged. cancellationFeeSettlement stays ADVISORY because cancel()
    // deliberately moves no money and never touches this column (it reads the NOT NULL
    // 'ADVISORY' default; the ADVISORY -> CAPTURED|REFUNDED state machine is #851). So
    // this last assertion pins the advisory-only contract (epic M6), NOT the write path.
    const row = await readCancellation(seeded.bookingId)
    expect(row.status).toBe('CANCELLED')
    expect(row.cancellationFee).toBe(MEDIUM_EXPECTED_FEE)
    expect(row.cancellationFeeSettlement).toBe('ADVISORY')

    expect(await readEventTypes(seeded.bookingId)).toContain('BOOKING_CANCELLED')

    // The RENTER_CANCELLATION email row lands post-commit (fire-and-forget dispatch),
    // so poll for it rather than reading once.
    await expect
      .poll(() => readNotificationKinds(seeded.bookingId), {
        timeout: 20_000,
        intervals: [500, 1000, 2000],
        message: 'expected a RENTER_CANCELLATION notification_log row',
      })
      .toContain('RENTER_CANCELLATION')

    // Slot freed: the bookings_no_overlap exclusion only blocks CONFIRMED/ACTIVE, so an
    // overlapping CONFIRMED insert on the same vehicle + window now succeeds. Had the
    // cancel NOT freed the slot, this would raise 23P01 and fail the test.
    const overlappingId = await reinsertOverlapping(seeded, startAt, endAt)
    expect(overlappingId).toBeTruthy()
  })

  test('FREE tier: >72h out cancels to CANCELLED with a zero advisory fee (breakdown always present)', async ({
    browser,
    baseURL,
  }) => {
    test.setTimeout(120_000)

    const startAt = new Date(Date.now() + 10 * DAY_MS)
    const endAt = new Date(startAt.getTime() + 2 * HOUR_MS)
    const seeded = await seedConfirmedBooking(startAt, endAt, FREE_TOTAL_PRICE)

    const renterContext = await browser.newContext({ storageState: RENTER_STORAGE_STATE, baseURL })
    const renter = await renterContext.newPage()
    try {
      await renter.goto(`/en/bookings/confirmation?bookingId=${seeded.bookingId}`)

      const cancelControl = renter.getByRole('button', { name: 'Cancel booking' })
      await expect(cancelControl).toBeVisible({ timeout: 20_000 })
      await cancelControl.click()

      const dialog = renter.getByRole('dialog')
      await expect(dialog.getByText('Cancel this booking?')).toBeVisible()
      await dialog.getByRole('button', { name: 'Yes, cancel' }).click()

      await expect(cancelControl).toHaveCount(0, { timeout: 20_000 })
    } finally {
      await renterContext.close()
    }

    // A free cancellation still WRITES the fee (NULL seed -> 0) and flips status, so both
    // assertions fail on a broken cancel. Settlement stays ADVISORY (the column default
    // cancel() leaves until #851), pinning that even a zero-fee cancel surfaces a present,
    // advisory settlement — never null (epic review M6) — not the cancel write path.
    const row = await readCancellation(seeded.bookingId)
    expect(row.status).toBe('CANCELLED')
    expect(row.cancellationFee).toBe(FREE_EXPECTED_FEE)
    expect(row.cancellationFeeSettlement).toBe('ADVISORY')
    expect(await readEventTypes(seeded.bookingId)).toContain('BOOKING_CANCELLED')
  })
})

// --- seeding + assertion helpers (raw pg over testSql) -----------------------

/** Best Car Rental's operator id + Sarah's renter id, by stable attrs (seed mints UUIDs). */
async function resolveActors(
  sql: ReturnType<typeof testSql>,
): Promise<{ operatorId: string; renterId: string }> {
  const [op] = await sql<{ id: string }[]>`SELECT id FROM operators WHERE name = ${OPERATOR_NAME}`
  const [renter] = await sql<{ id: string }[]>`SELECT id FROM users WHERE email = ${RENTER_EMAIL}`
  if (!op || !renter)
    throw new Error(`seed missing operator ${OPERATOR_NAME} or renter ${RENTER_EMAIL}`)
  return { operatorId: op.id, renterId: renter.id }
}

function newBookingCode(): string {
  // Unique, no format CHECK in the DB (bookingCode is just NOT NULL + UNIQUE).
  return `E868${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

async function insertBooking(
  sql: ReturnType<typeof testSql>,
  row: {
    operatorId: string
    renterId: string
    classId: string
    locationId: string
    vehicleId: string
    startAt: Date
    endAt: Date
    totalPrice: number
  },
): Promise<string> {
  const id = crypto.randomUUID()
  await sql`INSERT INTO bookings ${sql({
    id,
    operatorId: row.operatorId,
    renterId: row.renterId,
    classId: row.classId,
    requestedVehicleId: row.vehicleId,
    assignedVehicleId: row.vehicleId,
    pickupLocationId: row.locationId,
    dropoffLocationId: row.locationId,
    startAt: row.startAt,
    endAt: row.endAt,
    effectiveEndAt: row.endAt, // placeholder only — a BEFORE trigger overwrites with endAt + turnaround
    status: 'CONFIRMED',
    bookingCode: newBookingCode(),
    totalPrice: row.totalPrice,
    notes: MARKER,
  })}`
  return id
}

/** A CONFIRMED booking owned by Sarah on any Best Car Rental vehicle free over [startAt, endAt). */
async function seedConfirmedBooking(
  startAt: Date,
  endAt: Date,
  totalPrice: number,
): Promise<SeededBooking> {
  const sql = testSql()
  try {
    const { operatorId, renterId } = await resolveActors(sql)
    const [v] = await sql<{ id: string; classId: string; locationId: string }[]>`
      SELECT v.id, v."classId", v."pickupLocationId" AS "locationId"
      FROM vehicles v
      WHERE v."operatorId" = ${operatorId}
        AND v.status = 'AVAILABLE'
        AND v."classId" IS NOT NULL
        AND v."pickupLocationId" IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM bookings b
          WHERE b."assignedVehicleId" = v.id
            AND b.status IN ('CONFIRMED', 'ACTIVE')
            -- Probe the FULL effective range: the booking we insert gets effectiveEndAt =
            -- endAt + turnaround (trigger; default 48h, the max), and bookings_no_overlap
            -- keys on that. Widening the probe by 48h keeps the picked vehicle clear of
            -- that tail so the INSERT can't 23P01.
            AND tstzrange(b."startAt", b."effectiveEndAt")
                && tstzrange(${startAt}, ${endAt}::timestamptz + interval '48 hours')
        )
      LIMIT 1`
    if (!v) throw new Error('no free Best Car Rental vehicle for the window')
    const bookingId = await insertBooking(sql, {
      operatorId,
      renterId,
      classId: v.classId,
      locationId: v.locationId,
      vehicleId: v.id,
      startAt,
      endAt,
      totalPrice,
    })
    return {
      bookingId,
      operatorId,
      renterId,
      classId: v.classId,
      locationId: v.locationId,
      vehicleId: v.id,
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** Insert a 2nd CONFIRMED booking overlapping the seeded one's vehicle + window. Resolves
 *  only if the slot is free (the original is CANCELLED); raises 23P01 otherwise. */
async function reinsertOverlapping(
  seeded: SeededBooking,
  startAt: Date,
  endAt: Date,
): Promise<string> {
  const sql = testSql()
  try {
    return await insertBooking(sql, {
      operatorId: seeded.operatorId,
      renterId: seeded.renterId,
      classId: seeded.classId,
      locationId: seeded.locationId,
      vehicleId: seeded.vehicleId,
      startAt,
      endAt,
      totalPrice: MEDIUM_TOTAL_PRICE,
    })
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function readCancellation(bookingId: string): Promise<{
  status: string
  cancellationFee: number | null
  cancellationFeeSettlement: string
}> {
  const sql = testSql()
  try {
    const [row] = await sql<
      { status: string; cancellationFee: number | null; cancellationFeeSettlement: string }[]
    >`
      SELECT status, "cancellationFee", "cancellationFeeSettlement"
      FROM bookings WHERE id = ${bookingId}`
    if (!row) throw new Error(`booking ${bookingId} not found`)
    return row
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function readEventTypes(bookingId: string): Promise<string[]> {
  const sql = testSql()
  try {
    const rows = await sql<{ type: string }[]>`
      SELECT type FROM booking_events WHERE "bookingId" = ${bookingId} ORDER BY "createdAt", id`
    return rows.map((r) => r.type)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function readNotificationKinds(bookingId: string): Promise<string[]> {
  const sql = testSql()
  try {
    const rows = await sql<{ kind: string }[]>`
      SELECT kind FROM notification_log WHERE "bookingId" = ${bookingId}`
    return rows.map((r) => r.kind)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** Drop every booking this spec seeded (tagged by notes), children first (FK order). */
async function cleanupSeededBookings(): Promise<void> {
  const sql = testSql()
  try {
    const ids = await sql<{ id: string }[]>`SELECT id FROM bookings WHERE notes = ${MARKER}`
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
