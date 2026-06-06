import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { notificationLog, users } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { pgErrorCode } from '../../src/pg-errors'
import { DrizzleBookingRepository, DrizzleVehicleRepository } from '../../src/repositories/drizzle'
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

// §3 / §7: notification_log is the durable outbound-email ledger. This proves the
// DB-level invariants the dispatcher relies on: every row is sealed to a real
// booking + operator (FK 23503), and the (booking, kind) idempotency key is unique
// (23505) so a post-commit replay can never create a duplicate row to double-send.

const bookingRepo = new DrizzleBookingRepository(db)
const vehicleRepo = new DrizzleVehicleRepository(db)

let testUser: { id: string }
let testVehicle: Vehicle
let testClassId: string
let testLocationId: string
let testBookingId: string
const createdBookingIds: string[] = []
const createdVehicleIds: string[] = []
const createdClassIds: string[] = []
const createdLocationIds: string[] = []

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `notif-${Date.now()}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
    .returning()
  testUser = user

  const klass = await seedVehicleClass('notif')
  testClassId = klass.id
  createdClassIds.push(klass.id)

  const location = await seedLocation('notif', 120)
  testLocationId = location.id
  createdLocationIds.push(location.id)

  testVehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId: testClassId,
    name: 'Notif Test Car',
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
  createdVehicleIds.push(testVehicle.id)

  const booking = await bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      renterId: testUser.id,
      classId: testClassId,
      requestedVehicleId: testVehicle.id,
      assignedVehicleId: testVehicle.id,
      pickupLocationId: testLocationId,
      dropoffLocationId: testLocationId,
    }),
  )
  testBookingId = booking.id
  createdBookingIds.push(booking.id)
})

afterAll(async () => {
  await db.delete(notificationLog).where(eq(notificationLog.bookingId, testBookingId))
  await cleanupBookings(createdBookingIds)
  await cleanupVehicles(createdVehicleIds)
  await cleanupUsers([testUser.id])
  await cleanupVehicleClasses(createdClassIds)
  await cleanupLocations(createdLocationIds)
})

const row = (overrides: Record<string, unknown> = {}) => ({
  bookingId: testBookingId,
  operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
  kind: 'RENTER_BOOKING_CONFIRM' as const,
  recipient: 'renter@example.com',
  locale: 'en',
  idempotencyKey: `notify:${testBookingId}:RENTER_BOOKING_CONFIRM`,
  ...overrides,
})

describe('notification_log schema invariants', () => {
  it('inserts a QUEUED row by default and seals it to the booking + operator', async () => {
    const [inserted] = await db.insert(notificationLog).values(row()).returning()
    expect(inserted.status).toBe('QUEUED')
    expect(inserted.channel).toBe('EMAIL')
    expect(inserted.attempts).toBe(0)
    expect(inserted.bookingId).toBe(testBookingId)
  })

  it('rejects a duplicate idempotencyKey with 23505 (idempotency seal)', async () => {
    const dupe = row({ idempotencyKey: `notify:${testBookingId}:OPERATOR_BOOKING_ALERT` })
    await db.insert(notificationLog).values(dupe)
    const err = await db
      .insert(notificationLog)
      .values(dupe)
      .catch((e: unknown) => e)
    expect(pgErrorCode(err)).toBe('23505')
  })

  it('rejects a non-existent bookingId with FK violation 23503', async () => {
    const err = await db
      .insert(notificationLog)
      .values(row({ bookingId: 'missing-booking', idempotencyKey: 'notify:bad-booking:x' }))
      .catch((e: unknown) => e)
    expect(pgErrorCode(err)).toBe('23503')
  })

  it('rejects a non-existent operatorId with FK violation 23503', async () => {
    const err = await db
      .insert(notificationLog)
      .values(row({ operatorId: 'missing-operator', idempotencyKey: 'notify:bad-operator:x' }))
      .catch((e: unknown) => e)
    expect(pgErrorCode(err)).toBe('23503')
  })
})
