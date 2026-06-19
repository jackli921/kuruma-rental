import { expect, test } from '@playwright/test'
import { testSql } from './pg'

// #655 (S3 of #652): thin UI-wiring journeys for the operator booking lifecycle on
// the real Vite UI -> Hono API -> seeded Postgres stack. The project-default `page`
// is the OPERATOR_OWNER session (playwright.real-db.config.ts storageState), so every
// journey here drives the operator portal trip-detail Actions panel (#610/#616/#642).
//
// What these prove (and ONLY this — transition rules + fee math are unit-covered):
//   1. lifecycle  — CONFIRMED -> ACTIVE -> COMPLETED via the Actions panel; each
//      STATUS_CHANGED lands as a booking_events row and renders on the timeline.
//   2. substitute — swap in a same-ACRISS candidate; assignedVehicleId moves,
//      requestedVehicleId is preserved, a VEHICLE_SUBSTITUTED event renders.
//   3. cancel     — operator cancels a CONFIRMED booking; status -> CANCELLED, the
//      tiered fee is stored + shown, a BOOKING_CANCELLED event renders.
//
// #655 originally specced journey 3 as a RENTER self-cancel from /bookings, but that
// UI is deferred post-MVP (renter is told to contact the operator). The cancel UI that
// ships today is the operator portal's Cancel button, so journey 3 drives that — same
// CANCELLED + tiered-fee + timeline assertions. Renter self-cancel UI is follow-up.
//
// Bookings are seeded directly over pg (testSql) rather than driven through the renter
// wizard: that keeps each journey independent, lets journey 3 pin startAt to a real fee
// tier (~36h out = MEDIUM 70%), and avoids the cookie-CSRF dance an API seed needs. Every
// seeded row is tagged notes=MARKER so afterAll can sweep it (+ FK children) clean.

const OPERATOR_NAME = 'Best Car Rental'
// Deliberately NOT Sarah: marketplace-happy-path.auth.spec.ts sweeps every Sarah
// booking with startAt >= 2026-07-01 in its afterAll, which would match this spec's
// far-future seeds on the shared serial lane. Hiroshi keeps the two specs decoupled;
// cleanup here is marker-scoped regardless.
const RENTER_EMAIL = 'hiroshi@example.test'
const MARKER = 'e2e-655-lifecycle'

// Far-future window for the lifecycle (advance/cancel) journey — clear of the seeded
// demo bookings (~ now +/- 7d), so the seeded vehicle is free and no exclusion clash.
// Advancing status never consults the road-legal gate, so a far-future date is safe here.
const LIFECYCLE_FROM = new Date('2027-08-01T09:00:00Z')
const LIFECYCLE_TO = new Date('2027-08-03T09:00:00Z')
// The substitute journey must use a NEAR-future window: #916 §5.3b only offers a
// replacement whose shaken + insurance stay valid THROUGH the booking end, and the seed
// stamps docs ~now + 365/400d. A far-future (2027) booking would outlive the seeded docs
// → zero road-legal candidates → an empty picker. now + ~60d is well inside the doc
// horizon yet still clear of the ~now +/- 7d demo bookings (no exclusion clash).
const SUBSTITUTE_FROM = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
const SUBSTITUTE_TO = new Date(SUBSTITUTE_FROM.getTime() + 2 * 24 * 60 * 60 * 1000)

// Journey 3 must land in a NON-free cancellation tier to prove a real fee. The schedule
// is 72h free / 48h 30% / 24h 70% / same-day 100% (cancellation-policy.ts). ~36h out is
// comfortably mid-MEDIUM (70%), away from the 24h/48h edges a multi-minute run could drift
// across. fee = round(totalPrice * 0.7).
const CANCEL_TOTAL_PRICE = 20_000
const CANCEL_EXPECTED_FEE = 14_000 // 20000 * 0.70 (MEDIUM)

interface SeededBooking {
  bookingId: string
  assignedVehicleId: string
  requestedVehicleId: string
  substituteVehicleId?: string
}

test.describe('operator booking lifecycle — advance, substitute, cancel (real DB)', () => {
  test.afterAll(cleanupSeededBookings)

  test('lifecycle: CONFIRMED -> ACTIVE -> COMPLETED renders each timeline event', async ({
    page,
  }) => {
    test.setTimeout(120_000) // Vite builds the detail route on first hit

    const { bookingId } = await seedFreeVehicleBooking(LIFECYCLE_FROM, LIFECYCLE_TO)

    await page.goto(`/en/manage/bookings/${bookingId}`)
    // CONFIRMED booking: the one-click advance offers "Mark as picked up".
    const markPickedUp = page.getByRole('button', { name: 'Mark as picked up' })
    await expect(markPickedUp).toBeVisible({ timeout: 20_000 })

    await test.step('advance to ACTIVE (picked up)', async () => {
      await markPickedUp.click()
      // Timeline appends the transition; status enum is i18n'd (Confirmed/Active).
      await expect(page.getByText('Status changed from Confirmed to Active')).toBeVisible({
        timeout: 20_000,
      })
      // The advance button now targets the next hop — proves status really moved.
      await expect(page.getByRole('button', { name: 'Mark as returned' })).toBeVisible()
      expect(await readBookingStatus(bookingId)).toBe('ACTIVE')
    })

    await test.step('advance to COMPLETED (returned)', async () => {
      await page.getByRole('button', { name: 'Mark as returned' }).click()
      await expect(page.getByText('Status changed from Active to Completed')).toBeVisible({
        timeout: 20_000,
      })
      // A settled booking has no further actions.
      await expect(page.getByText('This booking is settled — no actions available.')).toBeVisible()
      expect(await readBookingStatus(bookingId)).toBe('COMPLETED')
    })

    // Two STATUS_CHANGED events persisted, in order.
    const events = await readEventTypes(bookingId)
    expect(events.filter((e) => e === 'STATUS_CHANGED')).toHaveLength(2)
  })

  test('substitute: swaps the assigned vehicle and records the event', async ({ page }) => {
    test.setTimeout(120_000)

    const seeded = await seedSubstitutableBooking(SUBSTITUTE_FROM, SUBSTITUTE_TO)
    const substituteId = seeded.substituteVehicleId
    expect(substituteId).toBeDefined()
    if (!substituteId) throw new Error('seed did not provide a substitute candidate')

    await page.goto(`/en/manage/bookings/${seeded.bookingId}`)

    await page.getByRole('button', { name: 'Substitute vehicle' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Substitute vehicle')).toBeVisible()

    // Pick the seeded same-class candidate by its id, and record a reason so the
    // VEHICLE_SUBSTITUTED detail line also renders.
    await dialog.getByLabel('Replacement vehicle').selectOption(substituteId)
    await dialog.getByLabel('Reason (optional)').fill('original car in for repair')
    await dialog.getByRole('button', { name: 'Confirm substitution' }).click()

    await expect(page.getByText('Vehicle substituted')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText('Reason: original car in for repair')).toBeVisible()

    // The assignment moved to the substitute; the renter's original request is immutable.
    const row = await readBookingVehicles(seeded.bookingId)
    expect(row.assignedVehicleId).toBe(substituteId)
    expect(row.requestedVehicleId).toBe(seeded.requestedVehicleId)
    expect(await readEventTypes(seeded.bookingId)).toContain('VEHICLE_SUBSTITUTED')
  })

  test('cancel: operator cancels a CONFIRMED booking with a tiered fee', async ({ page }) => {
    test.setTimeout(120_000)

    const startAt = new Date(Date.now() + 36 * 60 * 60 * 1000)
    const endAt = new Date(startAt.getTime() + 2 * 60 * 60 * 1000)
    const { bookingId } = await seedFreeVehicleBooking(startAt, endAt, CANCEL_TOTAL_PRICE)

    await page.goto(`/en/manage/bookings/${bookingId}`)

    await page.getByRole('button', { name: 'Cancel booking' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText('Cancel this booking?')).toBeVisible()
    await dialog.getByRole('button', { name: 'Confirm cancellation' }).click()

    // Timeline shows the cancellation AND the tiered fee that was charged.
    await expect(page.getByText('Booking cancelled')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByText(/Cancellation fee/)).toBeVisible()
    await expect(page.getByText('This booking is settled — no actions available.')).toBeVisible()

    // The MEDIUM tier (70%) was applied to the stored fee, not a free/full default.
    const row = await readCancellation(bookingId)
    expect(row.status).toBe('CANCELLED')
    expect(row.cancellationFee).toBe(CANCEL_EXPECTED_FEE)
    expect(await readEventTypes(bookingId)).toContain('BOOKING_CANCELLED')
  })
})

// --- seeding + assertion helpers (raw pg over testSql) -----------------------

/** Best Car Rental's operator id + Sarah's renter id, resolved by stable attrs
 *  (the seed mints UUID ids, so never hardcode them). */
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
  return `E655${Math.random().toString(36).slice(2, 8).toUpperCase()}`
}

async function insertBooking(
  sql: ReturnType<typeof testSql>,
  row: {
    operatorId: string
    renterId: string
    classId: string
    locationId: string
    assignedVehicleId: string
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
    requestedVehicleId: row.assignedVehicleId,
    assignedVehicleId: row.assignedVehicleId,
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

/** A CONFIRMED booking on any operator vehicle free over [startAt, endAt). */
async function seedFreeVehicleBooking(
  startAt: Date,
  endAt: Date,
  totalPrice = 18_000,
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
            -- Probe the FULL effective range, not just [startAt, endAt): the booking we
            -- insert gets effectiveEndAt = endAt + turnaround (trigger; default 48h, the
            -- max), and the bookings_no_overlap exclusion keys on that. Widening the probe
            -- by 48h keeps the picked vehicle clear of that tail so the INSERT can't 23P01.
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
      assignedVehicleId: v.id,
      startAt,
      endAt,
      totalPrice,
    })
    return { bookingId, assignedVehicleId: v.id, requestedVehicleId: v.id }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

/** A CONFIRMED booking whose class has a 2nd AVAILABLE, same-location, non-null-ACRISS
 *  vehicle — the exact shape findSubstitutionCandidates needs to offer a candidate. */
async function seedSubstitutableBooking(startAt: Date, endAt: Date): Promise<SeededBooking> {
  const sql = testSql()
  try {
    const { operatorId, renterId } = await resolveActors(sql)
    const [pair] = await sql<
      { classId: string; locationId: string; assigned: string; substitute: string }[]
    >`
      SELECT v."classId",
             v."pickupLocationId" AS "locationId",
             (array_agg(v.id ORDER BY v.id))[1] AS assigned,
             (array_agg(v.id ORDER BY v.id))[2] AS substitute
      FROM vehicles v
      JOIN vehicle_classes c ON c.id = v."classId"
      WHERE v."operatorId" = ${operatorId}
        AND v.status = 'AVAILABLE'
        AND v."pickupLocationId" IS NOT NULL
        AND c."acrissCode" IS NOT NULL
      GROUP BY v."classId", v."pickupLocationId"
      HAVING count(*) >= 2
      LIMIT 1`
    if (!pair) throw new Error('seed has no 2 same-class same-location AVAILABLE vehicles')
    const bookingId = await insertBooking(sql, {
      operatorId,
      renterId,
      classId: pair.classId,
      locationId: pair.locationId,
      assignedVehicleId: pair.assigned,
      startAt,
      endAt,
      totalPrice: 18_000,
    })
    return {
      bookingId,
      assignedVehicleId: pair.assigned,
      requestedVehicleId: pair.assigned,
      substituteVehicleId: pair.substitute,
    }
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function readBookingStatus(bookingId: string): Promise<string | undefined> {
  const sql = testSql()
  try {
    const [row] = await sql<{ status: string }[]>`
      SELECT status FROM bookings WHERE id = ${bookingId}`
    return row?.status
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function readBookingVehicles(
  bookingId: string,
): Promise<{ assignedVehicleId: string; requestedVehicleId: string }> {
  const sql = testSql()
  try {
    const [row] = await sql<{ assignedVehicleId: string; requestedVehicleId: string }[]>`
      SELECT "assignedVehicleId", "requestedVehicleId" FROM bookings WHERE id = ${bookingId}`
    if (!row) throw new Error(`booking ${bookingId} not found`)
    return row
  } finally {
    await sql.end({ timeout: 5 })
  }
}

async function readCancellation(
  bookingId: string,
): Promise<{ status: string; cancellationFee: number | null }> {
  const sql = testSql()
  try {
    const [row] = await sql<{ status: string; cancellationFee: number | null }[]>`
      SELECT status, "cancellationFee" FROM bookings WHERE id = ${bookingId}`
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
