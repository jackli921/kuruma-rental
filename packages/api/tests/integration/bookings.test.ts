import { users } from '@kuruma/shared/db/schema'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from '../../src/index'
import { pgErrorCode } from '../../src/pg-errors'
import {
  DrizzleAvailabilityRepository,
  DrizzleBookingRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import type { Vehicle } from '../../src/stores'
import { authHeaders, setupAuthEnv } from '../helpers/auth'
import { DEFAULT_DAILY_RATE_JPY, cleanupBookings, cleanupUsers, cleanupVehicles, db } from './setup'

// --- Test data ---

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
    dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
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
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
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

    const updated = await bookingRepo.updateStatus(created.id, { from: 'CONFIRMED', to: 'ACTIVE' })

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

  it('create persists totalPrice through Drizzle insert (issue #89)', async () => {
    const booking = await bookingRepo.create({
      renterId: testUser.id,
      vehicleId: testVehicle.id,
      startAt: new Date('2026-07-15T10:00:00Z'),
      endAt: new Date('2026-07-15T14:00:00Z'),
      effectiveEndAt: new Date('2026-07-15T15:00:00Z'),
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
    const fromDb = await bookingRepo.findById(booking.id)
    expect(fromDb!.totalPrice).toBe(15000)
  })

  it('rejects overlapping bookings with PG error code 23P01', async () => {
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

    try {
      const second = await bookingRepo.create({
        renterId: testUser.id,
        vehicleId: testVehicle.id,
        startAt: new Date('2027-01-01T13:00:00Z'),
        endAt: new Date('2027-01-01T17:00:00Z'),
        effectiveEndAt: new Date('2027-01-01T18:00:00Z'),
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
    const firstBooking = await bookingRepo.create({
      renterId: testUser.id,
      vehicleId: testVehicle.id,
      startAt: new Date('2027-02-01T10:00:00Z'),
      endAt: new Date('2027-02-01T14:00:00Z'),
      effectiveEndAt: new Date('2027-02-01T15:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(firstBooking.id)

    // Cancel the first booking
    const cancelled = await bookingRepo.cancel(firstBooking.id, {
      from: 'CONFIRMED',
      fee: 0,
      cancelledAt: new Date(),
    })
    expect(cancelled).toBeDefined()
    expect(cancelled!.status).toBe('CANCELLED')

    // Overlapping booking should now succeed — exclusion constraint
    // only applies to CONFIRMED/ACTIVE
    const secondBooking = await bookingRepo.create({
      renterId: testUser.id,
      vehicleId: testVehicle.id,
      startAt: new Date('2027-02-01T12:00:00Z'),
      endAt: new Date('2027-02-01T16:00:00Z'),
      effectiveEndAt: new Date('2027-02-01T17:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(secondBooking.id)

    expect(secondBooking.status).toBe('CONFIRMED')
    expect(secondBooking.vehicleId).toBe(testVehicle.id)
  })

  it('allows adjacent (non-overlapping) bookings on same vehicle', async () => {
    // First booking: 10:00-14:00, effectiveEnd 15:00 (buffer)
    const first = await bookingRepo.create({
      renterId: testUser.id,
      vehicleId: testVehicle.id,
      startAt: new Date('2027-04-01T10:00:00Z'),
      endAt: new Date('2027-04-01T14:00:00Z'),
      effectiveEndAt: new Date('2027-04-01T15:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(first.id)

    // Second booking starts exactly at first's effectiveEndAt (boundary)
    // tstzrange is [closed, open) so startAt === effectiveEndAt does NOT overlap
    const second = await bookingRepo.create({
      renterId: testUser.id,
      vehicleId: testVehicle.id,
      startAt: new Date('2027-04-01T15:00:00Z'),
      endAt: new Date('2027-04-01T19:00:00Z'),
      effectiveEndAt: new Date('2027-04-01T20:00:00Z'),
      status: 'CONFIRMED',
      source: 'DIRECT',
      externalId: null,
      notes: null,
    })
    createdBookingIds.push(second.id)

    expect(second.status).toBe('CONFIRMED')
    expect(second.startAt).toEqual(new Date('2027-04-01T15:00:00Z'))
  })

  it('concurrent overlapping bookings: exactly one succeeds', async () => {
    const input = {
      renterId: testUser.id,
      vehicleId: testVehicle.id,
      startAt: new Date('2027-06-01T10:00:00Z'),
      endAt: new Date('2027-06-01T14:00:00Z'),
      effectiveEndAt: new Date('2027-06-01T15:00:00Z'),
      status: 'CONFIRMED' as const,
      source: 'DIRECT' as const,
      externalId: null,
      notes: null,
    }

    const results = await Promise.allSettled([bookingRepo.create(input), bookingRepo.create(input)])

    const fulfilled = results.filter((r) => r.status === 'fulfilled')
    const rejected = results.filter((r) => r.status === 'rejected')

    expect(fulfilled).toHaveLength(1)
    expect(rejected).toHaveLength(1)

    // Clean up the one that succeeded
    const winner = (fulfilled[0] as PromiseFulfilledResult<{ id: string }>).value
    createdBookingIds.push(winner.id)
  })
})

describe('POST /bookings overlap via HTTP (real Postgres)', () => {
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

    httpVehicle = await httpVehicleRepo.create({
      name: 'HTTP Overlap Test Car',
      description: null,
      seats: 4,
      transmission: 'AUTO',
      fuelType: null,
      status: 'AVAILABLE',
      bufferMinutes: 60,
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      dailyRateJpy: 8000,
      hourlyRateJpy: null,
    })

    app = createApp({
      vehicleRepo: httpVehicleRepo,
      bookingRepo: httpBookingRepo,
      availabilityRepo: httpAvailabilityRepo,
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
    const bookingBody = {
      vehicleId: httpVehicle.id,
      startAt: '2027-03-01T10:00:00Z',
      endAt: '2027-03-01T14:00:00Z',
      source: 'DIRECT',
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
})
