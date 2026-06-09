import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { paymentEvents, users } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  PAYMENT_EVENT_ONE_SUCCESS_CONSTRAINT,
  PAYMENT_EVENT_SESSION_CONSTRAINT,
  PAYMENT_EVENT_STRIPE_EVENT_CONSTRAINT,
  PG_ERROR,
  pgConstraintName,
  pgErrorCode,
} from '../../src/pg-errors'
import {
  DrizzleBookingRepository,
  DrizzlePaymentEventRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import type { NewPaymentEvent } from '../../src/repositories/types'
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

// These tests assert the REAL Postgres unique seals fire with the EXACT
// constraint names pg-errors expects — the one thing the in-memory repo (which
// only mirrors them) cannot prove. A drift between the migration's index names
// and the constants would silently break the webhook idempotency branch.
const paymentRepo = new DrizzlePaymentEventRepository(db)
const bookingRepo = new DrizzleBookingRepository(db)
const vehicleRepo = new DrizzleVehicleRepository(db)

let bookingA: string
let bookingB: string
let userId: string
const classIds: string[] = []
const locationIds: string[] = []
const vehicleIds: string[] = []
const bookingIds: string[] = []

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `pay-${Date.now()}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
    .returning()
  userId = user.id

  const klass = await seedVehicleClass('payment')
  classIds.push(klass.id)
  const location = await seedLocation('payment')
  locationIds.push(location.id)
  const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId: klass.id,
    name: 'Payment Test Car',
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
  vehicleIds.push(vehicle.id)

  const common = {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    renterId: userId,
    classId: klass.id,
    requestedVehicleId: vehicle.id,
    assignedVehicleId: vehicle.id,
    pickupLocationId: location.id,
    dropoffLocationId: location.id,
  }
  // Two NON-overlapping ranges on the same car (no exclusion-constraint clash),
  // so each unique seal can be isolated against a distinct booking.
  const a = await bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      ...common,
      startAt: new Date('2026-07-01T09:00:00Z'),
      endAt: new Date('2026-07-02T09:00:00Z'),
    }),
  )
  const b = await bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      ...common,
      startAt: new Date('2026-08-01T09:00:00Z'),
      endAt: new Date('2026-08-02T09:00:00Z'),
    }),
  )
  bookingA = a.id
  bookingB = b.id
  bookingIds.push(a.id, b.id)
})

afterEach(async () => {
  await db.delete(paymentEvents).where(eq(paymentEvents.bookingId, bookingA))
  await db.delete(paymentEvents).where(eq(paymentEvents.bookingId, bookingB))
})

afterAll(async () => {
  await cleanupBookings(bookingIds)
  await cleanupVehicles(vehicleIds)
  await cleanupVehicleClasses(classIds)
  await cleanupLocations(locationIds)
  await cleanupUsers([userId])
})

function event(bookingId: string, overrides: Partial<NewPaymentEvent> = {}): NewPaymentEvent {
  return {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    bookingId,
    stripeEventId: 'evt_base',
    stripeCheckoutSessionId: 'cs_base',
    stripePaymentIntentId: 'pi_base',
    grossJpy: 100_000,
    platformFeeJpy: 4_000,
    netToPartnerJpy: 96_000,
    currency: 'jpy',
    status: 'SUCCEEDED',
    ...overrides,
  }
}

describe('DrizzlePaymentEventRepository (real Postgres)', () => {
  it('persists a row and finds it by booking', async () => {
    const saved = await paymentRepo.insert(event(bookingA))
    expect(saved.grossJpy).toBe(100_000)
    const found = await paymentRepo.findSucceededByBookingId(bookingA)
    expect(found?.stripeEventId).toBe('evt_base')
  })

  it('rejects a duplicate stripe event id with the expected constraint', async () => {
    await paymentRepo.insert(event(bookingA))
    // Same event id, but a DIFFERENT booking + session -> only the event seal fires.
    const err = await paymentRepo
      .insert(event(bookingB, { stripeCheckoutSessionId: 'cs_other' }))
      .catch((e) => e)
    expect(pgErrorCode(err)).toBe(PG_ERROR.UNIQUE_VIOLATION)
    expect(pgConstraintName(err)).toBe(PAYMENT_EVENT_STRIPE_EVENT_CONSTRAINT)
  })

  it('rejects a duplicate checkout session id with the expected constraint', async () => {
    await paymentRepo.insert(event(bookingA))
    const err = await paymentRepo
      .insert(event(bookingB, { stripeEventId: 'evt_other' }))
      .catch((e) => e)
    expect(pgConstraintName(err)).toBe(PAYMENT_EVENT_SESSION_CONSTRAINT)
  })

  it('rejects a second successful payment for the same booking (partial seal)', async () => {
    await paymentRepo.insert(event(bookingA))
    // Wholly new event + session, same booking -> only the one-success seal fires.
    const err = await paymentRepo
      .insert(event(bookingA, { stripeEventId: 'evt_other', stripeCheckoutSessionId: 'cs_other' }))
      .catch((e) => e)
    expect(pgConstraintName(err)).toBe(PAYMENT_EVENT_ONE_SUCCESS_CONSTRAINT)
  })
})
