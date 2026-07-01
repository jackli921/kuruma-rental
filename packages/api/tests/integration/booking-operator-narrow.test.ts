import { bookings, operators, users, vehicleClasses, vehicles } from '@kuruma/shared/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import { DrizzleBookingRepository, DrizzleVehicleRepository } from '../../src/repositories/drizzle'
import { bookingInput } from '../helpers/booking'
import {
  DEFAULT_DAILY_RATE_JPY,
  cleanupLocations,
  db,
  seedLocation,
  seedVehicleClass,
} from './setup'

// #1230 slice 5a: the picker admin's operator narrowing, proven against real
// Postgres at the repo layer. A bypass admin (bookingReadScope `all`) may narrow
// the cross-operator list to one operator via BookingFilters.operatorId; the gate
// applies that id ONLY for an `all` scope, so a tenant operator passing a foreign
// id stays clamped to its own tenant and can never widen (the H2 invariant).
describe('booking findAll operator narrowing (#1230 slice 5a, Drizzle, real Postgres)', () => {
  const bookingRepo = new DrizzleBookingRepository(db)
  const vehicleRepo = new DrizzleVehicleRepository(db)
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const opAId = `op_narrow_a_${uniq}`
  const opBId = `op_narrow_b_${uniq}`
  const renterId = crypto.randomUUID()
  const createdLocationIds: string[] = []
  let bookingAId: string
  let bookingBId: string

  const admin: CallerContext = { userId: 'admin', role: 'PLATFORM_ADMIN', bypassScope: true }
  const ctxFor = (operatorId: string): CallerContext => ({
    userId: 'owner',
    role: 'OPERATOR_OWNER',
    operatorId,
    bypassScope: false,
  })

  // One operator with its own class, location, vehicle and a single booking. The
  // day differs per operator so the two bookings' exclusion windows never collide.
  async function seedOperatorBooking(opId: string, suffix: string, day: string): Promise<string> {
    const klass = await seedVehicleClass(`narrow-${suffix}`, opId)
    const location = await seedLocation(`narrow-${suffix}`, 2880, opId)
    createdLocationIds.push(location.id)
    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: opId,
      classId: klass.id,
      name: `Narrow Car ${suffix}`,
      description: null,
      photos: [],
      seats: 5,
      transmission: 'AUTO',
      fuelType: null,
      licensePlate: null,
      status: 'AVAILABLE',
      minRentalHours: null,
      maxRentalHours: null,
      advanceBookingHours: null,
      make: null,
      model: null,
      year: null,
      color: null,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      hourlyRateJpy: null,
      shakenExpiryDate: null,
      insuranceExpiryDate: null,
    })
    const booking = await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: opId,
        renterId,
        classId: klass.id,
        requestedVehicleId: vehicle.id,
        assignedVehicleId: vehicle.id,
        pickupLocationId: location.id,
        dropoffLocationId: location.id,
        startAt: new Date(`${day}T10:00:00Z`),
        endAt: new Date(`${day}T14:00:00Z`),
        effectiveEndAt: new Date(`${day}T14:00:00Z`),
        status: 'CONFIRMED',
        source: 'DIRECT',
      }),
    )
    return booking.id
  }

  beforeAll(async () => {
    await db.insert(operators).values([
      { id: opAId, slug: `narrow-a-${uniq}`, name: 'Narrow Operator A' },
      { id: opBId, slug: `narrow-b-${uniq}`, name: 'Narrow Operator B' },
    ])
    await db.insert(users).values({
      id: renterId,
      email: `narrow-${uniq}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
    bookingAId = await seedOperatorBooking(opAId, 'a', '2027-10-01')
    bookingBId = await seedOperatorBooking(opBId, 'b', '2027-10-02')
  })

  afterAll(async () => {
    await db.delete(bookings).where(inArray(bookings.operatorId, [opAId, opBId]))
    await db.delete(vehicles).where(inArray(vehicles.operatorId, [opAId, opBId]))
    await db.delete(vehicleClasses).where(inArray(vehicleClasses.operatorId, [opAId, opBId]))
    await cleanupLocations(createdLocationIds)
    await db.delete(users).where(eq(users.id, renterId))
    await db.delete(operators).where(inArray(operators.id, [opAId, opBId]))
  })

  it('an all-scope admin sees both operators without a narrow (control)', async () => {
    const ids = (await bookingRepo.findAll(admin)).map((b) => b.id)
    expect(ids).toContain(bookingAId)
    expect(ids).toContain(bookingBId)
  })

  it('an all-scope admin narrows to just the requested operator', async () => {
    const ids = (await bookingRepo.findAll(admin, { operatorId: opAId })).map((b) => b.id)
    expect(ids).toContain(bookingAId)
    expect(ids).not.toContain(bookingBId)
  })

  it('a tenant operator cannot widen via a foreign operatorId (repo gate drops it, H2)', async () => {
    // op-B passes a foreign op-A id; the gate applies operatorId ONLY for an all
    // scope, so op-B stays clamped to its own tenant and never sees op-A's booking.
    const ids = (await bookingRepo.findAll(ctxFor(opBId), { operatorId: opAId })).map((b) => b.id)
    expect(ids).toContain(bookingBId)
    expect(ids).not.toContain(bookingAId)
  })
})
