import type { RunTx } from '@kuruma/shared/db'
import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { bookingEvents, users } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleBookingRepository,
  DrizzleVehicleClassRepository,
  DrizzleVehicleRepository,
  createDrizzleTransaction,
} from '../../src/repositories/drizzle'
import { BookingService } from '../../src/services/booking'
import { bookingInput } from '../helpers/booking'
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

// #464 assign-vehicle exclusion: proves the Postgres bookings_no_overlap
// exclusion constraint (23P01) is the mechanism behind
// BookingService.assignVehicle's 409 VEHICLE_UNAVAILABLE — not a service
// guard. Two scenarios:
//
//  (1) Busy-car direct: a car already holds a SPECIFIC CONFIRMED booking on
//      an overlapping window; assigning it to a CLASS_COMBO float on the same
//      window fires 23P01 → 409.
//
//  (2) Sequential collision: two CLASS_COMBO floats share a window; first
//      assign succeeds, second assign of the SAME car → 23P01 → 409.
//
// Every guard that fires BEFORE the exclusion (operator, location, class
// ACRISS, status, road-legal) must pass for the busy car so the constraint
// is provably the last line of defence. Fixture invariants (annotated below)
// ensure this.

const runTx: RunTx = (fn) => db.transaction(fn)
const runInTransaction = createDrizzleTransaction(runTx)

const bookingRepo = new DrizzleBookingRepository(db)
const vehicleRepo = new DrizzleVehicleRepository(db)
const vehicleClassRepo = new DrizzleVehicleClassRepository(db)

// No postCommit wiring needed — the 409 path never reaches event dispatch,
// and the success path only needs bookingEventRepo (wired via runInTransaction).
const service = new BookingService(
  bookingRepo,
  runInTransaction,
  vehicleRepo,
  undefined,
  vehicleClassRepo,
)

const ROAD_LEGAL = '2099-12-31'

async function seedRenter(prefix: string): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(users).values({
    id,
    email: `${prefix}-${id.slice(0, 8)}@kuruma-test.com`,
    role: 'RENTER',
    language: 'en',
  })
  return id
}

async function seedOperatorUser(prefix: string): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(users).values({
    id,
    email: `${prefix}-${id.slice(0, 8)}@kuruma-test.com`,
    role: 'OPERATOR_OWNER',
    language: 'ja',
  })
  return id
}

async function seedVehicle(classId: string, locationId: string, name: string): Promise<string> {
  const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId,
    // Guard: pickupLocationId must match the float's pickupLocationId.
    // Both cars seed with the same locationId -> location guard passes.
    pickupLocationId: locationId,
    name,
    description: null,
    photos: [],
    seats: 5,
    luggageCapacity: 2,
    luggageSize: null,
    transmission: 'AUTO',
    fuelType: null,
    licensePlate: null,
    // Guard: status must be AVAILABLE -> passes.
    status: 'AVAILABLE',
    minRentalHours: null,
    maxRentalHours: null,
    advanceBookingHours: null,
    make: null,
    model: null,
    year: null,
    color: null,
    dailyRateJpy: 6000,
    hourlyRateJpy: null,
    // Guard: isRoadLegal(car, booking.endAt) -> passes (far-future expiry).
    shakenExpiryDate: ROAD_LEGAL,
    insuranceExpiryDate: ROAD_LEGAL,
  })
  return vehicle.id
}

describe('assignVehicle exclusion constraint (real pg, #464)', () => {
  let classId: string
  let locationId: string
  let renterId: string
  // operatorUserId is stored as actorId in booking_events (FK to users.id).
  // Must be a real user row so the success path in test 2 doesn't 23503.
  let operatorUserId: string
  let busyCarId: string
  let freeCarId: string
  let float1Id: string
  let blockingBookingId: string
  let floatAId: string
  let floatBId: string

  // Test 1 window: far-future, distinct from seeded demo bookings and test 2.
  const t1Start = new Date('2028-06-01T09:00:00Z')
  const t1End = new Date('2028-06-03T09:00:00Z')

  // Test 2 window: different month to isolate demand counts from test 1.
  const t2Start = new Date('2028-07-01T09:00:00Z')
  const t2End = new Date('2028-07-03T09:00:00Z')

  beforeAll(async () => {
    // Guard: sameAcrissClass() requires both the float's class and the car's
    // class to share the same non-null ACRISS code. Using ONE class for all
    // fixtures makes both sides the same DB row -> trivially passes. 'CDAR'
    // is an arbitrary valid code (^[A-Z]{4}$).
    const klass = await seedVehicleClass('assign-excl', BEST_CAR_RENTAL_OPERATOR_ID, 'CDAR')
    classId = klass.id
    const location = await seedLocation('assign-excl')
    locationId = location.id
    renterId = await seedRenter('assign-excl')
    operatorUserId = await seedOperatorUser('assign-excl-op')

    busyCarId = await seedVehicle(classId, locationId, 'Busy Car assign-excl')
    freeCarId = await seedVehicle(classId, locationId, 'Free Car assign-excl')

    // Test 1 precondition: SPECIFIC CONFIRMED booking occupying busyCar on t1.
    // The INSERT trigger sets effectiveEndAt = t1End + location turnaround (2880 min).
    // The exclusion constraint keys on (assignedVehicleId, [startAt, effectiveEndAt)).
    const blocking = await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
        renterId,
        classId,
        requestedVehicleId: busyCarId,
        assignedVehicleId: busyCarId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        startAt: t1Start,
        endAt: t1End,
        status: 'CONFIRMED',
        fulfillmentMode: 'SPECIFIC',
        totalPrice: 12000,
      }),
    )
    blockingBookingId = blocking.id

    // Test 1 float: CLASS_COMBO on the SAME window as the blocking booking.
    // assignedVehicleId=null -> the exclusion constraint skips NULLs so this
    // INSERT succeeds. When assignVehicle tries to SET assignedVehicleId=busyCar,
    // the UPDATE triggers the exclusion and raises 23P01.
    const float1 = await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
        renterId,
        classId,
        requestedVehicleId: null,
        assignedVehicleId: null,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        startAt: t1Start,
        endAt: t1End,
        status: 'CONFIRMED',
        fulfillmentMode: 'CLASS_COMBO',
        totalPrice: 6000,
      }),
    )
    float1Id = float1.id

    // Test 2 precondition: two CLASS_COMBO floats on the same window (t2).
    // Both start with null assignedVehicleId. Assigning the same car to both
    // will collide on the exclusion after the first assignment succeeds.
    const floatA = await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
        renterId,
        classId,
        requestedVehicleId: null,
        assignedVehicleId: null,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        startAt: t2Start,
        endAt: t2End,
        status: 'CONFIRMED',
        fulfillmentMode: 'CLASS_COMBO',
        totalPrice: 6000,
      }),
    )
    floatAId = floatA.id

    const floatB = await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
        renterId,
        classId,
        requestedVehicleId: null,
        assignedVehicleId: null,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        startAt: t2Start,
        endAt: t2End,
        status: 'CONFIRMED',
        fulfillmentMode: 'CLASS_COMBO',
        totalPrice: 6000,
      }),
    )
    floatBId = floatB.id
  })

  afterAll(async () => {
    const allBookingIds = [float1Id, blockingBookingId, floatAId, floatBId].filter(
      (id): id is string => !!id,
    )
    if (allBookingIds.length > 0) {
      await db.delete(bookingEvents).where(inArray(bookingEvents.bookingId, allBookingIds))
      await cleanupBookings(allBookingIds)
    }
    // cleanupVehicles cascades: first deletes bookings by assignedVehicleId
    // (none left after cleanupBookings), then deletes the vehicle rows.
    const vehicleIds = [busyCarId, freeCarId].filter((id): id is string => !!id)
    if (vehicleIds.length > 0) await cleanupVehicles(vehicleIds)
    const userIds = [renterId, operatorUserId].filter((id): id is string => !!id)
    if (userIds.length > 0) await cleanupUsers(userIds)
    if (classId) await cleanupVehicleClasses([classId])
    if (locationId) await cleanupLocations([locationId])
  })

  it('rejects assigning a car already booked on the overlapping window (23P01 → 409)', async () => {
    // busyCar passes every pre-exclusion guard:
    //   ✓ operatorId = BEST_CAR_RENTAL_OPERATOR_ID (same as float)
    //   ✓ status = AVAILABLE
    //   ✓ pickupLocationId = locationId (same as float)
    //   ✓ sameAcrissClass: same classId → same non-null ACRISS code
    //   ✓ isRoadLegal: shakenExpiryDate / insuranceExpiryDate = 2099-12-31 > endAt
    // The exclusion constraint fires on the UPDATE in reassignVehicle.
    const ctx: CallerContext = {
      userId: operatorUserId,
      role: 'OPERATOR_OWNER',
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      bypassScope: false,
    }
    const res = await service.assignVehicle(ctx, float1Id, busyCarId, null)
    expect(res).toMatchObject({ ok: false, status: 409, code: 'VEHICLE_UNAVAILABLE' })
  })

  it('assigns a free car, then a second float assigning the same car on overlap is now blocked', async () => {
    const ctx: CallerContext = {
      userId: operatorUserId,
      role: 'OPERATOR_OWNER',
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      bypassScope: false,
    }
    // First assign: floatA → freeCar. No prior booking on freeCar → succeeds.
    const first = await service.assignVehicle(ctx, floatAId, freeCarId, null)
    expect(first).toMatchObject({ ok: true })

    // Second assign: floatB → freeCar (same car, same overlapping window).
    // floatA now occupies freeCar on [t2Start, t2End+turnaround), so
    // the UPDATE on floatB triggers 23P01 → 409 VEHICLE_UNAVAILABLE.
    const second = await service.assignVehicle(ctx, floatBId, freeCarId, null)
    expect(second).toMatchObject({ ok: false, status: 409, code: 'VEHICLE_UNAVAILABLE' })
  })
})
