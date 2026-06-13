import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { users } from '@kuruma/shared/db/schema'
import { sql } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleBookingRepository,
  DrizzleVehicleDetailRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import type { Vehicle } from '../../src/stores'
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

const vehicleRepo = new DrizzleVehicleRepository(db)
const bookingRepo = new DrizzleBookingRepository(db)
const detailRepo = new DrizzleVehicleDetailRepository(db)

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

// Anchor all relative dates to LOCAL NOON of the current day. The utilization
// window buckets [todayStart-29d, todayStart+1d) with no bucket for tomorrow
// (see vehicle-detail repo dayStart()), so an ACTIVE booking spanning NOW±1h
// loses its post-midnight slice when the suite runs within ~1h of midnight —
// the source of the flaky `expected 3.44 to be close to 4`. Pinning to noon
// keeps the ±1h window far from any day boundary in both UTC (CI) and local
// dev timezones, making the result deterministic regardless of wall-clock.
const NOW = (() => {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  return d
})()
const TODAY_START = (() => {
  const d = new Date(NOW)
  d.setHours(0, 0, 0, 0)
  return d
})()

let testUser: { id: string; email: string }
let testClassId: string
let testLocationId: string
const createdVehicleIds: string[] = []
const createdBookingIds: string[] = []
const createdClassIds: string[] = []
const createdLocationIds: string[] = []

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `vd-${Date.now()}@kuruma-test.com`,
      name: 'Vehicle Detail Tester',
      role: 'RENTER',
      language: 'en',
    })
    .returning()
  testUser = user

  const klass = await seedVehicleClass('vd')
  testClassId = klass.id
  createdClassIds.push(klass.id)

  const location = await seedLocation('vd')
  testLocationId = location.id
  createdLocationIds.push(location.id)
})

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

async function createVehicle(): Promise<Vehicle> {
  const v = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId: testClassId,
    name: 'VD Test Car',
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
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
  })
  createdVehicleIds.push(v.id)
  return v
}

type BookingOverrides = {
  startAt: Date
  endAt: Date
  status: 'CONFIRMED' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  totalPrice?: number | null
  source?: 'DIRECT' | 'TRIP_COM' | 'MANUAL' | 'OTHER'
}

async function createBooking(vehicleId: string, overrides: BookingOverrides) {
  // effectiveEndAt is DB-trigger-derived (#392); utilization/revenue read
  // startAt/endAt, so the turnaround value is irrelevant to these aggregates.
  const booking = await bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      renterId: testUser.id,
      classId: testClassId,
      requestedVehicleId: vehicleId,
      assignedVehicleId: vehicleId,
      pickupLocationId: testLocationId,
      dropoffLocationId: testLocationId,
      startAt: overrides.startAt,
      endAt: overrides.endAt,
      status: overrides.status,
      source: overrides.source ?? 'DIRECT',
      totalPrice: overrides.totalPrice ?? null,
    }),
  )
  createdBookingIds.push(booking.id)
  return booking
}

describe('DrizzleVehicleDetailRepository.findVehicleDetail', () => {
  it('returns undefined for a nonexistent vehicle', async () => {
    const detail = await detailRepo.findVehicleDetail(
      SYSTEM_CONTEXT,
      '00000000-0000-0000-0000-000000000000',
      NOW,
    )
    expect(detail).toBeUndefined()
  })

  it('returns zeroed aggregates for a vehicle with no bookings or logs', async () => {
    const vehicle = await createVehicle()

    const detail = await detailRepo.findVehicleDetail(SYSTEM_CONTEXT, vehicle.id, NOW)

    expect(detail).toBeDefined()
    expect(detail!.id).toBe(vehicle.id)
    expect(detail!.name).toBe('VD Test Car')
    expect(detail!.maintenanceLogs).toEqual([])
    expect(detail!.upcomingBookings).toEqual([])
    expect(detail!.revenueLast7d).toBe(0)
    expect(detail!.revenueLast30d).toBe(0)
    expect(detail!.revenueAllTime).toBe(0)
    expect(detail!.utilizationLast30Days).toHaveLength(30)
    for (const day of detail!.utilizationLast30Days) {
      expect(day.bookedHours).toBe(0)
    }
  })

  it('includes COMPLETED booking from 3 days ago in 7d, 30d, and all-time revenue', async () => {
    const vehicle = await createVehicle()
    // endAt 3 days before NOW — comfortably inside both 7d and 30d windows.
    const endAt = new Date(NOW.getTime() - 3 * DAY_MS)
    const startAt = new Date(endAt.getTime() - 4 * HOUR_MS)
    await createBooking(vehicle.id, {
      startAt,
      endAt,
      status: 'COMPLETED',
      totalPrice: 12000,
    })

    const detail = await detailRepo.findVehicleDetail(SYSTEM_CONTEXT, vehicle.id, NOW)

    expect(detail!.revenueLast7d).toBe(12000)
    expect(detail!.revenueLast30d).toBe(12000)
    expect(detail!.revenueAllTime).toBe(12000)
  })

  it('excludes COMPLETED booking older than 7d from 7d revenue but includes in 30d', async () => {
    const vehicle = await createVehicle()
    // endAt exactly 8 days ago — outside 7d window (inclusive of cutoff),
    // inside 30d window.
    const endAt = new Date(NOW.getTime() - 8 * DAY_MS)
    const startAt = new Date(endAt.getTime() - 4 * HOUR_MS)
    await createBooking(vehicle.id, {
      startAt,
      endAt,
      status: 'COMPLETED',
      totalPrice: 9000,
    })

    const detail = await detailRepo.findVehicleDetail(SYSTEM_CONTEXT, vehicle.id, NOW)

    expect(detail!.revenueLast7d).toBe(0)
    expect(detail!.revenueLast30d).toBe(9000)
    expect(detail!.revenueAllTime).toBe(9000)
  })

  it('excludes COMPLETED booking older than 30d from both 7d and 30d but still counts in all-time', async () => {
    const vehicle = await createVehicle()
    const endAt = new Date(NOW.getTime() - 31 * DAY_MS)
    const startAt = new Date(endAt.getTime() - 4 * HOUR_MS)
    await createBooking(vehicle.id, {
      startAt,
      endAt,
      status: 'COMPLETED',
      totalPrice: 5000,
    })

    const detail = await detailRepo.findVehicleDetail(SYSTEM_CONTEXT, vehicle.id, NOW)

    expect(detail!.revenueLast7d).toBe(0)
    expect(detail!.revenueLast30d).toBe(0)
    expect(detail!.revenueAllTime).toBe(5000)
  })

  it('counts CONFIRMED and ACTIVE bookings in utilization only, not revenue', async () => {
    const vehicle = await createVehicle()
    // CONFIRMED 2-hour booking 3 days ago (inside the 30-day utilization window).
    // Using a past CONFIRMED booking is unusual but models data where the
    // owner manually flips statuses; the query filter excludes only CANCELLED.
    const confEnd = new Date(NOW.getTime() - 3 * DAY_MS)
    const confStart = new Date(confEnd.getTime() - 2 * HOUR_MS)
    // ACTIVE booking: spans "now" — startAt 1h ago, endAt 1h from now.
    const activeStart = new Date(NOW.getTime() - HOUR_MS)
    const activeEnd = new Date(NOW.getTime() + HOUR_MS)
    await createBooking(vehicle.id, {
      startAt: confStart,
      endAt: confEnd,
      status: 'CONFIRMED',
      totalPrice: 1234, // totalPrice present but status != COMPLETED, so no revenue
    })
    await createBooking(vehicle.id, {
      startAt: activeStart,
      endAt: activeEnd,
      status: 'ACTIVE',
      totalPrice: 2345,
    })

    const detail = await detailRepo.findVehicleDetail(SYSTEM_CONTEXT, vehicle.id, NOW)

    // No revenue: neither booking is COMPLETED.
    expect(detail!.revenueLast7d).toBe(0)
    expect(detail!.revenueLast30d).toBe(0)
    expect(detail!.revenueAllTime).toBe(0)

    // Utilization: both bookings contribute 2h each = 4h total across the
    // 30-day window. Each booking is inside the [today-29d, today+1d) range
    // that the utilization query fetches.
    const total = detail!.utilizationLast30Days.reduce((s, d) => s + d.bookedHours, 0)
    expect(total).toBeCloseTo(4, 2)
  })

  it('excludes CANCELLED bookings from revenue and utilization', async () => {
    const vehicle = await createVehicle()
    const endAt = new Date(NOW.getTime() - 2 * DAY_MS)
    const startAt = new Date(endAt.getTime() - 4 * HOUR_MS)
    await createBooking(vehicle.id, {
      startAt,
      endAt,
      status: 'CANCELLED',
      totalPrice: 8000,
    })

    const detail = await detailRepo.findVehicleDetail(SYSTEM_CONTEXT, vehicle.id, NOW)

    expect(detail!.revenueLast7d).toBe(0)
    expect(detail!.revenueLast30d).toBe(0)
    expect(detail!.revenueAllTime).toBe(0)
    for (const day of detail!.utilizationLast30Days) {
      expect(day.bookedHours).toBe(0)
    }
  })

  it('clips a booking that starts before the 30d window to the window boundary', async () => {
    const vehicle = await createVehicle()
    // Booking starts 32 days before TODAY_START, ends 28 days before TODAY_START.
    // Window start is TODAY_START - 29d. So overlap inside the window is
    // [TODAY_START - 29d, TODAY_START - 28d) = 24 hours exactly.
    const startAt = new Date(TODAY_START.getTime() - 32 * DAY_MS)
    const endAt = new Date(TODAY_START.getTime() - 28 * DAY_MS)
    await createBooking(vehicle.id, {
      startAt,
      endAt,
      status: 'COMPLETED',
      totalPrice: 7000,
    })

    const detail = await detailRepo.findVehicleDetail(SYSTEM_CONTEXT, vehicle.id, NOW)

    const total = detail!.utilizationLast30Days.reduce((s, d) => s + d.bookedHours, 0)
    // overlap from TODAY_START - 29d (inclusive) to TODAY_START - 28d (exclusive)
    // = 24 hours. Clipping to window is the `overlapHours` contract.
    expect(total).toBeCloseTo(24, 2)
  })

  it('throws a recognizable error when a booking row has a status outside the upcoming union', async () => {
    // Insert a COMPLETED future booking via raw SQL, bypassing the query
    // filter's union. Then temporarily insert a CONFIRMED row, flip its
    // status to COMPLETED AFTER insertion, and move startAt to future —
    // but the exclusion constraint and domain-layer mappers protect us.
    //
    // Easier approach: directly test the mapper surfaces a useful error.
    // The production query filter guarantees CONFIRMED/ACTIVE only, so we
    // exercise the defensive check by calling the mapper with a stub row.
    const { toVehicleDetailBooking } = await import('../../src/repositories/drizzle/shared')
    expect(() =>
      toVehicleDetailBooking({
        id: 'bogus',
        startAt: new Date(),
        endAt: new Date(),
        source: 'DIRECT',
        status: 'COMPLETED', // outside the CONFIRMED | ACTIVE union
        renterName: null,
      }),
    ).toThrowError(/Invalid booking status for vehicle detail/)

    expect(() =>
      toVehicleDetailBooking({
        id: 'bogus2',
        startAt: new Date(),
        endAt: new Date(),
        source: 'UNKNOWN_SOURCE',
        status: 'CONFIRMED',
        renterName: null,
      }),
    ).toThrowError(/Invalid booking source for vehicle detail/)
  })

  it('surfaces maintenance logs for the vehicle', async () => {
    const vehicle = await createVehicle()
    // Insert a maintenance log directly via SQL — there's no repo factory
    // helper for it in this suite and we just need one row to verify the
    // mapper ferries fields across correctly.
    const logId = crypto.randomUUID()
    const resolvedAtIso = new Date(NOW.getTime() - DAY_MS).toISOString()
    const startedAtIso = new Date(NOW.getTime() - DAY_MS - 2 * HOUR_MS).toISOString()
    await db.execute(sql`
      INSERT INTO maintenance_logs
        (id, "vehicleId", reason, notes, "costJpy", "startedAt", "resolvedAt", "createdAt", "updatedAt")
      VALUES
        (${logId}, ${vehicle.id}, ${'OIL_CHANGE'}, ${'routine'}, ${4500}, ${startedAtIso}, ${resolvedAtIso}, NOW(), NOW())
    `)

    try {
      const detail = await detailRepo.findVehicleDetail(SYSTEM_CONTEXT, vehicle.id, NOW)
      expect(detail!.maintenanceLogs).toHaveLength(1)
      const log = detail!.maintenanceLogs[0]!
      expect(log.id).toBe(logId)
      expect(log.vehicleId).toBe(vehicle.id)
      expect(log.reason).toBe('OIL_CHANGE')
      expect(log.notes).toBe('routine')
      expect(log.costJpy).toBe(4500)
    } finally {
      await db.execute(sql`DELETE FROM maintenance_logs WHERE id = ${logId}`)
    }
  })
})
