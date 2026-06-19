import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import {
  addOnOptions,
  bookingEvents,
  insuranceOptions,
  notificationLog,
  paymentEvents,
  users,
} from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleAddOnRepository,
  DrizzleBookingRepository,
  DrizzleInsuranceOptionRepository,
  DrizzleVehicleClassRepository,
  DrizzleVehicleRepository,
  createDrizzleTransaction,
} from '../../src/repositories/drizzle'
import { BookingService } from '../../src/services/booking'
import type { Booking } from '../../src/stores'
import { renterCtx } from '../helpers/context'
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

// #654: a booking-via-service setup factory. The S1 invariants test (#653)
// hand-wires class -> location -> vehicle -> service.create per `describe`; that
// choreography is exactly the "create a booking precondition without UI clicks"
// the journey slices (S3/S4) need. Promoted here, parameterized by tenant, so
// every later slice imports ONE factory instead of copy-pasting the setup.
//
// Bridge the postgres-js test client's `.transaction()` into the same
// RunInTransaction bundle production builds from neon-serverless (mirrors
// e2e/real-db/real-api-server.ts and booking-service-invariants.test.ts).
const runInTransaction = createDrizzleTransaction((fn) => db.transaction(fn))
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

/** Seed a tenant-less RENTER. Returns the new user id. */
export async function seedRenter(prefix: string): Promise<string> {
  const id = crypto.randomUUID()
  await db.insert(users).values({
    id,
    email: `${prefix}-${id.slice(0, 8)}@kuruma-test.com`,
    role: 'RENTER',
    language: 'en',
  })
  return id
}

// #916 §5.3: the road-legal guard now rejects a booking whose rental ends after
// the vehicle's shaken/insurance expiry. Default every fixture vehicle to docs
// valid far past any test rental window so existing bookings stay 201; gate
// tests override these to seed an expired car.
export const ROAD_LEGAL_FAR_FUTURE = '2099-12-31'

/** Seed an AVAILABLE vehicle sealed to (operatorId, classId, pickupLocationId). */
export async function seedVehicle(opts: {
  operatorId: string
  classId: string
  pickupLocationId: string
  name: string
  dailyRateJpy: number
  /** Defaults to far-future (road-legal). Pass a past date to seed an expired car. */
  shakenExpiryDate?: string
  /** Defaults to far-future (road-legal). Pass a past date to seed an expired car. */
  insuranceExpiryDate?: string
}): Promise<string> {
  const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: opts.operatorId,
    classId: opts.classId,
    pickupLocationId: opts.pickupLocationId,
    name: opts.name,
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
    dailyRateJpy: opts.dailyRateJpy,
    hourlyRateJpy: null,
    shakenExpiryDate: opts.shakenExpiryDate ?? ROAD_LEGAL_FAR_FUTURE,
    insuranceExpiryDate: opts.insuranceExpiryDate ?? ROAD_LEGAL_FAR_FUTURE,
  })
  return vehicle.id
}

export interface CreateSeededBookingOptions {
  /** Tenant that owns the vehicle (and therefore the booking). Default tenant 1. */
  operatorId?: string
  /** Existing renter to book as; when omitted the factory seeds a fresh one. */
  renterId?: string
  /** Fixture-name prefix for parallel-safe unique slugs/codes. */
  prefix?: string
  dailyRateJpy?: number
  startAt?: Date
  endAt?: Date
  withInsurance?: boolean
  insuranceDailyJpy?: number
  withAddOn?: boolean
  addOnPriceJpy?: number
  /**
   * ACRISS class code (default 'CCAR'). Must satisfy ^[A-Z9]{4}$. A non-null
   * code is what makes the booking a valid substitution target (#826).
   */
  acrissCode?: string
  /**
   * Also seed a SECOND AVAILABLE vehicle in the same class + pickup location —
   * the same-ACRISS substitution target #826 needs. Returned as
   * `ids.substituteVehicleId` and removed by `cleanup`.
   */
  withSubstituteVehicle?: boolean
}

export interface SeededBooking {
  booking: Booking
  operatorId: string
  renterId: string
  ids: {
    classId: string
    locationId: string
    vehicleId: string
    renterId: string
    insuranceId?: string
    addOnId?: string
    /** Set only when `withSubstituteVehicle` — a 2nd AVAILABLE same-class vehicle. */
    substituteVehicleId?: string
  }
  /** Delete every row this factory created, in FK order. Call in `afterAll`. */
  cleanup: () => Promise<void>
}

/**
 * Create a confirmed booking + all its prerequisites against real Postgres and
 * return it with a `cleanup` that removes everything in FK-safe order. Defaults
 * give a clean 2-day DIRECT booking on tenant 1; override to target the second
 * tenant, attach insurance/add-ons, or book as an existing renter.
 */
export async function createSeededBooking(
  opts: CreateSeededBookingOptions = {},
): Promise<SeededBooking> {
  const operatorId = opts.operatorId ?? BEST_CAR_RENTAL_OPERATOR_ID
  const prefix = opts.prefix ?? 'factory'
  const startAt = opts.startAt ?? new Date('2027-01-05T09:00:00Z')
  const endAt = opts.endAt ?? new Date('2027-01-07T09:00:00Z')
  const dailyRateJpy = opts.dailyRateJpy ?? 8000
  const acrissCode = opts.acrissCode ?? 'CCAR'
  const uniq = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const ownsRenter = opts.renterId === undefined

  const klass = await seedVehicleClass(prefix, operatorId, acrissCode)
  const location = await seedLocation(prefix, 2880, operatorId)
  const renterId = opts.renterId ?? (await seedRenter(prefix))
  const vehicleId = await seedVehicle({
    operatorId,
    classId: klass.id,
    pickupLocationId: location.id,
    name: `${prefix} car ${uniq}`,
    dailyRateJpy,
  })

  // A 2nd AVAILABLE vehicle in the SAME class + location — the substitution
  // target #826's success path reassigns the booking to. Same class ⇒ same
  // ACRISS, so it clears sameAcrissClass + the availability + location checks.
  let substituteVehicleId: string | undefined
  if (opts.withSubstituteVehicle) {
    substituteVehicleId = await seedVehicle({
      operatorId,
      classId: klass.id,
      pickupLocationId: location.id,
      name: `${prefix} substitute ${uniq}`,
      dailyRateJpy,
    })
  }

  let insuranceId: string | undefined
  if (opts.withInsurance) {
    const insurance = await insuranceRepo.create({
      operatorId,
      name: `CDW ${uniq}`,
      description: null,
      dailyPriceJpy: opts.insuranceDailyJpy ?? 2000,
      deductibleJpy: 0,
      status: 'ACTIVE',
    })
    insuranceId = insurance.id
  }

  let addOnId: string | undefined
  if (opts.withAddOn) {
    const addOn = await addOnRepo.create({
      operatorId,
      name: `Add-on ${uniq}`,
      description: null,
      priceJpy: opts.addOnPriceJpy ?? 1500,
      status: 'ACTIVE',
    })
    addOnId = addOn.id
  }

  const res = await service.create(renterCtx(renterId), {
    requestedVehicleId: vehicleId,
    pickupLocationId: location.id,
    dropoffLocationId: location.id,
    insuranceOptionId: insuranceId ?? null,
    addOnIds: addOnId ? [addOnId] : [],
    renterId,
    startAt,
    endAt,
    source: 'DIRECT',
  })
  if (!res.ok) {
    throw new Error(`createSeededBooking failed: ${JSON.stringify(res.error)}`)
  }
  const booking = res.booking

  const cleanup = async (): Promise<void> => {
    // Every bookingId-keyed child table must go before the booking row: none of
    // booking_events / payment_events / notification_log has ON DELETE CASCADE,
    // so a dependent that seeds payments (#825) or a substitution notification
    // (#826) on top of this booking would otherwise 23503 our own teardown.
    await db.delete(bookingEvents).where(eq(bookingEvents.bookingId, booking.id))
    await db.delete(paymentEvents).where(eq(paymentEvents.bookingId, booking.id))
    await db.delete(notificationLog).where(eq(notificationLog.bookingId, booking.id))
    await cleanupBookings([booking.id])
    await cleanupVehicles(substituteVehicleId ? [vehicleId, substituteVehicleId] : [vehicleId])
    await cleanupVehicleClasses([klass.id])
    await cleanupLocations([location.id])
    if (ownsRenter) await cleanupUsers([renterId])
    if (insuranceId) await db.delete(insuranceOptions).where(eq(insuranceOptions.id, insuranceId))
    if (addOnId) await db.delete(addOnOptions).where(eq(addOnOptions.id, addOnId))
  }

  return {
    booking,
    operatorId,
    renterId,
    ids: {
      classId: klass.id,
      locationId: location.id,
      vehicleId,
      renterId,
      insuranceId,
      addOnId,
      substituteVehicleId,
    },
    cleanup,
  }
}
