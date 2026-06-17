import type { RunTx } from '@kuruma/shared/db'
import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import {
  addOnOptions,
  bookingEvents,
  insuranceOptions,
  users,
  vehicleClasses,
} from '@kuruma/shared/db/schema'
import { calculateCancellationFee } from '@kuruma/shared/lib/cancellation-policy'
import { calculateBookingPrice } from '@kuruma/shared/lib/pricing'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type CallerContext, SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleAddOnRepository,
  DrizzleBookingRepository,
  DrizzleInsuranceOptionRepository,
  DrizzleUserRepository,
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

// These tests exercise the BookingService's create / substitute / cancel paths
// over REAL Postgres — the one surface the in-memory unit tests cannot prove:
// the exclusion constraint firing on a reassign, a service-COMPUTED total
// landing in the column (vs a hardcoded literal), and the cancellation fee
// round-tripping through Drizzle. Slice 1 of #652.
//
// The service needs an interactive transaction. Production runs it via
// neon-serverless `runTx`; here we bridge the postgres-js test client's
// `.transaction()` into the same RunInTransaction bundle (mirrors
// e2e/real-db/real-api-server.ts).
const runTx: RunTx = (fn) => db.transaction(fn)
const runInTransaction = createDrizzleTransaction(runTx)

const bookingRepo = new DrizzleBookingRepository(db)
const vehicleRepo = new DrizzleVehicleRepository(db)
const vehicleClassRepo = new DrizzleVehicleClassRepository(db)
const insuranceRepo = new DrizzleInsuranceOptionRepository(db)
const addOnRepo = new DrizzleAddOnRepository(db)

const service = new BookingService(
  bookingRepo,
  runInTransaction,
  vehicleRepo,
  undefined,
  vehicleClassRepo,
)

function operatorCtx(): CallerContext {
  return {
    userId: 'op-substitute',
    role: 'OPERATOR_OWNER',
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    bypassScope: false,
  }
}

// create/substitute/cancel append booking_events that FK-reference the booking,
// so they must be cleared before setup.ts's cleanupBookings (which only deletes
// the bookings rows). Seeded-but-untouched bookings simply match nothing.
async function cleanupBookingsWithEvents(ids: string[]): Promise<void> {
  const present = ids.filter(Boolean)
  if (present.length === 0) return
  await db.delete(bookingEvents).where(inArray(bookingEvents.bookingId, present))
  await cleanupBookings(present)
}

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

async function seedVehicle(
  classId: string,
  pickupLocationId: string,
  name: string,
  dailyRateJpy: number,
): Promise<string> {
  const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId,
    pickupLocationId,
    name,
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
    dailyRateJpy,
    hourlyRateJpy: null,
    shakenExpiryDate: null,
    insuranceExpiryDate: null,
  })
  return vehicle.id
}

// ── Invariant 1: overlapping substitution surfaces a clean 409 ──────────────
// The exclusion-constraint handler in substitute() (services/booking.ts:620-628)
// is only in-memory tested. Reassign a booking onto a vehicle whose window
// already holds another CONFIRMED booking -> the DB exclusion seal must fire and
// map to 409 "already booked", never bubble as a 500.
describe('substitution onto an already-booked vehicle -> 409 (real pg)', () => {
  let classId: string
  let locationId: string
  let renterId: string
  let vehicleA: string
  let vehicleB: string
  let bookingOnA: string
  let bookingOnB: string

  const startAt = new Date('2026-10-01T09:00:00Z')
  const endAt = new Date('2026-10-02T09:00:00Z')

  beforeAll(async () => {
    const klass = await seedVehicleClass('subst')
    classId = klass.id
    // Substitution requires a non-null ACRISS code shared by both vehicles.
    await db
      .update(vehicleClasses)
      .set({ acrissCode: 'ECAR' })
      .where(eq(vehicleClasses.id, classId))
    const location = await seedLocation('subst')
    locationId = location.id
    renterId = await seedRenter('subst')
    vehicleA = await seedVehicle(classId, locationId, 'Subst Car A', 6000)
    vehicleB = await seedVehicle(classId, locationId, 'Subst Car B', 6000)

    const common = {
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      renterId,
      classId,
      pickupLocationId: locationId,
      dropoffLocationId: locationId,
      startAt,
      endAt,
      status: 'CONFIRMED' as const,
    }
    // Same window on two distinct cars: no clash at seed time (exclusion is
    // per-assigned-vehicle). Reassigning A's booking onto B collides with B's.
    // effectiveEndAt is owned by the compute_effective_end_at INSERT trigger
    // (endAt + turnaround), so both rows get the identical exclusion range.
    const a = await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({ ...common, requestedVehicleId: vehicleA, assignedVehicleId: vehicleA }),
    )
    const b = await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({ ...common, requestedVehicleId: vehicleB, assignedVehicleId: vehicleB }),
    )
    bookingOnA = a.id
    bookingOnB = b.id
  })

  afterAll(async () => {
    await cleanupBookingsWithEvents([bookingOnA, bookingOnB])
    await cleanupVehicles([vehicleA, vehicleB])
    await cleanupVehicleClasses([classId])
    await cleanupLocations([locationId])
    await cleanupUsers([renterId])
  })

  it('rejects the overlapping reassign with 409, not a 500', async () => {
    const res = await service.substitute(operatorCtx(), bookingOnA, vehicleB)
    expect(res).toMatchObject({ ok: false, status: 409 })
    if (res.ok) throw new Error('expected substitution to be rejected')
    expect(res.error).toMatch(/already booked/i)

    // The original booking is untouched — still assigned to A.
    const original = await bookingRepo.findById(SYSTEM_CONTEXT, bookingOnA)
    expect(original?.assignedVehicleId).toBe(vehicleA)
  })
})

// ── Invariant 2: a service-computed total persists through Drizzle ──────────
// The existing integration test (bookings.test.ts:300-317) inserts a hardcoded
// totalPrice: 15000 directly — it never exercises the service composition.
// Create via the service with insurance + a paid add-on and assert the persisted
// total equals base + insurance*days + add-on (not a constant, not just base).
describe('create persists the service-composed total (real pg)', () => {
  let classId: string
  let locationId: string
  let renterId: string
  let vehicleId: string
  let insuranceId: string
  let addOnId: string
  let bookingId: string

  const startAt = new Date('2026-11-01T09:00:00Z')
  // A TWO-day window on purpose: the service multiplies insurance by rental days
  // but adds the add-on flat. At one day both collapse to their face value, so a
  // mutation that mis-multiplied either would slip through. Two days separates
  // them — insurance contributes 2x, the add-on still 1x.
  const endAt = new Date('2026-11-03T09:00:00Z')
  const RENTAL_DAYS = 2
  const DAILY_RATE = 8000
  const INSURANCE_DAILY = 2000
  const ADD_ON_PRICE = 1500

  beforeAll(async () => {
    const klass = await seedVehicleClass('total')
    classId = klass.id
    const location = await seedLocation('total')
    locationId = location.id
    renterId = await seedRenter('total')
    vehicleId = await seedVehicle(classId, locationId, 'Total Car', DAILY_RATE)
    // Insurance + add-on names carry an active-name unique per operator, so a
    // fixed name would collide across reruns / parallel files on the shared
    // Best Car Rental operator. Suffix uniquely (mirrors seedVehicleClass).
    const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const insurance = await insuranceRepo.create({
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      name: `CDW ${uniq}`,
      description: null,
      dailyPriceJpy: INSURANCE_DAILY,
      deductibleJpy: 0,
      status: 'ACTIVE',
    })
    insuranceId = insurance.id
    const addOn = await addOnRepo.create({
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      name: `Child seat ${uniq}`,
      description: null,
      priceJpy: ADD_ON_PRICE,
      status: 'ACTIVE',
    })
    addOnId = addOn.id
  })

  afterAll(async () => {
    await cleanupBookingsWithEvents([bookingId])
    await cleanupVehicles([vehicleId])
    await cleanupVehicleClasses([classId])
    await cleanupLocations([locationId])
    await cleanupUsers([renterId])
    await db.delete(insuranceOptions).where(eq(insuranceOptions.id, insuranceId))
    await db.delete(addOnOptions).where(eq(addOnOptions.id, addOnId))
  })

  it('totalPrice = base + insurance*days + add-on, read back from the DB', async () => {
    const ctx: CallerContext = { userId: renterId, role: 'RENTER', bypassScope: false }
    const res = await service.create(ctx, {
      requestedVehicleId: vehicleId,
      pickupLocationId: locationId,
      dropoffLocationId: locationId,
      insuranceOptionId: insuranceId,
      addOnIds: [addOnId],
      renterId,
      startAt,
      endAt,
      source: 'DIRECT',
    })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error(`create failed: ${res.error}`)
    bookingId = res.booking.id

    const base = calculateBookingPrice(
      { dailyRateJpy: DAILY_RATE, hourlyRateJpy: null },
      startAt,
      endAt,
    )
    expect(base.ok).toBe(true)
    const baseTotal = base.ok ? base.totalPriceJpy : -1
    const expectedTotal = baseTotal + INSURANCE_DAILY * RENTAL_DAYS + ADD_ON_PRICE

    const fromDb = await bookingRepo.findById(SYSTEM_CONTEXT, res.booking.id)
    expect(fromDb?.totalPrice).toBe(expectedTotal)
    // Concrete: 8000*2 (base) + 2000*2 (insurance/day) + 1500 (add-on flat) = 21500.
    expect(fromDb?.totalPrice).toBe(
      DAILY_RATE * RENTAL_DAYS + INSURANCE_DAILY * RENTAL_DAYS + ADD_ON_PRICE,
    )
    expect(fromDb?.totalPrice).toBeGreaterThan(baseTotal) // extras were actually added
    expect(fromDb?.addOnSnapshot).toHaveLength(1)
    expect(fromDb?.insuranceSnapshot?.dailyPriceJpy).toBe(INSURANCE_DAILY)
  })
})

// ── Invariant 3: the cancellation fee round-trips through Drizzle ───────────
// The tier math is unit-covered; this proves the SERVICE writes the computed fee
// into the cancellationFee column (and stamps cancelledAt + CANCELLED). One tier
// (MEDIUM, 70%) is enough — we assert the persisted value, not the whole table.
describe('cancel persists the tiered cancellationFee (real pg)', () => {
  let classId: string
  let locationId: string
  let renterId: string
  let vehicleId: string
  let bookingId: string

  const startAt = new Date('2026-12-01T09:00:00Z')
  const endAt = new Date('2026-12-02T09:00:00Z')
  const TOTAL = 20000
  // 36h before start -> MEDIUM tier (24-48h) -> 70% -> 14000.
  const now = new Date('2026-11-29T21:00:00Z')

  beforeAll(async () => {
    const klass = await seedVehicleClass('cancel')
    classId = klass.id
    const location = await seedLocation('cancel')
    locationId = location.id
    renterId = await seedRenter('cancel')
    vehicleId = await seedVehicle(classId, locationId, 'Cancel Car', 7000)
    const booking = await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
        renterId,
        classId,
        requestedVehicleId: vehicleId,
        assignedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        startAt,
        endAt,
        status: 'CONFIRMED',
        totalPrice: TOTAL,
      }),
    )
    bookingId = booking.id
  })

  afterAll(async () => {
    await cleanupBookingsWithEvents([bookingId])
    await cleanupVehicles([vehicleId])
    await cleanupVehicleClasses([classId])
    await cleanupLocations([locationId])
    await cleanupUsers([renterId])
  })

  it('writes the MEDIUM-tier fee and CANCELLED status, read back from the DB', async () => {
    const ctx: CallerContext = { userId: renterId, role: 'RENTER', bypassScope: false }
    const expected = calculateCancellationFee(startAt, now, TOTAL)
    expect(expected.tier).toBe('MEDIUM')
    expect(expected.feeAmount).toBe(14000)

    const res = await service.cancel(ctx, bookingId, now)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('cancel failed')
    expect(res.cancellation.feeAmount).toBe(14000)

    const fromDb = await bookingRepo.findById(SYSTEM_CONTEXT, bookingId)
    expect(fromDb?.cancellationFee).toBe(14000)
    expect(fromDb?.cancellationFee).toBe(res.cancellation.feeAmount) // persisted == returned
    expect(fromDb?.status).toBe('CANCELLED')
    expect(fromDb?.cancelledAt).toBeInstanceOf(Date)
  })
})

// ── Invariant 4: a walk-in renter is atomic with the booking (#875) ─────────
// The walk-in customer (#589 1c) is created INSIDE the booking tx, so a failed
// booking (here: an exclusion-constraint 409 on a double-booked vehicle) rolls
// the fresh renter back with it — no orphan customer reachable via the operator
// customer-search. Pre-#875 the renter was created before the tx and leaked on
// every failed attempt. Needs a userRepo-wired service to exercise the walk-in.
describe('walk-in renter rolls back when the booking fails (real pg, #875)', () => {
  const walkInService = new BookingService(
    bookingRepo,
    runInTransaction,
    vehicleRepo,
    new DrizzleUserRepository(db),
    vehicleClassRepo,
  )

  let classId: string
  let locationId: string
  let renterId: string
  let vehicleId: string
  let seededBookingId: string
  const WALK_IN_PHONE = `+81-90-875-${Date.now().toString().slice(-7)}`

  const startAt = new Date('2027-01-05T09:00:00Z')
  const endAt = new Date('2027-01-06T09:00:00Z')

  beforeAll(async () => {
    const klass = await seedVehicleClass('walkin')
    classId = klass.id
    const location = await seedLocation('walkin')
    locationId = location.id
    renterId = await seedRenter('walkin')
    vehicleId = await seedVehicle(classId, locationId, 'Walk-in Car', 6000)
    // Occupy the vehicle's window so a second booking on the same car + window
    // trips the exclusion constraint -> 409 (the failure that must roll back).
    const seeded = await bookingRepo.create(
      SYSTEM_CONTEXT,
      bookingInput({
        operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
        renterId,
        classId,
        requestedVehicleId: vehicleId,
        assignedVehicleId: vehicleId,
        pickupLocationId: locationId,
        dropoffLocationId: locationId,
        startAt,
        endAt,
        status: 'CONFIRMED',
      }),
    )
    seededBookingId = seeded.id
  })

  afterAll(async () => {
    await cleanupBookingsWithEvents([seededBookingId])
    await cleanupVehicles([vehicleId])
    await cleanupVehicleClasses([classId])
    await cleanupLocations([locationId])
    // Sweep any leaked walk-in renter too, so a pre-fix run cleans up after itself.
    await db.delete(users).where(eq(users.phone, WALK_IN_PHONE))
    await cleanupUsers([renterId])
  })

  it('does not persist the fresh renter when the booking 409s', async () => {
    const res = await walkInService.create(operatorCtx(), {
      requestedVehicleId: vehicleId,
      pickupLocationId: locationId,
      dropoffLocationId: locationId,
      addOnIds: [],
      renterId: '', // ignored for a walk-in
      walkInCustomer: { name: 'Orphan Probe', phone: WALK_IN_PHONE },
      startAt,
      endAt,
      source: 'MANUAL',
    })
    expect(res).toMatchObject({ ok: false, status: 409 })

    // The fresh walk-in renter must NOT survive — rolled back with the booking.
    const leaked = await db.select().from(users).where(eq(users.phone, WALK_IN_PHONE))
    expect(leaked).toHaveLength(0)
  })
})
