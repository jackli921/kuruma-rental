import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { users } from '@kuruma/shared/db/schema'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
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
const availabilityRepo = new DrizzleAvailabilityRepository(db)

// Slice 6 (#392): turnaround is location-derived. The DB trigger sets
// effectiveEndAt = endAt + pickupLocation.defaultTurnaroundMinutes (migration
// 0036). We seed a location with an EXPLICIT 120-min turnaround so the buffer
// window is exact AND not the gone 60-min vehicle buffer — the "excludes when
// query in buffer" case below FAILS if turnaround ever reverts to 60.
const TURNAROUND_MINUTES = 120

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
      email: `test-avail-${Date.now()}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
    .returning()
  testUser = user

  const klass = await seedVehicleClass('avail')
  testClassId = klass.id
  createdClassIds.push(klass.id)

  const location = await seedLocation('avail', TURNAROUND_MINUTES)
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

function createTestVehicle(
  overrides: Partial<Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>> = {},
): Promise<Vehicle> {
  return vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: overrides.operatorId ?? BEST_CAR_RENTAL_OPERATOR_ID,
    classId: overrides.classId ?? testClassId,
    pickupLocationId: overrides.pickupLocationId ?? testLocationId,
    name: overrides.name ?? 'Avail Test Car',
    description: overrides.description ?? null,
    seats: overrides.seats ?? 5,
    transmission: overrides.transmission ?? 'AUTO',
    fuelType: overrides.fuelType ?? null,
    licensePlate: overrides.licensePlate ?? null,
    status: overrides.status ?? 'AVAILABLE',
    minRentalHours: overrides.minRentalHours ?? null,
    maxRentalHours: overrides.maxRentalHours ?? null,
    advanceBookingHours: overrides.advanceBookingHours ?? null,
    dailyRateJpy: overrides.dailyRateJpy ?? DEFAULT_DAILY_RATE_JPY,
    shakenExpiryDate: overrides.shakenExpiryDate ?? null,
    insuranceExpiryDate: overrides.insuranceExpiryDate ?? null,
  })
}

// Marketplace-shape booking on a given assigned vehicle. effectiveEndAt is NOT
// passed — the DB trigger derives it from the pickup location's turnaround.
function seedBooking(vehicleId: string, overrides: Parameters<typeof bookingInput>[0] = {}) {
  return bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      renterId: testUser.id,
      classId: testClassId,
      requestedVehicleId: vehicleId,
      assignedVehicleId: vehicleId,
      pickupLocationId: testLocationId,
      dropoffLocationId: testLocationId,
      ...overrides,
    }),
  )
}

describe('DrizzleAvailabilityRepository', () => {
  describe('findAvailableVehicles', () => {
    it('returns all AVAILABLE vehicles when no bookings exist', async () => {
      const vehicleA = await createTestVehicle({ name: 'Avail Car A' })
      createdVehicleIds.push(vehicleA.id)
      const vehicleB = await createTestVehicle({ name: 'Avail Car B' })
      createdVehicleIds.push(vehicleB.id)

      const result = await availabilityRepo.findAvailableVehicles(
        new Date('2026-08-01T10:00:00Z'),
        new Date('2026-08-01T14:00:00Z'),
      )

      const resultIds = result.map((v) => v.id)
      expect(resultIds).toContain(vehicleA.id)
      expect(resultIds).toContain(vehicleB.id)
    })

    it('excludes vehicles with overlapping bookings', async () => {
      const vehicle = await createTestVehicle({ name: 'Overlap Car' })
      createdVehicleIds.push(vehicle.id)

      // Booking 10:00-14:00; trigger turnaround 120min -> effectiveEnd 16:00.
      const booking = await seedBooking(vehicle.id, {
        startAt: new Date('2026-08-01T10:00:00Z'),
        endAt: new Date('2026-08-01T14:00:00Z'),
        status: 'CONFIRMED',
        source: 'DIRECT',
        externalId: null,
        notes: null,
      })
      createdBookingIds.push(booking.id)

      // Query 12:00-16:00 overlaps effective range [10:00, 16:00)
      const result = await availabilityRepo.findAvailableVehicles(
        new Date('2026-08-01T12:00:00Z'),
        new Date('2026-08-01T16:00:00Z'),
      )

      const resultIds = result.map((v) => v.id)
      expect(resultIds).not.toContain(vehicle.id)
    })

    it('includes vehicles without overlap', async () => {
      const vehicle = await createTestVehicle({ name: 'No Overlap Car' })
      createdVehicleIds.push(vehicle.id)

      const booking = await seedBooking(vehicle.id, {
        startAt: new Date('2026-08-01T10:00:00Z'),
        endAt: new Date('2026-08-01T14:00:00Z'),
        status: 'CONFIRMED',
        source: 'DIRECT',
        externalId: null,
        notes: null,
      })
      createdBookingIds.push(booking.id)

      // Query 16:00-20:00 starts at the effective end (16:00) -> no overlap
      const result = await availabilityRepo.findAvailableVehicles(
        new Date('2026-08-01T16:00:00Z'),
        new Date('2026-08-01T20:00:00Z'),
      )

      const resultIds = result.map((v) => v.id)
      expect(resultIds).toContain(vehicle.id)
    })

    it('respects effectiveEndAt buffer -- excludes when query in buffer', async () => {
      // Booking 10:00-14:00; location turnaround 120min -> effectiveEndAt = 16:00.
      const vehicle = await createTestVehicle({ name: 'Buffer Car' })
      createdVehicleIds.push(vehicle.id)

      const booking = await seedBooking(vehicle.id, {
        startAt: new Date('2026-08-01T10:00:00Z'),
        endAt: new Date('2026-08-01T14:00:00Z'),
        status: 'CONFIRMED',
        source: 'DIRECT',
        externalId: null,
        notes: null,
      })
      createdBookingIds.push(booking.id)

      // Query 15:15-15:45 falls inside the location-derived turnaround window
      // [10:00, 16:00) but PAST the legacy 60-min end (15:00). A regression to a
      // 60-min turnaround would (wrongly) include this vehicle.
      const excluded = await availabilityRepo.findAvailableVehicles(
        new Date('2026-08-01T15:15:00Z'),
        new Date('2026-08-01T15:45:00Z'),
      )
      expect(excluded.map((v) => v.id)).not.toContain(vehicle.id)
    })

    it('respects effectiveEndAt buffer -- includes when query starts after buffer', async () => {
      // Booking 10:00-14:00; location turnaround 120min -> effectiveEndAt = 16:00.
      const vehicle = await createTestVehicle({ name: 'Buffer Car 2' })
      createdVehicleIds.push(vehicle.id)

      const booking = await seedBooking(vehicle.id, {
        startAt: new Date('2026-08-01T10:00:00Z'),
        endAt: new Date('2026-08-01T14:00:00Z'),
        status: 'CONFIRMED',
        source: 'DIRECT',
        externalId: null,
        notes: null,
      })
      createdBookingIds.push(booking.id)

      // Query 16:00-18:00 starts at the effective end. tstzrange is [) so 16:00
      // is excluded from the booking range -> no overlap -> available.
      const included = await availabilityRepo.findAvailableVehicles(
        new Date('2026-08-01T16:00:00Z'),
        new Date('2026-08-01T18:00:00Z'),
      )
      expect(included.map((v) => v.id)).toContain(vehicle.id)
    })

    it('ignores CANCELLED bookings', async () => {
      const vehicle = await createTestVehicle({ name: 'Cancelled Car' })
      createdVehicleIds.push(vehicle.id)

      const booking = await seedBooking(vehicle.id, {
        startAt: new Date('2026-08-01T10:00:00Z'),
        endAt: new Date('2026-08-01T14:00:00Z'),
        status: 'CANCELLED',
        source: 'DIRECT',
        externalId: null,
        notes: null,
      })
      createdBookingIds.push(booking.id)

      // Query overlaps the cancelled booking's range, but should still be available
      const result = await availabilityRepo.findAvailableVehicles(
        new Date('2026-08-01T12:00:00Z'),
        new Date('2026-08-01T16:00:00Z'),
      )

      expect(result.map((v) => v.id)).toContain(vehicle.id)
    })

    it('with { locationIds } returns only vehicles at those locations (#651 §1c)', async () => {
      const locationB = await seedLocation('avail-b', TURNAROUND_MINUTES)
      createdLocationIds.push(locationB.id)
      const atA = await createTestVehicle({ name: 'At A', pickupLocationId: testLocationId })
      createdVehicleIds.push(atA.id)
      const atB = await createTestVehicle({ name: 'At B', pickupLocationId: locationB.id })
      createdVehicleIds.push(atB.id)

      const result = await availabilityRepo.findAvailableVehicles(
        new Date('2026-08-01T10:00:00Z'),
        new Date('2026-08-01T14:00:00Z'),
        { locationIds: [testLocationId] },
      )

      const ids = result.map((v) => v.id)
      expect(ids).toContain(atA.id)
      expect(ids).not.toContain(atB.id)
    })

    it('with { locationIds: [] } scans nothing (empty region → no vehicles, #651 §1c)', async () => {
      const atA = await createTestVehicle({ name: 'Empty Scope' })
      createdVehicleIds.push(atA.id)

      const result = await availabilityRepo.findAvailableVehicles(
        new Date('2026-08-01T10:00:00Z'),
        new Date('2026-08-01T14:00:00Z'),
        { locationIds: [] },
      )

      expect(result.map((v) => v.id)).not.toContain(atA.id)
    })

    it('excludes MAINTENANCE and RETIRED vehicles', async () => {
      const maintenanceVehicle = await createTestVehicle({
        name: 'Maintenance Car',
        status: 'MAINTENANCE',
      })
      createdVehicleIds.push(maintenanceVehicle.id)
      const retiredVehicle = await createTestVehicle({ name: 'Retired Car', status: 'RETIRED' })
      createdVehicleIds.push(retiredVehicle.id)

      const result = await availabilityRepo.findAvailableVehicles(
        new Date('2026-08-01T10:00:00Z'),
        new Date('2026-08-01T14:00:00Z'),
      )

      const resultIds = result.map((v) => v.id)
      expect(resultIds).not.toContain(maintenanceVehicle.id)
      expect(resultIds).not.toContain(retiredVehicle.id)
    })
  })

  describe('checkVehicleAvailability', () => {
    it('returns available=true when vehicle has no conflicting bookings', async () => {
      const vehicle = await createTestVehicle({ name: 'Check Avail Car' })
      createdVehicleIds.push(vehicle.id)

      const result = await availabilityRepo.checkVehicleAvailability(
        vehicle.id,
        new Date('2026-08-01T10:00:00Z'),
        new Date('2026-08-01T14:00:00Z'),
      )

      expect(result).toBeDefined()
      expect(result!.available).toBe(true)
      expect(result!.vehicle.id).toBe(vehicle.id)
      expect(result!.vehicle.name).toBe('Check Avail Car')
      expect(result!.conflicts).toHaveLength(0)
    })

    it('returns available=false with conflicts when vehicle is booked', async () => {
      const vehicle = await createTestVehicle({ name: 'Booked Car' })
      createdVehicleIds.push(vehicle.id)

      const booking = await seedBooking(vehicle.id, {
        startAt: new Date('2026-08-01T10:00:00Z'),
        endAt: new Date('2026-08-01T14:00:00Z'),
        status: 'CONFIRMED',
        source: 'DIRECT',
        externalId: null,
        notes: null,
      })
      createdBookingIds.push(booking.id)

      const result = await availabilityRepo.checkVehicleAvailability(
        vehicle.id,
        new Date('2026-08-01T12:00:00Z'),
        new Date('2026-08-01T16:00:00Z'),
      )

      expect(result).toBeDefined()
      expect(result!.available).toBe(false)
      expect(result!.vehicle.id).toBe(vehicle.id)
      expect(result!.conflicts).toHaveLength(1)
      expect(result!.conflicts[0].id).toBe(booking.id)
      expect(result!.conflicts[0].startAt).toEqual(new Date('2026-08-01T10:00:00Z'))
      expect(result!.conflicts[0].endAt).toEqual(new Date('2026-08-01T14:00:00Z'))
      expect(result!.conflicts[0].status).toBe('CONFIRMED')
    })

    it('returns undefined for non-existent vehicle', async () => {
      const result = await availabilityRepo.checkVehicleAvailability(
        'non-existent-vehicle-id',
        new Date('2026-08-01T10:00:00Z'),
        new Date('2026-08-01T14:00:00Z'),
      )

      expect(result).toBeUndefined()
    })
  })
})
