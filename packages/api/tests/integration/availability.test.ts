import { users } from '@kuruma/shared/db/schema'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import type { Vehicle } from '../../src/stores'
import { cleanupBookings, cleanupUsers, cleanupVehicles, db } from './setup'

const vehicleRepo = new DrizzleVehicleRepository(db)
const bookingRepo = new DrizzleBookingRepository(db)
const availabilityRepo = new DrizzleAvailabilityRepository(db)

let testUser: { id: string; email: string }
const createdVehicleIds: string[] = []
const createdBookingIds: string[] = []

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
})

afterEach(async () => {
  await cleanupBookings(createdBookingIds)
  createdBookingIds.length = 0
})

afterAll(async () => {
  await cleanupVehicles(createdVehicleIds)
  await cleanupUsers([testUser.id])
})

function createTestVehicle(
  overrides: Partial<Omit<Vehicle, 'id' | 'createdAt' | 'updatedAt'>> = {},
): Promise<Vehicle> {
  return vehicleRepo.create({
    name: overrides.name ?? 'Avail Test Car',
    description: overrides.description ?? null,
    seats: overrides.seats ?? 5,
    transmission: overrides.transmission ?? 'AUTO',
    fuelType: overrides.fuelType ?? null,
    status: overrides.status ?? 'AVAILABLE',
    bufferMinutes: overrides.bufferMinutes ?? 60,
    minRentalHours: overrides.minRentalHours ?? null,
    maxRentalHours: overrides.maxRentalHours ?? null,
    advanceBookingHours: overrides.advanceBookingHours ?? null,
  })
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
      const vehicle = await createTestVehicle({ name: 'Overlap Car', bufferMinutes: 60 })
      createdVehicleIds.push(vehicle.id)

      const endAt = new Date('2026-08-01T14:00:00Z')
      const effectiveEndAt = new Date(endAt.getTime() + vehicle.bufferMinutes * 60 * 1000)

      const booking = await bookingRepo.create({
        renterId: testUser.id,
        vehicleId: vehicle.id,
        startAt: new Date('2026-08-01T10:00:00Z'),
        endAt,
        effectiveEndAt,
        status: 'CONFIRMED',
        source: 'DIRECT',
        externalId: null,
        notes: null,
      })
      createdBookingIds.push(booking.id)

      // Query 12:00-16:00 overlaps with booking 10:00-15:00(effective)
      const result = await availabilityRepo.findAvailableVehicles(
        new Date('2026-08-01T12:00:00Z'),
        new Date('2026-08-01T16:00:00Z'),
      )

      const resultIds = result.map((v) => v.id)
      expect(resultIds).not.toContain(vehicle.id)
    })

    it('includes vehicles without overlap', async () => {
      const vehicle = await createTestVehicle({ name: 'No Overlap Car', bufferMinutes: 60 })
      createdVehicleIds.push(vehicle.id)

      const endAt = new Date('2026-08-01T14:00:00Z')
      const effectiveEndAt = new Date(endAt.getTime() + vehicle.bufferMinutes * 60 * 1000)

      const booking = await bookingRepo.create({
        renterId: testUser.id,
        vehicleId: vehicle.id,
        startAt: new Date('2026-08-01T10:00:00Z'),
        endAt,
        effectiveEndAt,
        status: 'CONFIRMED',
        source: 'DIRECT',
        externalId: null,
        notes: null,
      })
      createdBookingIds.push(booking.id)

      // Query 16:00-20:00 does not overlap with booking 10:00-15:00(effective)
      const result = await availabilityRepo.findAvailableVehicles(
        new Date('2026-08-01T16:00:00Z'),
        new Date('2026-08-01T20:00:00Z'),
      )

      const resultIds = result.map((v) => v.id)
      expect(resultIds).toContain(vehicle.id)
    })

    it('respects effectiveEndAt buffer -- excludes when query falls in buffer window', async () => {
      // Booking 10:00-14:00, buffer 60min, effectiveEndAt = 15:00
      const vehicle = await createTestVehicle({ name: 'Buffer Car', bufferMinutes: 60 })
      createdVehicleIds.push(vehicle.id)

      const endAt = new Date('2026-08-01T14:00:00Z')
      const effectiveEndAt = new Date(endAt.getTime() + vehicle.bufferMinutes * 60 * 1000) // 15:00

      const booking = await bookingRepo.create({
        renterId: testUser.id,
        vehicleId: vehicle.id,
        startAt: new Date('2026-08-01T10:00:00Z'),
        endAt,
        effectiveEndAt,
        status: 'CONFIRMED',
        source: 'DIRECT',
        externalId: null,
        notes: null,
      })
      createdBookingIds.push(booking.id)

      // Query 14:30-16:00 overlaps with effective range [10:00, 15:00)
      const excluded = await availabilityRepo.findAvailableVehicles(
        new Date('2026-08-01T14:30:00Z'),
        new Date('2026-08-01T16:00:00Z'),
      )
      expect(excluded.map((v) => v.id)).not.toContain(vehicle.id)
    })

    it('respects effectiveEndAt buffer -- includes when query starts after buffer', async () => {
      // Booking 10:00-14:00, buffer 60min, effectiveEndAt = 15:00
      const vehicle = await createTestVehicle({ name: 'Buffer Car 2', bufferMinutes: 60 })
      createdVehicleIds.push(vehicle.id)

      const endAt = new Date('2026-08-01T14:00:00Z')
      const effectiveEndAt = new Date(endAt.getTime() + vehicle.bufferMinutes * 60 * 1000) // 15:00

      const booking = await bookingRepo.create({
        renterId: testUser.id,
        vehicleId: vehicle.id,
        startAt: new Date('2026-08-01T10:00:00Z'),
        endAt,
        effectiveEndAt,
        status: 'CONFIRMED',
        source: 'DIRECT',
        externalId: null,
        notes: null,
      })
      createdBookingIds.push(booking.id)

      // Query 15:30-18:00 does NOT overlap with effective range [10:00, 15:00)
      // tstzrange is [) by default, so 15:00 is excluded from the booking range
      // and 15:30 starts after 15:00, so no overlap
      const included = await availabilityRepo.findAvailableVehicles(
        new Date('2026-08-01T15:30:00Z'),
        new Date('2026-08-01T18:00:00Z'),
      )
      expect(included.map((v) => v.id)).toContain(vehicle.id)
    })

    it('ignores CANCELLED bookings', async () => {
      const vehicle = await createTestVehicle({ name: 'Cancelled Car' })
      createdVehicleIds.push(vehicle.id)

      const endAt = new Date('2026-08-01T14:00:00Z')
      const effectiveEndAt = new Date(endAt.getTime() + vehicle.bufferMinutes * 60 * 1000)

      const booking = await bookingRepo.create({
        renterId: testUser.id,
        vehicleId: vehicle.id,
        startAt: new Date('2026-08-01T10:00:00Z'),
        endAt,
        effectiveEndAt,
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

      const endAt = new Date('2026-08-01T14:00:00Z')
      const effectiveEndAt = new Date(endAt.getTime() + vehicle.bufferMinutes * 60 * 1000)

      const booking = await bookingRepo.create({
        renterId: testUser.id,
        vehicleId: vehicle.id,
        startAt: new Date('2026-08-01T10:00:00Z'),
        endAt,
        effectiveEndAt,
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
