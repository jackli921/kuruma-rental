import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { users } from '@kuruma/shared/db/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { DrizzleBookingRepository, DrizzleVehicleRepository } from '../../src/repositories/drizzle'
import type { Booking, Vehicle } from '../../src/stores'
import {
  DEFAULT_DAILY_RATE_JPY,
  cleanupBookings,
  cleanupUsers,
  cleanupVehicleClasses,
  cleanupVehicles,
  db,
  seedVehicleClass,
} from './setup'

// Cast: test DB uses postgres-js, same query API as neon-http
const bookingRepo = new DrizzleBookingRepository(db as never)
const vehicleRepo = new DrizzleVehicleRepository(db as never)

let renterA: { id: string }
let renterB: { id: string }
let staff: { id: string }
let vehicle: Vehicle
let testClassId: string
const createdBookingIds: string[] = []
const createdVehicleIds: string[] = []
const createdUserIds: string[] = []
const createdClassIds: string[] = []

const ctxA: () => CallerContext = () => ({ userId: renterA.id, role: 'RENTER' })
const ctxB: () => CallerContext = () => ({ userId: renterB.id, role: 'RENTER' })
const ctxStaff: () => CallerContext = () => ({ userId: staff.id, role: 'STAFF' })

beforeAll(async () => {
  const [a] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `renter-a-${Date.now()}@test.com`,
      role: 'RENTER',
      language: 'en',
    })
    .returning()
  const [b] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `renter-b-${Date.now()}@test.com`,
      role: 'RENTER',
      language: 'en',
    })
    .returning()
  const [s] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `staff-${Date.now()}@test.com`,
      role: 'STAFF',
      language: 'en',
    })
    .returning()
  renterA = a
  renterB = b
  staff = s
  createdUserIds.push(a.id, b.id, s.id)

  const klass = await seedVehicleClass('rls')
  testClassId = klass.id
  createdClassIds.push(klass.id)

  vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId: testClassId,
    name: 'RLS Test Car',
    description: null,
    seats: 5,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    status: 'AVAILABLE',
    bufferMinutes: 60,
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
  })
  createdVehicleIds.push(vehicle.id)
})

afterAll(async () => {
  await cleanupBookings(createdBookingIds)
  await cleanupVehicles(createdVehicleIds)
  await cleanupUsers(createdUserIds)
  await cleanupVehicleClasses(createdClassIds)
})

function makeBookingData(renterId: string, startHour: number) {
  return {
    renterId,
    classId: testClassId,
    vehicleId: vehicle.id,
    startAt: new Date(`2026-08-01T${String(startHour).padStart(2, '0')}:00:00Z`),
    endAt: new Date(`2026-08-01T${String(startHour + 2).padStart(2, '0')}:00:00Z`),
    effectiveEndAt: new Date(`2026-08-01T${String(startHour + 3).padStart(2, '0')}:00:00Z`),
    status: 'CONFIRMED' as const,
    source: 'DIRECT' as const,
    externalId: null,
    notes: null,
    totalPrice: 5000,
    cancellationFee: null,
    cancelledAt: null,
    idempotencyKey: null,
  }
}

describe('CallerContext booking isolation', () => {
  let bookingA: Booking
  let bookingB: Booking

  beforeAll(async () => {
    // Staff context for creation (staff can create for any renter)
    bookingA = await bookingRepo.create(ctxStaff(), makeBookingData(renterA.id, 8))
    bookingB = await bookingRepo.create(ctxStaff(), makeBookingData(renterB.id, 14))
    createdBookingIds.push(bookingA.id, bookingB.id)
  })

  it('renterA.findAll only returns own bookings', async () => {
    const results = await bookingRepo.findAll(ctxA())
    const ids = results.map((b) => b.id)
    expect(ids).toContain(bookingA.id)
    expect(ids).not.toContain(bookingB.id)
  })

  it('renterB.findAll only returns own bookings', async () => {
    const results = await bookingRepo.findAll(ctxB())
    const ids = results.map((b) => b.id)
    expect(ids).toContain(bookingB.id)
    expect(ids).not.toContain(bookingA.id)
  })

  it('staff.findAll returns all bookings', async () => {
    const results = await bookingRepo.findAll(ctxStaff())
    const ids = results.map((b) => b.id)
    expect(ids).toContain(bookingA.id)
    expect(ids).toContain(bookingB.id)
  })

  it('renterA.findById for renterB booking returns undefined', async () => {
    const result = await bookingRepo.findById(ctxA(), bookingB.id)
    expect(result).toBeUndefined()
  })

  it('staff.findById for any booking returns it', async () => {
    const resultA = await bookingRepo.findById(ctxStaff(), bookingA.id)
    const resultB = await bookingRepo.findById(ctxStaff(), bookingB.id)
    expect(resultA?.id).toBe(bookingA.id)
    expect(resultB?.id).toBe(bookingB.id)
  })

  it('renterA.cancel on renterB booking returns undefined', async () => {
    const result = await bookingRepo.cancel(ctxA(), bookingB.id, {
      from: 'CONFIRMED',
      fee: 0,
      cancelledAt: new Date(),
    })
    expect(result).toBeUndefined()
    // Verify bookingB is unchanged
    const bookingBStill = await bookingRepo.findById(ctxStaff(), bookingB.id)
    expect(bookingBStill?.status).toBe('CONFIRMED')
  })
})
