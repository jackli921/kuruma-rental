import { BEST_CAR_RENTAL_OPERATOR_ID, SECOND_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { users } from '@kuruma/shared/db/schema'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { pgErrorCode } from '../../src/pg-errors'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleLocationRepository,
  DrizzleVehicleClassRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import type { Vehicle } from '../../src/stores'
import { authHeaders, setupAuthEnv } from '../helpers/auth'
import { bookingInput } from '../helpers/booking'
import {
  DEFAULT_DAILY_RATE_JPY,
  cleanupBookings,
  cleanupLocations,
  cleanupUsers,
  cleanupVehicleClasses,
  cleanupVehicles,
  db,
  seedLocation,
  seedVehicleClass,
} from './setup'

const bookingRepo = new DrizzleBookingRepository(db)
const vehicleRepo = new DrizzleVehicleRepository(db)

// Slice 6 (#392): effectiveEndAt is DB-trigger-derived = endAt + the pickup
// location's defaultTurnaroundMinutes (migration 0036). The value passed to the
// insert is overwritten by the trigger. We seed the location with an EXPLICIT,
// non-default turnaround so the expected effective end is computable here — and
// crucially NOT 60min: the legacy vehicle.bufferMinutes (60) is gone, so a
// 60-min result would be a regression (proposal §9 item 20).
const TURNAROUND_MINUTES = 120
const effectiveEnd = (endAt: Date): Date => new Date(endAt.getTime() + TURNAROUND_MINUTES * 60_000)

// --- Test data ---

let testUser: { id: string; email: string }
let testVehicle: Vehicle
let testClassId: string
let testLocationId: string
const createdBookingIds: string[] = []
const createdVehicleIds: string[] = []
const createdClassIds: string[] = []
const createdLocationIds: string[] = []

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `test-${Date.now()}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
    .returning()
  testUser = user

  const klass = await seedVehicleClass('booking')
  testClassId = klass.id
  createdClassIds.push(klass.id)

  // bookings carry NOT NULL pickup/dropoff location FKs sealed to the operator.
  const location = await seedLocation('booking', TURNAROUND_MINUTES)
  testLocationId = location.id
  createdLocationIds.push(location.id)

  testVehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId: testClassId,
    name: 'Booking Test Car',
    description: null,
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
    shakenExpiryDate: '2099-06-15',
    insuranceExpiryDate: '2099-01-01',
  })
  createdVehicleIds.push(testVehicle.id)
})

// Marketplace-shape booking seeded directly through the repo. The helper supplies
// a unique bookingCode per call (so overlapping-range creates trip the exclusion
// constraint 23P01, not the bookingCode unique 23505) plus null snapshot defaults.
// effectiveEndAt is intentionally NOT set here — the DB trigger derives it.
function seedBooking(overrides: Parameters<typeof bookingInput>[0] = {}) {
  return bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      renterId: testUser.id,
      classId: testClassId,
      requestedVehicleId: testVehicle.id,
      assignedVehicleId: testVehicle.id,
      pickupLocationId: testLocationId,
      dropoffLocationId: testLocationId,
      ...overrides,
    }),
  )
}

afterEach(async () => {
  await cleanupBookings(createdBookingIds)
  createdBookingIds.length = 0
})

afterAll(async () => {
  await cleanupVehicles(createdVehicleIds)
  await cleanupUsers([testUser.id])
  await cleanupVehicleClasses(createdClassIds)
  await cleanupLocations(createdLocationIds)
})

describe('DrizzleBookingRepository', () => {
  it('create inserts and returns a booking with correct fields', async () => {
    const endAt = new Date('2026-07-01T14:00:00Z')
    const booking = await seedBooking({
      startAt: new Date('2026-07-01T10:00:00Z'),
      endAt,
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: 'Test booking',
    })
    createdBookingIds.push(booking.id)

    expect(booking.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(booking.operatorId).toBe(BEST_CAR_RENTAL_OPERATOR_ID)
    expect(booking.renterId).toBe(testUser.id)
    expect(booking.classId).toBe(testClassId)
    expect(booking.requestedVehicleId).toBe(testVehicle.id)
    expect(booking.assignedVehicleId).toBe(testVehicle.id)
    expect(booking.pickupLocationId).toBe(testLocationId)
    expect(booking.dropoffLocationId).toBe(testLocationId)
    expect(booking.bookingCode).toMatch(/^[0-9A-Z]+$/) // NOT NULL UNIQUE code persisted
    expect(booking.startAt).toEqual(new Date('2026-07-01T10:00:00Z'))
    expect(booking.endAt).toEqual(endAt)
    // Trigger-derived: endAt + the location's 120-min turnaround (NOT 60).
    expect(booking.effectiveEndAt).toEqual(effectiveEnd(endAt))
    expect(booking.status).toBe('CONFIRMED')
    expect(booking.source).toBe('DIRECT')
    expect(booking.externalId).toBeNull()
    expect(booking.notes).toBe('Test booking')
    expect(booking.feeSnapshot).toEqual([])
    expect(booking.createdAt).toBeInstanceOf(Date)
    expect(booking.updatedAt).toBeInstanceOf(Date)
  })

  it('effectiveEndAt follows the DROPOFF location turnaround on a one-way booking (#1023)', async () => {
    // One-way A->B: the car is returned and cleaned at B, so its next-bookable
    // window must be B's turnaround, not the pickup's (§6 / F1). B's 180min is
    // distinct from A's 120 and the 2880 fallback, so a wrong-location or
    // fallback result is unambiguous.
    const DROPOFF_TURNAROUND_MINUTES = 180
    const dropoff = await seedLocation('booking-dropoff', DROPOFF_TURNAROUND_MINUTES)
    createdLocationIds.push(dropoff.id)

    const endAt = new Date('2026-10-01T14:00:00Z')
    const booking = await seedBooking({
      startAt: new Date('2026-10-01T10:00:00Z'),
      endAt,
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
      dropoffLocationId: dropoff.id,
    })
    createdBookingIds.push(booking.id)

    expect(booking.pickupLocationId).toBe(testLocationId) // A, turnaround 120
    expect(booking.dropoffLocationId).toBe(dropoff.id) // B, turnaround 180
    expect(booking.effectiveEndAt).toEqual(
      new Date(endAt.getTime() + DROPOFF_TURNAROUND_MINUTES * 60_000),
    )
  })

  it('findById retrieves a created booking', async () => {
    const endAt = new Date('2026-08-01T12:00:00Z')
    const created = await seedBooking({
      startAt: new Date('2026-08-01T09:00:00Z'),
      endAt,
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(created.id)

    const found = await bookingRepo.findById(SYSTEM_CONTEXT, created.id)

    expect(found).toBeDefined()
    expect(found!.id).toBe(created.id)
    expect(found!.renterId).toBe(testUser.id)
    expect(found!.assignedVehicleId).toBe(testVehicle.id)
    expect(found!.startAt).toEqual(new Date('2026-08-01T09:00:00Z'))
    expect(found!.endAt).toEqual(endAt)
    expect(found!.effectiveEndAt).toEqual(effectiveEnd(endAt))
    expect(found!.status).toBe('CONFIRMED')
    expect(found!.source).toBe('DIRECT')
    expect(found!.externalId).toBeNull()
    expect(found!.notes).toBeNull()
  })

  it('findById returns undefined for non-existent id', async () => {
    const found = await bookingRepo.findById(SYSTEM_CONTEXT, 'non-existent-id')
    expect(found).toBeUndefined()
  })

  it('findAll returns bookings and filters by status', async () => {
    const confirmed = await seedBooking({
      startAt: new Date('2026-09-01T10:00:00Z'),
      endAt: new Date('2026-09-01T14:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(confirmed.id)

    const cancelled = await seedBooking({
      startAt: new Date('2026-10-01T10:00:00Z'),
      endAt: new Date('2026-10-01T14:00:00Z'),
      status: 'CANCELLED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(cancelled.id)

    const all = await bookingRepo.findAll(SYSTEM_CONTEXT)
    const allIds = all.map((b) => b.id)
    expect(allIds).toContain(confirmed.id)
    expect(allIds).toContain(cancelled.id)

    const filtered = await bookingRepo.findAll(SYSTEM_CONTEXT, { status: 'CONFIRMED' })
    const filteredIds = filtered.map((b) => b.id)
    expect(filteredIds).toContain(confirmed.id)
    expect(filteredIds).not.toContain(cancelled.id)
  })

  it('findAll filters by vehicleId (the assigned vehicle)', async () => {
    const otherVehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      classId: testClassId,
      name: 'Other Car',
      description: null,
      seats: 4,
      transmission: 'MANUAL',
      fuelType: null,
      licensePlate: null,
      status: 'AVAILABLE',
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      shakenExpiryDate: '2099-06-15',
      insuranceExpiryDate: '2099-01-01',
    })
    createdVehicleIds.push(otherVehicle.id)

    const bookingA = await seedBooking({
      startAt: new Date('2026-11-01T10:00:00Z'),
      endAt: new Date('2026-11-01T14:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(bookingA.id)

    const bookingB = await seedBooking({
      requestedVehicleId: otherVehicle.id,
      assignedVehicleId: otherVehicle.id,
      startAt: new Date('2026-11-01T10:00:00Z'),
      endAt: new Date('2026-11-01T14:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(bookingB.id)

    const filtered = await bookingRepo.findAll(SYSTEM_CONTEXT, { vehicleId: testVehicle.id })
    const filteredIds = filtered.map((b) => b.id)
    expect(filteredIds).toContain(bookingA.id)
    expect(filteredIds).not.toContain(bookingB.id)
  })

  it('updateStatus transitions CONFIRMED to ACTIVE', async () => {
    const created = await seedBooking({
      startAt: new Date('2026-12-01T10:00:00Z'),
      endAt: new Date('2026-12-01T14:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(created.id)

    const updated = await bookingRepo.updateStatus(SYSTEM_CONTEXT, created.id, {
      from: 'CONFIRMED',
      to: 'ACTIVE',
    })

    expect(updated).toBeDefined()
    expect(updated!.id).toBe(created.id)
    expect(updated!.status).toBe('ACTIVE')
    expect(updated!.renterId).toBe(testUser.id)
    expect(updated!.assignedVehicleId).toBe(testVehicle.id)
    expect(updated!.startAt).toEqual(new Date('2026-12-01T10:00:00Z'))

    // Verify persisted in DB
    const fromDb = await bookingRepo.findById(SYSTEM_CONTEXT, created.id)
    expect(fromDb!.status).toBe('ACTIVE')
  })

  it('create persists totalPrice through Drizzle insert (issue #89)', async () => {
    const booking = await seedBooking({
      startAt: new Date('2026-07-15T10:00:00Z'),
      endAt: new Date('2026-07-15T14:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
      totalPrice: 15000,
      cancellationFee: null,
      cancelledAt: null,
    })
    createdBookingIds.push(booking.id)

    // Round-trip: read back from DB and verify totalPrice persisted
    const fromDb = await bookingRepo.findById(SYSTEM_CONTEXT, booking.id)
    expect(fromDb!.totalPrice).toBe(15000)
  })

  it('rejects overlapping bookings with PG error code 23P01', async () => {
    const firstBooking = await seedBooking({
      startAt: new Date('2027-01-01T10:00:00Z'),
      endAt: new Date('2027-01-01T14:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(firstBooking.id)

    try {
      const second = await seedBooking({
        startAt: new Date('2027-01-01T13:00:00Z'),
        endAt: new Date('2027-01-01T17:00:00Z'),
        status: 'CONFIRMED',
        source: 'DIRECT',
        externalId: null,
        notes: null,
      })
      // If we get here, the constraint didn't fire
      createdBookingIds.push(second.id)
      expect.unreachable('Expected exclusion constraint violation')
    } catch (err) {
      // Validate through the same abstraction the production code uses
      expect(pgErrorCode(err)).toBe('23P01')
    }
  })

  it('allows overlapping booking after first is cancelled', async () => {
    const firstBooking = await seedBooking({
      startAt: new Date('2027-02-01T10:00:00Z'),
      endAt: new Date('2027-02-01T14:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(firstBooking.id)

    // Cancel the first booking
    const cancelled = await bookingRepo.cancel(SYSTEM_CONTEXT, firstBooking.id, {
      from: 'CONFIRMED',
      fee: 0,
      cancelledAt: new Date(),
    })
    expect(cancelled).toBeDefined()
    expect(cancelled!.status).toBe('CANCELLED')
    // #868 Slice 3a: a fresh cancel records the fee but never moves money — the
    // drizzle read path must carry the column default through unchanged. Pins the
    // drizzle side of the seam (the in-memory side is pinned in booking.test.ts);
    // a future cancel() that sets a non-ADVISORY state must do so via #851, not here.
    expect(cancelled!.cancellationFeeSettlement).toBe('ADVISORY')

    // Overlapping booking should now succeed — exclusion constraint
    // only applies to CONFIRMED/ACTIVE
    const secondBooking = await seedBooking({
      startAt: new Date('2027-02-01T12:00:00Z'),
      endAt: new Date('2027-02-01T16:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(secondBooking.id)

    expect(secondBooking.status).toBe('CONFIRMED')
    expect(secondBooking.assignedVehicleId).toBe(testVehicle.id)
  })

  it('allows adjacent (non-overlapping) bookings on same vehicle', async () => {
    // First booking: 10:00-14:00; trigger turnaround 120min -> effectiveEnd 16:00.
    const firstEnd = new Date('2027-04-01T14:00:00Z')
    const first = await seedBooking({
      startAt: new Date('2027-04-01T10:00:00Z'),
      endAt: firstEnd,
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(first.id)
    expect(first.effectiveEndAt).toEqual(effectiveEnd(firstEnd)) // 16:00

    // Second booking starts exactly at first's effectiveEndAt (boundary).
    // tstzrange is [closed, open) so startAt === effectiveEndAt does NOT overlap.
    const second = await seedBooking({
      startAt: effectiveEnd(firstEnd), // 16:00
      endAt: new Date('2027-04-01T19:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(second.id)

    expect(second.status).toBe('CONFIRMED')
    expect(second.startAt).toEqual(effectiveEnd(firstEnd))
  })

  it('concurrent overlapping bookings: exactly one succeeds', async () => {
    const window = {
      startAt: new Date('2027-06-01T10:00:00Z'),
      endAt: new Date('2027-06-01T14:00:00Z'),
      status: 'CONFIRMED' as const,
      source: 'DIRECT' as const,
      externalId: null,
      notes: null,
    }

    // Distinct bookingCode per call (helper) so the ONLY conflict is the
    // exclusion constraint on the shared vehicle + overlapping range.
    const results = await Promise.allSettled([seedBooking(window), seedBooking(window)])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    // The rejection is the exclusion violation, not a bookingCode clash.
    const reason = (rejected[0] as PromiseRejectedResult).reason
    expect(pgErrorCode(reason)).toBe('23P01')

    // Clean up the one that succeeded
    const winner = (fulfilled[0] as PromiseFulfilledResult<{ id: string }>).value
    createdBookingIds.push(winner.id)
  })
})

describe('POST /bookings via HTTP (real Postgres)', () => {
  const httpBookingIds: string[] = []
  let httpUser: { id: string; email: string }
  let httpVehicle: Vehicle
  let app: ReturnType<typeof createApp>
  let headers: Record<string, string>

  beforeAll(async () => {
    setupAuthEnv()

    const [user] = await db
      .insert(users)
      .values({
        id: crypto.randomUUID(),
        email: `http-overlap-${Date.now()}@kuruma-test.com`,
        role: 'RENTER',
        language: 'en',
      })
      .returning()
    httpUser = user

    const httpVehicleRepo = new DrizzleVehicleRepository(db)
    const httpBookingRepo = new DrizzleBookingRepository(db)
    const httpAvailabilityRepo = new DrizzleAvailabilityRepository(db)
    const httpVehicleClassRepo = new DrizzleVehicleClassRepository(db)

    httpVehicle = await httpVehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      classId: testClassId,
      pickupLocationId: testLocationId, // #392: car must live where it's booked
      name: 'HTTP Overlap Test Car',
      description: null,
      seats: 4,
      transmission: 'AUTO',
      fuelType: null,
      licensePlate: null,
      status: 'AVAILABLE',
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: 8000,
      hourlyRateJpy: null,
      shakenExpiryDate: '2099-06-15',
      insuranceExpiryDate: '2099-01-01',
    })

    // The booking submit reads the pickup location INSIDE the transaction to
    // derive turnaround (services/booking.ts submitInTx). Inject the Drizzle
    // location repo so the tx sees the DB-seeded tenant location — otherwise the
    // override branch defaults to an empty in-memory repo and submit 400s.
    app = createApp({
      vehicleRepo: httpVehicleRepo,
      bookingRepo: httpBookingRepo,
      availabilityRepo: httpAvailabilityRepo,
      vehicleClassRepo: httpVehicleClassRepo,
      locationRepo: new DrizzleLocationRepository(db),
    })
    headers = await authHeaders({ sub: httpUser.id, role: 'RENTER' })
  })

  afterEach(async () => {
    await cleanupBookings(httpBookingIds)
    httpBookingIds.length = 0
  })

  afterAll(async () => {
    if (httpVehicle) await cleanupVehicles([httpVehicle.id])
    if (httpUser) await cleanupUsers([httpUser.id])
  })

  it('returns 409 when second booking overlaps an existing CONFIRMED booking', async () => {
    // Slice 6 contract: renter books a concrete vehicle; operatorId / classId /
    // assignedVehicleId / turnaround are all server-derived. pickup/dropoff point
    // at the tenant's location seeded in the file-level beforeAll.
    const bookingBody = {
      requestedVehicleId: httpVehicle.id,
      pickupLocationId: testLocationId,
      dropoffLocationId: testLocationId,
      startAt: '2027-03-01T10:00:00Z',
      endAt: '2027-03-01T14:00:00Z',
      source: 'DIRECT',
      // RENTER self-serve bookings must carry the liability-disclaimer consent
      // (#613) or the route rejects them with 400 CONSENT_REQUIRED.
      disclaimerAccepted: true,
    }

    const first = await app.request('/bookings', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(bookingBody),
    })
    expect(first.status).toBe(201)
    const firstBody = await first.json()
    httpBookingIds.push(firstBody.data.id)

    // Second request with overlapping time range
    const second = await app.request('/bookings', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...bookingBody,
        startAt: '2027-03-01T13:00:00Z',
        endAt: '2027-03-01T17:00:00Z',
      }),
    })

    expect(second.status).toBe(409)
    const secondBody = await second.json()
    expect(secondBody.success).toBe(false)
    expect(secondBody.error).toMatch(/already booked/i)
  })

  it('rejects a cross-operator dropoff with 400 (#882 same-operator one-way guardrail)', async () => {
    // #882: one-way rentals are SAME-operator only. A dropoff at ANOTHER
    // operator's location must be rejected — there is no shared rule/custody/
    // settlement model across operators — until a separate "multi-operator
    // return network" exists. This locks the guardrail in booking-creation.ts
    // (a cross-`operatorId` dropoff -> 400) so the boundary can't silently erode.
    // httpVehicle belongs to Best Car Rental and lives at testLocationId; the
    // dropoff is a Kansai Drive (SECOND_OPERATOR_ID) location — an EXISTING row,
    // so this fails on the operator mismatch, not a missing-location check.
    const foreignDropoff = await seedLocation('xop-dropoff', TURNAROUND_MINUTES, SECOND_OPERATOR_ID)
    createdLocationIds.push(foreignDropoff.id)

    const res = await app.request('/bookings', {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestedVehicleId: httpVehicle.id,
        pickupLocationId: testLocationId,
        dropoffLocationId: foreignDropoff.id,
        startAt: '2027-04-01T10:00:00Z',
        endAt: '2027-04-01T14:00:00Z',
        source: 'DIRECT',
        disclaimerAccepted: true,
      }),
    })

    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.success).toBe(false)
    expect(body.error).toMatch(/dropoff/i)
  })
})
