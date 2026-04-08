import { users } from '@kuruma/shared/db/schema'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DrizzleBookingRepository, DrizzleVehicleRepository } from '../../src/repositories/drizzle'
import type { Vehicle } from '../../src/stores'
import { cleanupBookings, cleanupUsers, cleanupVehicles, db } from './setup'

const bookingRepo = new DrizzleBookingRepository(db)
const vehicleRepo = new DrizzleVehicleRepository(db)

let testUser: { id: string; email: string }
let testVehicle: Vehicle
const createdBookingIds: string[] = []
const createdVehicleIds: string[] = []

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

  testVehicle = await vehicleRepo.create({
    name: 'Booking Test Car',
    description: null,
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    status: 'AVAILABLE',
    bufferMinutes: 60,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
  })
  createdVehicleIds.push(testVehicle.id)
})

afterEach(async () => {
  await cleanupBookings(createdBookingIds)
  createdBookingIds.length = 0
})

afterAll(async () => {
  await cleanupVehicles(createdVehicleIds)
  await cleanupUsers([testUser.id])
})

describe('DrizzleBookingRepository', () => {
  it('create inserts and returns a booking with correct fields', async () => {
    const input = {
      renterId: testUser.id,
      vehicleId: testVehicle.id,
      startAt: new Date('2026-07-01T10:00:00Z'),
      endAt: new Date('2026-07-01T14:00:00Z'),
      effectiveEndAt: new Date('2026-07-01T15:00:00Z'),
      status: 'CONFIRMED' as const,
      source: 'DIRECT' as const,
      externalId: null,
      notes: 'Test booking',
    }

    const booking = await bookingRepo.create(input)
    createdBookingIds.push(booking.id)

    expect(booking.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(booking.renterId).toBe(testUser.id)
    expect(booking.vehicleId).toBe(testVehicle.id)
    expect(booking.startAt).toEqual(new Date('2026-07-01T10:00:00Z'))
    expect(booking.endAt).toEqual(new Date('2026-07-01T14:00:00Z'))
    expect(booking.effectiveEndAt).toEqual(new Date('2026-07-01T15:00:00Z'))
    expect(booking.status).toBe('CONFIRMED')
    expect(booking.source).toBe('DIRECT')
    expect(booking.externalId).toBeNull()
    expect(booking.notes).toBe('Test booking')
    expect(booking.createdAt).toBeInstanceOf(Date)
    expect(booking.updatedAt).toBeInstanceOf(Date)
  })

  it('findById retrieves a created booking', async () => {
    const created = await bookingRepo.create({
      renterId: testUser.id,
      vehicleId: testVehicle.id,
      startAt: new Date('2026-08-01T09:00:00Z'),
      endAt: new Date('2026-08-01T12:00:00Z'),
      effectiveEndAt: new Date('2026-08-01T13:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(created.id)

    const found = await bookingRepo.findById(created.id)

    expect(found).toBeDefined()
    expect(found!.id).toBe(created.id)
    expect(found!.renterId).toBe(testUser.id)
    expect(found!.vehicleId).toBe(testVehicle.id)
    expect(found!.startAt).toEqual(new Date('2026-08-01T09:00:00Z'))
    expect(found!.endAt).toEqual(new Date('2026-08-01T12:00:00Z'))
    expect(found!.effectiveEndAt).toEqual(new Date('2026-08-01T13:00:00Z'))
    expect(found!.status).toBe('CONFIRMED')
    expect(found!.source).toBe('DIRECT')
    expect(found!.externalId).toBeNull()
    expect(found!.notes).toBeNull()
  })

  it('findById returns undefined for non-existent id', async () => {
    const found = await bookingRepo.findById('non-existent-id')
    expect(found).toBeUndefined()
  })

  it('findAll returns bookings and filters by status', async () => {
    const confirmed = await bookingRepo.create({
      renterId: testUser.id,
      vehicleId: testVehicle.id,
      startAt: new Date('2026-09-01T10:00:00Z'),
      endAt: new Date('2026-09-01T14:00:00Z'),
      effectiveEndAt: new Date('2026-09-01T15:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(confirmed.id)

    const cancelled = await bookingRepo.create({
      renterId: testUser.id,
      vehicleId: testVehicle.id,
      startAt: new Date('2026-10-01T10:00:00Z'),
      endAt: new Date('2026-10-01T14:00:00Z'),
      effectiveEndAt: new Date('2026-10-01T15:00:00Z'),
      status: 'CANCELLED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(cancelled.id)

    const all = await bookingRepo.findAll()
    const allIds = all.map((b) => b.id)
    expect(allIds).toContain(confirmed.id)
    expect(allIds).toContain(cancelled.id)

    const filtered = await bookingRepo.findAll({ status: 'CONFIRMED' })
    const filteredIds = filtered.map((b) => b.id)
    expect(filteredIds).toContain(confirmed.id)
    expect(filteredIds).not.toContain(cancelled.id)
  })

  it('findAll filters by vehicleId', async () => {
    const otherVehicle = await vehicleRepo.create({
      name: 'Other Car',
      description: null,
      seats: 4,
      transmission: 'MANUAL',
      fuelType: null,
      status: 'AVAILABLE',
      bufferMinutes: 60,
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
    })
    createdVehicleIds.push(otherVehicle.id)

    const bookingA = await bookingRepo.create({
      renterId: testUser.id,
      vehicleId: testVehicle.id,
      startAt: new Date('2026-11-01T10:00:00Z'),
      endAt: new Date('2026-11-01T14:00:00Z'),
      effectiveEndAt: new Date('2026-11-01T15:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(bookingA.id)

    const bookingB = await bookingRepo.create({
      renterId: testUser.id,
      vehicleId: otherVehicle.id,
      startAt: new Date('2026-11-01T10:00:00Z'),
      endAt: new Date('2026-11-01T14:00:00Z'),
      effectiveEndAt: new Date('2026-11-01T15:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(bookingB.id)

    const filtered = await bookingRepo.findAll({ vehicleId: testVehicle.id })
    const filteredIds = filtered.map((b) => b.id)
    expect(filteredIds).toContain(bookingA.id)
    expect(filteredIds).not.toContain(bookingB.id)
  })

  it('updateStatus transitions CONFIRMED to ACTIVE', async () => {
    const created = await bookingRepo.create({
      renterId: testUser.id,
      vehicleId: testVehicle.id,
      startAt: new Date('2026-12-01T10:00:00Z'),
      endAt: new Date('2026-12-01T14:00:00Z'),
      effectiveEndAt: new Date('2026-12-01T15:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(created.id)

    const updated = await bookingRepo.updateStatus(created.id, 'ACTIVE')

    expect(updated).toBeDefined()
    expect(updated!.id).toBe(created.id)
    expect(updated!.status).toBe('ACTIVE')
    expect(updated!.renterId).toBe(testUser.id)
    expect(updated!.vehicleId).toBe(testVehicle.id)
    expect(updated!.startAt).toEqual(new Date('2026-12-01T10:00:00Z'))

    // Verify persisted in DB
    const fromDb = await bookingRepo.findById(created.id)
    expect(fromDb!.status).toBe('ACTIVE')
  })

  it('rejects overlapping bookings via exclusion constraint', async () => {
    const firstBooking = await bookingRepo.create({
      renterId: testUser.id,
      vehicleId: testVehicle.id,
      startAt: new Date('2027-01-01T10:00:00Z'),
      endAt: new Date('2027-01-01T14:00:00Z'),
      effectiveEndAt: new Date('2027-01-01T15:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(firstBooking.id)

    await expect(
      bookingRepo.create({
        renterId: testUser.id,
        vehicleId: testVehicle.id,
        startAt: new Date('2027-01-01T13:00:00Z'),
        endAt: new Date('2027-01-01T17:00:00Z'),
        effectiveEndAt: new Date('2027-01-01T18:00:00Z'),
        status: 'CONFIRMED',
        source: 'DIRECT',
        externalId: null,
        notes: null,
      }),
    ).rejects.toThrow()
  })
})
