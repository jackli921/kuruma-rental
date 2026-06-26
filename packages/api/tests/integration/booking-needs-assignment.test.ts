import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { users } from '@kuruma/shared/db/schema'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { DrizzleBookingRepository } from '../../src/repositories/drizzle'
import { bookingInput } from '../helpers/booking'
import {
  cleanupBookings,
  cleanupLocations,
  cleanupUsers,
  cleanupVehicleClasses,
  db,
  seedLocation,
  seedVehicleClass,
} from './setup'

// Real-pg parity test for the needsAssignment filter (#464 Task 7).
// Proves the Drizzle WHERE clause matches the in-memory predicate:
//   fulfillmentMode='CLASS_COMBO' AND assignedVehicleId IS NULL AND status IN ('CONFIRMED','ACTIVE')

const bookingRepo = new DrizzleBookingRepository(db)

let testUserId: string
let testClassId: string
let testLocationId: string

const createdBookingIds: string[] = []
const createdClassIds: string[] = []
const createdLocationIds: string[] = []

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `needs-assign-${Date.now()}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
    .returning()
  testUserId = user.id

  const klass = await seedVehicleClass('needs-assign')
  testClassId = klass.id
  createdClassIds.push(klass.id)

  const location = await seedLocation('needs-assign')
  testLocationId = location.id
  createdLocationIds.push(location.id)
})

afterEach(async () => {
  await cleanupBookings(createdBookingIds)
  createdBookingIds.length = 0
})

afterAll(async () => {
  await cleanupUsers([testUserId])
  await cleanupVehicleClasses(createdClassIds)
  await cleanupLocations(createdLocationIds)
})

// Seed a CLASS_COMBO float (no vehicle assigned) directly via the repo.
function seedFloat(status: 'CONFIRMED' | 'ACTIVE' | 'CANCELLED', offsetDays: number) {
  const base = new Date(`2028-12-${String(offsetDays).padStart(2, '0')}T09:00:00Z`)
  const end = new Date(base)
  end.setUTCHours(17)
  return bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      renterId: testUserId,
      classId: testClassId,
      requestedVehicleId: null,
      assignedVehicleId: null,
      pickupLocationId: testLocationId,
      dropoffLocationId: testLocationId,
      fulfillmentMode: 'CLASS_COMBO',
      status,
      startAt: base,
      endAt: end,
      effectiveEndAt: end,
      totalPrice: null,
    }),
  )
}

describe('DrizzleBookingRepository — needsAssignment filter (#464 Task 7)', () => {
  it('includes CONFIRMED and ACTIVE CLASS_COMBO floats, excludes CANCELLED', async () => {
    const floatConfirmed = await seedFloat('CONFIRMED', 1)
    createdBookingIds.push(floatConfirmed.id)

    const floatActive = await seedFloat('ACTIVE', 2)
    createdBookingIds.push(floatActive.id)

    const floatCancelled = await seedFloat('CANCELLED', 3)
    createdBookingIds.push(floatCancelled.id)

    const results = await bookingRepo.findAll(SYSTEM_CONTEXT, { needsAssignment: true })
    const resultIds = results.map((b) => b.id)

    expect(resultIds).toContain(floatConfirmed.id)
    expect(resultIds).toContain(floatActive.id)
    expect(resultIds).not.toContain(floatCancelled.id)

    // Every returned booking satisfies the full predicate
    for (const booking of results) {
      if (createdBookingIds.includes(booking.id)) {
        expect(booking.fulfillmentMode).toBe('CLASS_COMBO')
        expect(booking.assignedVehicleId).toBeNull()
        expect(['CONFIRMED', 'ACTIVE']).toContain(booking.status)
      }
    }
  })

  it('returns exact set: only the two eligible floats when no other eligible rows exist', async () => {
    const floatConfirmed = await seedFloat('CONFIRMED', 10)
    createdBookingIds.push(floatConfirmed.id)

    const floatCancelled = await seedFloat('CANCELLED', 11)
    createdBookingIds.push(floatCancelled.id)

    const results = await bookingRepo.findAll(SYSTEM_CONTEXT, { needsAssignment: true })

    // floatConfirmed must appear; floatCancelled must not
    const resultIds = results.map((b) => b.id)
    expect(resultIds).toContain(floatConfirmed.id)
    expect(resultIds).not.toContain(floatCancelled.id)
  })
})
