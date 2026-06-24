import type { RunTx } from '@kuruma/shared/db'
import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { bookingEvents, bookings, classRatePlans, users } from '@kuruma/shared/db/schema'
import { and, eq, inArray } from 'drizzle-orm'
import { Hono } from 'hono'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleBookingRepository,
  DrizzleVehicleClassRepository,
  DrizzleVehicleRepository,
  createDrizzleTransaction,
} from '../../src/repositories/drizzle'
import { createBookingRoutes } from '../../src/routes/bookings'
import { BookingService } from '../../src/services/booking'
import { testAuthMiddleware } from '../helpers/auth'
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

// #464 slice 2d.5: pins that pg_advisory_xact_lock truly serializes concurrent
// CLASS_COMBO submits on the same (operator, class, pickup location) triple
// against REAL Postgres. The in-memory unit test
// (tests/routes/bookings.test.ts) proves the per-key Promise-chain mutex on
// the InMemory adapter — only this file proves the SQL primitive holds the
// same contract. With capacity=1, three concurrent POSTs ⇒ exactly one
// CONFIRMED + two CLASS_COMBO_SOLD_OUT. Without the lock all three would read
// demand=0 and each insert (CLASS_COMBO carries null assignedVehicleId, so
// the exclusion seal does NOT catch the oversell — the lock is the only thing
// keeping the class from being sold past its supply).
//
// N=3 (not 5 as in the in-memory route test) keeps every concurrent submit
// inside the shared postgres-js pool (max=4 in pg-test-client.ts), so any
// serialization observed is the advisory lock — not the pool queueing waiters.

const runTx: RunTx = (fn) => db.transaction(fn)
const runInTransaction = createDrizzleTransaction(runTx)

const bookingRepo = new DrizzleBookingRepository(db)
const vehicleRepo = new DrizzleVehicleRepository(db)
const vehicleClassRepo = new DrizzleVehicleClassRepository(db)

const service = new BookingService(
  bookingRepo,
  runInTransaction,
  vehicleRepo,
  undefined,
  vehicleClassRepo,
)

describe('CLASS_COMBO submit serialization (real pg, #464 slice 2d.5)', () => {
  let classId: string
  let locationId: string
  let vehicleId: string
  let ratePlanId: string
  let renterId: string
  let app: Hono

  // Far-future window so it can never collide with seeded demo bookings.
  const startAt = new Date('2027-09-01T09:00:00Z')
  const endAt = new Date('2027-09-02T09:00:00Z')
  const DAY_RATE_JPY = 7500

  beforeAll(async () => {
    const klass = await seedVehicleClass('combo-lock')
    classId = klass.id

    const location = await seedLocation('combo-lock')
    locationId = location.id

    // Capacity = 1: one road-legal car in (operator, class, location).
    const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      classId,
      pickupLocationId: locationId,
      name: 'Combo Lock Car',
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      luggageSize: null,
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
      dailyRateJpy: 6000,
      hourlyRateJpy: null,
      shakenExpiryDate: '2099-12-31',
      insuranceExpiryDate: '2099-12-31',
    })
    vehicleId = vehicle.id

    // The combo submit prices off the active rate plan for (op, class, loc).
    const [plan] = await db
      .insert(classRatePlans)
      .values({
        operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
        classId,
        pickupLocationId: locationId,
        dayRateJpy: DAY_RATE_JPY,
        isActive: true,
        label: null,
      })
      .returning({ id: classRatePlans.id })
    if (!plan) throw new Error('Failed to seed class rate plan')
    ratePlanId = plan.id

    // The booking's renterId FK-references users — seed one.
    renterId = crypto.randomUUID()
    await db.insert(users).values({
      id: renterId,
      email: `combo-lock-${renterId.slice(0, 8)}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })

    // PLATFORM_ADMIN skips the renter disclaimer gate; the route uses
    // ctx.userId as the booking renterId when no override is passed.
    app = new Hono()
    app.use('*', testAuthMiddleware(renterId, 'PLATFORM_ADMIN'))
    app.route('/', createBookingRoutes(service))
  })

  afterAll(async () => {
    // Combo bookings carry no assignedVehicleId, so scope cleanup to the
    // (operator, class, location) triple instead of the vehicle cleanup chain.
    const created = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.operatorId, BEST_CAR_RENTAL_OPERATOR_ID),
          eq(bookings.classId, classId),
          eq(bookings.pickupLocationId, locationId),
        ),
      )
    const ids = created.map((row) => row.id)
    if (ids.length > 0) {
      await db.delete(bookingEvents).where(inArray(bookingEvents.bookingId, ids))
      await cleanupBookings(ids)
    }
    await db.delete(classRatePlans).where(eq(classRatePlans.id, ratePlanId))
    await cleanupVehicles([vehicleId])
    await cleanupUsers([renterId])
    await cleanupVehicleClasses([classId])
    await cleanupLocations([locationId])
  })

  it('serializes parallel CLASS_COMBO POSTs so at most cars-on-hand 201, the rest 409 SOLD_OUT', async () => {
    const body = {
      fulfillmentMode: 'CLASS_COMBO' as const,
      classId,
      pickupLocationId: locationId,
      dropoffLocationId: locationId,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      source: 'DIRECT' as const,
    }

    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        app.request('/bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }),
      ),
    )

    const statuses = responses.map((r) => r.status).sort()
    expect(statuses).toEqual([201, 409, 409])

    const failed = responses.filter((r) => r.status === 409)
    const codes = await Promise.all(
      failed.map(async (r) => ((await r.json()) as { code?: string }).code),
    )
    expect(codes).toEqual(['CLASS_COMBO_SOLD_OUT', 'CLASS_COMBO_SOLD_OUT'])

    // Exactly one CONFIRMED row landed on (operator, class, location) — the
    // floating combo (assignedVehicleId IS NULL), priced off the rate plan.
    const persisted = await db
      .select()
      .from(bookings)
      .where(
        and(
          eq(bookings.operatorId, BEST_CAR_RENTAL_OPERATOR_ID),
          eq(bookings.classId, classId),
          eq(bookings.pickupLocationId, locationId),
        ),
      )
    expect(persisted).toHaveLength(1)
    expect(persisted[0]?.status).toBe('CONFIRMED')
    expect(persisted[0]?.assignedVehicleId).toBeNull()
    expect(persisted[0]?.fulfillmentMode).toBe('CLASS_COMBO')
    expect(persisted[0]?.totalPrice).toBe(DAY_RATE_JPY) // 1 day × dayRateJpy
  })

  // #464 (fix(#464) follow-up): the SPECIFIC path is class-capacity guarded too —
  // a CLASS_COMBO float carries null assignedVehicleId, invisible to the per-car
  // exclusion constraint, so without the SPECIFIC-path advisory lock + demand/
  // capacity gate a float and a SPECIFIC booking would both read demand=0 and
  // oversell the single car. A distinct window (Oct) keeps the first test's Sept
  // booking out of this demand count.
  it('serializes a CLASS_COMBO float against a concurrent SPECIFIC booking — exactly one wins the last unit', async () => {
    const raceStart = new Date('2027-10-01T09:00:00Z')
    const raceEnd = new Date('2027-10-02T09:00:00Z')
    const post = (body: object) =>
      app.request('/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

    const [combo, specific] = await Promise.all([
      post({
        fulfillmentMode: 'CLASS_COMBO',
        classId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        startAt: raceStart.toISOString(),
        endAt: raceEnd.toISOString(),
        source: 'DIRECT',
      }),
      post({
        fulfillmentMode: 'SPECIFIC',
        requestedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        startAt: raceStart.toISOString(),
        endAt: raceEnd.toISOString(),
        source: 'DIRECT',
      }),
    ])

    // Exactly one wins the single class unit; the loser is sold out (without the
    // SPECIFIC-path guard both would 201 → overbook).
    expect([combo.status, specific.status].sort()).toEqual([201, 409])
    const loser = combo.status === 409 ? combo : specific
    expect(((await loser.json()) as { code?: string }).code).toBe('CLASS_COMBO_SOLD_OUT')

    // Exactly one booking landed in the race window (no oversell).
    const persisted = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(
        and(
          eq(bookings.operatorId, BEST_CAR_RENTAL_OPERATOR_ID),
          eq(bookings.classId, classId),
          eq(bookings.pickupLocationId, locationId),
          eq(bookings.startAt, raceStart),
        ),
      )
    expect(persisted).toHaveLength(1)
  })
})
