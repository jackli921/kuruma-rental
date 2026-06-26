import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { bookings, paymentAnomalies, paymentRefunds, users } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleBookingRepository,
  DrizzlePaymentAnomalyRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
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

// Real-Postgres proof for the #1075 slice-3 resolve path: the guarded UPDATE sets
// the audit fields and moves the row between the unresolved/resolved lists, AND
// (the locked invariant of this slice) it touches NO money — no payment_refunds
// row is written and the booking's cancellation settlement is left untouched.
const anomalyRepo = new DrizzlePaymentAnomalyRepository(db)
const bookingRepo = new DrizzleBookingRepository(db)
const vehicleRepo = new DrizzleVehicleRepository(db)

let bookingId: string
let userId: string
const classIds: string[] = []
const locationIds: string[] = []
const vehicleIds: string[] = []

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `anomaly-${Date.now()}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
    .returning()
  userId = user.id

  const klass = await seedVehicleClass('anomaly')
  classIds.push(klass.id)
  const location = await seedLocation('anomaly')
  locationIds.push(location.id)
  const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId: klass.id,
    name: 'Anomaly Test Car',
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

  const booking = await bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      renterId: userId,
      classId: klass.id,
      requestedVehicleId: vehicle.id,
      assignedVehicleId: vehicle.id,
      pickupLocationId: location.id,
      dropoffLocationId: location.id,
      startAt: new Date('2026-09-01T09:00:00Z'),
      endAt: new Date('2026-09-02T09:00:00Z'),
    }),
  )
  bookingId = booking.id
})

afterAll(async () => {
  await db.delete(paymentAnomalies).where(eq(paymentAnomalies.bookingId, bookingId))
  await cleanupBookings([bookingId])
  await cleanupVehicles(vehicleIds)
  await cleanupVehicleClasses(classIds)
  await cleanupLocations(locationIds)
  await cleanupUsers([userId])
})

async function seedAnomaly(): Promise<string> {
  const [row] = await db
    .insert(paymentAnomalies)
    .values({
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      bookingId,
      kind: 'DOUBLE_PAYMENT',
      stripeEventId: `evt_${crypto.randomUUID()}`,
      stripeCheckoutSessionId: `cs_${crypto.randomUUID()}`,
      stripePaymentIntentId: 'pi_dupe',
      receivedAmountJpy: 10_000,
      expectedAmountJpy: 10_000,
      currency: 'jpy',
    })
    .returning()
  return row.id
}

describe('DrizzlePaymentAnomalyRepository.resolve (real Postgres)', () => {
  it('writes the audit fields and moves the row from unresolved to resolved', async () => {
    const id = await seedAnomaly()

    const resolved = await anomalyRepo.resolve(id, {
      resolution: 'REFUNDED_EXTERNALLY',
      resolvedBy: 'admin-xyz',
      note: 'refunded the duplicate in the Stripe dashboard',
    })

    expect(resolved).toMatchObject({
      id,
      resolution: 'REFUNDED_EXTERNALLY',
      resolvedBy: 'admin-xyz',
      note: 'refunded the duplicate in the Stripe dashboard',
    })
    expect(resolved?.resolvedAt).toBeInstanceOf(Date)

    const unresolvedIds = (await anomalyRepo.listUnresolved()).map((a) => a.id)
    const resolvedIds = (await anomalyRepo.listResolved()).map((a) => a.id)
    expect(unresolvedIds).not.toContain(id)
    expect(resolvedIds).toContain(id)
  })

  it('is write-once at the DB: a second resolve matches no row and returns null', async () => {
    const id = await seedAnomaly()
    await anomalyRepo.resolve(id, { resolution: 'BENIGN', resolvedBy: 'admin-1', note: null })

    const second = await anomalyRepo.resolve(id, {
      resolution: 'INVESTIGATED',
      resolvedBy: 'admin-2',
      note: 'should not overwrite',
    })
    expect(second).toBeNull()

    // The first resolution is intact — not clobbered by the second attempt.
    const [row] = await db.select().from(paymentAnomalies).where(eq(paymentAnomalies.id, id))
    expect(row).toMatchObject({ resolution: 'BENIGN', resolvedBy: 'admin-1' })
  })

  it('moves NO money: no payment_refunds row and the booking settlement is untouched', async () => {
    const id = await seedAnomaly()
    await anomalyRepo.resolve(id, {
      resolution: 'REFUNDED_EXTERNALLY',
      resolvedBy: 'admin-1',
      note: null,
    })

    const refunds = await db
      .select()
      .from(paymentRefunds)
      .where(eq(paymentRefunds.bookingId, bookingId))
    expect(refunds).toHaveLength(0)

    const [booking] = await db.select().from(bookings).where(eq(bookings.id, bookingId))
    expect(booking.cancellationFeeSettlement).toBe('ADVISORY')
  })
})
