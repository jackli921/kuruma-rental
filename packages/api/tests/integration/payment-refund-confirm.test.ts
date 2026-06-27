import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { bookings, paymentRefunds, users } from '@kuruma/shared/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleBookingRepository,
  DrizzlePaymentAnomalyRepository,
  DrizzlePaymentEventRepository,
  DrizzlePaymentRefundRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { PaymentService } from '../../src/services/payment/payment'
import type {
  PaymentGateway,
  VerifiedPaymentEvent,
} from '../../src/services/payment/payment-gateway'
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

// Slice 2 (#851): the webhook → confirm path against REAL Postgres. The unit twin
// (payment.test.ts) proves the branch; ONLY this proves the two DB guards that make a
// redelivered/raced refund a safe no-op — the forward-only markStatus and the
// `WHERE cancellationFeeSettlement='REFUND_DUE'` settlement fence — fire against pg.

// A gateway whose ONLY job is to hand back a programmed refund.updated event; the
// confirm path never touches Stripe (no create/retrieve/list), so those throw.
class StubGateway implements PaymentGateway {
  nextEvent: VerifiedPaymentEvent | null = null
  async createCheckoutSession(): Promise<never> {
    throw new Error('n/a')
  }
  async parseWebhookEvent(): Promise<VerifiedPaymentEvent> {
    if (!this.nextEvent) throw new Error('no event programmed')
    return this.nextEvent
  }
  async refundPayment(): Promise<never> {
    throw new Error('n/a')
  }
  async retrieveRefund(): Promise<never> {
    throw new Error('n/a')
  }
  async listRefundsByPaymentIntent(): Promise<never> {
    throw new Error('n/a')
  }
}

const refundRepo = new DrizzlePaymentRefundRepository(db)
const bookingRepo = new DrizzleBookingRepository(db)
const vehicleRepo = new DrizzleVehicleRepository(db)
const gateway = new StubGateway()
const service = new PaymentService(
  new DrizzlePaymentEventRepository(db),
  refundRepo,
  bookingRepo,
  gateway,
  new DrizzlePaymentAnomalyRepository(db),
  { webBaseUrl: 'https://app.example.com' },
)

let userId: string
let bookingA: string
const classIds: string[] = []
const locationIds: string[] = []
const vehicleIds: string[] = []
const bookingIds: string[] = []

function refundEvent(bookingId: string, status: string): VerifiedPaymentEvent {
  return {
    eventId: `evt_${bookingId}`,
    type: 'refund.updated',
    checkoutSessionId: `re_${bookingId}`,
    paymentIntentId: `pi_${bookingId}`,
    amountTotal: null,
    currency: 'jpy',
    paymentStatus: null,
    refundStatus: status,
    // The gateway surfaces the Refund id (`re_…`) on refund.updated; the webhook
    // confirms only when it equals the receipt's recorded re_ (#1056). arm() attaches
    // this same re_, so a legit event correlates and a foreign re_ would not.
    refundId: `re_${bookingId}`,
    metadata: { bookingId },
  }
}

// Arm a booking exactly as the eager fire leaves it before Stripe settles: booking
// committed REFUND_DUE, a PENDING receipt claimed and carrying its re_.
async function arm(bookingId: string): Promise<void> {
  await db
    .update(bookings)
    .set({ cancellationFeeSettlement: 'REFUND_DUE' })
    .where(eq(bookings.id, bookingId))
  await refundRepo.claim({
    bookingId,
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    stripePaymentIntentId: `pi_${bookingId}`,
    amountJpy: 70_000,
  })
  await refundRepo.attachStripeRefund(bookingId, `re_${bookingId}`)
}

const settlementOf = async (id: string): Promise<string | undefined> =>
  (await bookingRepo.findById(SYSTEM_CONTEXT, id))?.cancellationFeeSettlement

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `refund-${Date.now()}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
    .returning()
  userId = user.id

  const klass = await seedVehicleClass('refund')
  classIds.push(klass.id)
  const location = await seedLocation('refund')
  locationIds.push(location.id)
  const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId: klass.id,
    name: 'Refund Test Car',
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

  const a = await bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      renterId: userId,
      classId: klass.id,
      requestedVehicleId: vehicle.id,
      assignedVehicleId: vehicle.id,
      pickupLocationId: location.id,
      dropoffLocationId: location.id,
      startAt: new Date('2026-07-01T09:00:00Z'),
      endAt: new Date('2026-07-02T09:00:00Z'),
    }),
  )
  bookingA = a.id
  bookingIds.push(a.id)
})

afterEach(async () => {
  // Reset the receipt + settlement so each test starts from a clean armed state.
  await db.delete(paymentRefunds).where(inArray(paymentRefunds.bookingId, bookingIds))
  await db
    .update(bookings)
    .set({ cancellationFeeSettlement: 'ADVISORY' })
    .where(inArray(bookings.id, bookingIds))
})

afterAll(async () => {
  await db.delete(paymentRefunds).where(inArray(paymentRefunds.bookingId, bookingIds))
  await cleanupBookings(bookingIds)
  await cleanupVehicles(vehicleIds)
  await cleanupVehicleClasses(classIds)
  await cleanupLocations(locationIds)
  await cleanupUsers([userId])
})

describe('PaymentService.handleWebhook refund confirmation (#851 Slice 2, real pg)', () => {
  it('a succeeded refund.updated flips the receipt SUCCEEDED and the booking REFUND_DUE → REFUNDED', async () => {
    await arm(bookingA)
    gateway.nextEvent = refundEvent(bookingA, 'succeeded')

    const result = await service.handleWebhook('raw', 'sig')

    expect(result).toEqual({ status: 200, outcome: 'refund_confirmed' })
    expect((await refundRepo.findByBookingId(bookingA))?.status).toBe('SUCCEEDED')
    expect(await settlementOf(bookingA)).toBe('REFUNDED')
  })

  it('a redelivered succeeded refund is a 0-row no-op: receipt and booking stay terminal', async () => {
    await arm(bookingA)
    gateway.nextEvent = refundEvent(bookingA, 'succeeded')
    await service.handleWebhook('raw', 'sig')

    // Second delivery: forward-only markStatus + the REFUND_DUE fence both match 0 rows.
    const second = await service.handleWebhook('raw', 'sig')

    expect(second).toEqual({ status: 200, outcome: 'refund_confirmed' })
    expect((await refundRepo.findByBookingId(bookingA))?.status).toBe('SUCCEEDED')
    expect(await settlementOf(bookingA)).toBe('REFUNDED')
  })

  it('a pending refund advances nothing — receipt stays PENDING, booking stays REFUND_DUE', async () => {
    await arm(bookingA)
    gateway.nextEvent = refundEvent(bookingA, 'pending')

    expect(await service.handleWebhook('raw', 'sig')).toEqual({ status: 200, outcome: 'ignored' })
    expect((await refundRepo.findByBookingId(bookingA))?.status).toBe('PENDING')
    expect(await settlementOf(bookingA)).toBe('REFUND_DUE')
  })

  it('a succeeded refund for an unknown booking is ignored and never touches an armed booking', async () => {
    await arm(bookingA)
    gateway.nextEvent = refundEvent('00000000-0000-0000-0000-000000000000', 'succeeded')

    expect(await service.handleWebhook('raw', 'sig')).toEqual({ status: 200, outcome: 'ignored' })
    expect((await refundRepo.findByBookingId(bookingA))?.status).toBe('PENDING')
    expect(await settlementOf(bookingA)).toBe('REFUND_DUE')
  })
})
