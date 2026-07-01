import type { RunTx } from '@kuruma/shared/db'
import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { bookingEvents, users, vehicleBlocks } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleBookingRepository,
  DrizzleVehicleBlockRepository,
  DrizzleVehicleClassRepository,
  DrizzleVehicleRepository,
  createDrizzleTransaction,
} from '../../src/repositories/drizzle'
import { BookingService } from '../../src/services/booking'
import { VehicleBlockService } from '../../src/services/vehicle-block'
import {
  cleanupBookings,
  cleanupLocations,
  cleanupUsers,
  cleanupVehicleClasses,
  cleanupVehicles,
  db,
  seedLocation,
  seedVehicleClass,
} from './setup'

// #1101 slice 3: the booking-vs-block guard over REAL Postgres — proves the
// tx-bound DrizzleVehicleBlockRepository.findOverlapping (rebound in
// createDrizzleTransaction) runs INSIDE the booking transaction and rejects a
// SPECIFIC create that lands on a scheduled block. The in-memory service test
// (tests/services/booking.test.ts) proves the same guard logic on the InMemory
// adapter; only this file proves the SQL findOverlapping holds the contract.

const runTx: RunTx = (fn) => db.transaction(fn)
const runInTransaction = createDrizzleTransaction(runTx)

const bookingRepo = new DrizzleBookingRepository(db)
const vehicleRepo = new DrizzleVehicleRepository(db)
const vehicleClassRepo = new DrizzleVehicleClassRepository(db)
const blockRepo = new DrizzleVehicleBlockRepository(db)

const service = new BookingService(
  bookingRepo,
  runInTransaction,
  vehicleRepo,
  undefined,
  vehicleClassRepo,
)

// #1196: the reverse guard runs the Drizzle findActiveOverlappingForVehicle SQL
// against real pg — proving the tstzrange overlap matches the in-memory adapter.
const vehicleBlockService = new VehicleBlockService(vehicleRepo, blockRepo, bookingRepo)
const opCtx: CallerContext = {
  userId: 'op-user',
  role: 'OPERATOR_OWNER',
  operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
}

// 60-minute turnaround so effectiveEndAt = endAt + 1h, giving a small tail the
// block guard must also defend (must-fix #1).
const TURNAROUND_MIN = 60
// Far-future so it can never collide with seeded demo bookings; road-legal.
const startAt = new Date('2027-10-01T09:00:00Z')
const endAt = new Date('2027-10-02T09:00:00Z')
// effectiveEndAt = 2027-10-02T10:00:00Z

let classId: string
let locationId: string
let renterId: string
const createdVehicleIds: string[] = []
const createdBookingIds: string[] = []
const createdBlockIds: string[] = []

async function seedRenter(): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(users).values({
    id,
    email: `block-${id.slice(0, 8)}@kuruma-test.com`,
    role: 'RENTER',
    language: 'en',
  })
  return id
}

async function seedVehicle(name: string): Promise<string> {
  const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId,
    pickupLocationId: locationId,
    name,
    description: null,
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    dailyRateJpy: 6000,
    shakenExpiryDate: '2099-06-15',
    insuranceExpiryDate: '2099-01-01',
  })
  createdVehicleIds.push(vehicle.id)
  return vehicle.id
}

async function scheduleBlock(vehicleId: string, blockStart: Date, blockEnd: Date): Promise<void> {
  const block = await blockRepo.create({
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    vehicleId,
    startAt: blockStart,
    endAt: blockEnd,
    kind: 'MAINTENANCE',
    reason: 'scheduled service',
    notes: null,
    createdBy: 'op-user',
  })
  createdBlockIds.push(block.id)
}

function bookVehicle(vehicleId: string) {
  const ctx: CallerContext = { userId: renterId, role: 'RENTER', bypassScope: false }
  return service.create(ctx, {
    fulfillmentMode: 'SPECIFIC',
    requestedVehicleId: vehicleId,
    pickupLocationId: locationId,
    dropoffLocationId: locationId,
    renterId,
    startAt,
    endAt,
    source: 'DIRECT',
    addOnIds: [],
  })
}

beforeAll(async () => {
  const klass = await seedVehicleClass('vblock')
  classId = klass.id
  const location = await seedLocation('vblock', TURNAROUND_MIN)
  locationId = location.id
  renterId = await seedRenter()
})

afterAll(async () => {
  if (createdBookingIds.length > 0) {
    await db.delete(bookingEvents).where(inArray(bookingEvents.bookingId, createdBookingIds))
    await cleanupBookings(createdBookingIds)
  }
  if (createdBlockIds.length > 0) {
    await db.delete(vehicleBlocks).where(inArray(vehicleBlocks.id, createdBlockIds))
  }
  await cleanupVehicles(createdVehicleIds)
  await cleanupVehicleClasses([classId])
  await cleanupLocations([locationId])
  await cleanupUsers([renterId])
})

describe('booking-vs-block guard (real pg, #1101)', () => {
  it('rejects a SPECIFIC booking overlapping a block on the rental window (409 VEHICLE_BLOCKED)', async () => {
    const vehicleId = await seedVehicle('Block Booking Car 1')
    await scheduleBlock(
      vehicleId,
      new Date('2027-10-01T12:00:00Z'),
      new Date('2027-10-01T18:00:00Z'),
    )

    const res = await bookVehicle(vehicleId)

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(409)
      expect(res.code).toBe('VEHICLE_BLOCKED')
    }
  })

  it('rejects when the block overlaps only the dropoff turnaround tail', async () => {
    const vehicleId = await seedVehicle('Block Booking Car 2')
    // 09:30–09:45 sits between endAt (09:00) and effectiveEndAt (10:00).
    await scheduleBlock(
      vehicleId,
      new Date('2027-10-02T09:30:00Z'),
      new Date('2027-10-02T09:45:00Z'),
    )

    const res = await bookVehicle(vehicleId)

    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.status).toBe(409)
      expect(res.code).toBe('VEHICLE_BLOCKED')
    }
  })

  it('allows a SPECIFIC booking when the block sits entirely after the turnaround window', async () => {
    const vehicleId = await seedVehicle('Block Booking Car 3')
    await scheduleBlock(
      vehicleId,
      new Date('2027-10-03T00:00:00Z'),
      new Date('2027-10-03T06:00:00Z'),
    )

    const res = await bookVehicle(vehicleId)

    expect(res.ok).toBe(true)
    if (res.ok) createdBookingIds.push(res.booking.id)
  })
})

describe('block-vs-booking guard (real pg, #1196)', () => {
  it('rejects a block scheduled over a CONFIRMED booking on the rental window (409 BLOCK_BOOKING_CONFLICT)', async () => {
    const vehicleId = await seedVehicle('Block Over Booking Car 1')
    const booked = await bookVehicle(vehicleId)
    expect(booked.ok).toBe(true)
    if (booked.ok) createdBookingIds.push(booked.booking.id)

    const res = await vehicleBlockService.createBlock(opCtx, vehicleId, {
      kind: 'MAINTENANCE',
      reason: 'in-shop',
      startAt: '2027-10-01T12:00:00.000Z',
      endAt: '2027-10-01T18:00:00.000Z',
    })

    expect(res).toMatchObject({ ok: false, status: 409, code: 'BLOCK_BOOKING_CONFLICT' })
  })

  it('rejects a block that overlaps only the booking dropoff turnaround tail', async () => {
    const vehicleId = await seedVehicle('Block Over Booking Car 2')
    const booked = await bookVehicle(vehicleId)
    expect(booked.ok).toBe(true)
    if (booked.ok) createdBookingIds.push(booked.booking.id)

    // endAt 09:00, effectiveEndAt 10:00 (60-min turnaround); 09:30–09:45 is the tail.
    const res = await vehicleBlockService.createBlock(opCtx, vehicleId, {
      kind: 'MAINTENANCE',
      reason: 'tail',
      startAt: '2027-10-02T09:30:00.000Z',
      endAt: '2027-10-02T09:45:00.000Z',
    })

    expect(res).toMatchObject({ ok: false, status: 409, code: 'BLOCK_BOOKING_CONFLICT' })
  })

  it('allows a block entirely after the booking turnaround window', async () => {
    const vehicleId = await seedVehicle('Block Over Booking Car 3')
    const booked = await bookVehicle(vehicleId)
    expect(booked.ok).toBe(true)
    if (booked.ok) createdBookingIds.push(booked.booking.id)

    const res = await vehicleBlockService.createBlock(opCtx, vehicleId, {
      kind: 'MAINTENANCE',
      reason: 'later',
      startAt: '2027-10-05T00:00:00.000Z',
      endAt: '2027-10-05T06:00:00.000Z',
    })

    expect(res.ok).toBe(true)
    if (res.ok) createdBlockIds.push(res.block.id)
  })

  it('allows a block whose start touches the booking effectiveEndAt exactly (half-open [), no overlap)', async () => {
    const vehicleId = await seedVehicle('Block Over Booking Car 4')
    const booked = await bookVehicle(vehicleId)
    expect(booked.ok).toBe(true)
    if (booked.ok) createdBookingIds.push(booked.booking.id)

    // Booking endAt 09:00 + 60-min turnaround => effectiveEndAt 2027-10-02T10:00:00Z.
    // A block starting at that exact instant shares only the closed-open boundary, so
    // under `tstzrange [)` bounds the ranges do NOT overlap. Pins the boundary on real
    // pg (the in-memory unit test covers it; #1232) so a switch to inclusive `[]` bounds
    // would fail the e2e-real-db job, not slip through.
    const res = await vehicleBlockService.createBlock(opCtx, vehicleId, {
      kind: 'MAINTENANCE',
      reason: 'adjacent',
      startAt: '2027-10-02T10:00:00.000Z',
      endAt: '2027-10-02T16:00:00.000Z',
    })

    expect(res.ok).toBe(true)
    if (res.ok) createdBlockIds.push(res.block.id)
  })
})
