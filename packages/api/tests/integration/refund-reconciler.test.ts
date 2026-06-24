import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { bookings, paymentEvents, paymentRefunds, users } from '@kuruma/shared/db/schema'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SYSTEM_CONTEXT } from '../../src/middleware/auth'
import {
  DrizzleBookingRepository,
  DrizzlePaymentAnomalyRepository,
  DrizzlePaymentEventRepository,
  DrizzlePaymentRefundRepository,
  DrizzleRefundReconcilerRepository,
  DrizzleVehicleRepository,
} from '../../src/repositories/drizzle'
import { CancellationRefundReconciler } from '../../src/services/payment/cancellation-refund-reconciler'
import { PaymentService } from '../../src/services/payment/payment'
import type { PaymentGateway, StripeRefund } from '../../src/services/payment/payment-gateway'
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

// #851 Slice 4 (real pg): the reconciler backstop. The unit twins prove the scan
// FILTER logic and the service's failure isolation; ONLY this proves (a) the Drizzle
// LEFT JOIN scan's terminal-exclusion + oldest-first/limit fire as real SQL, and
// (b) the end-to-end self-heal — a refund Stripe completed but whose webhook was
// lost is RETRIEVED (never re-issued) and confirmed REFUNDED through runTx on pg.
//
// Pollution-robust: every seeded booking is cancelled in the DISTANT PAST (year
// 2000), so the system-wide (cron, no tenant) scan orders MY rows ahead of any
// concurrent REFUND_DUE row, making the oldest-first/limit assertions deterministic.

const refundRepo = new DrizzlePaymentRefundRepository(db)
const bookingRepo = new DrizzleBookingRepository(db)
const vehicleRepo = new DrizzleVehicleRepository(db)
const eventRepo = new DrizzlePaymentEventRepository(db)
const reconcilerRepo = new DrizzleRefundReconcilerRepository(db)

let userId: string
let vehicleId: string
const classIds: string[] = []
const locationIds: string[] = []
const vehicleIds: string[] = []
const bookingIds: string[] = []

let startSeq = 0
async function seedConfirmed(): Promise<string> {
  startSeq += 1
  const start = new Date(Date.UTC(2027, startSeq, 1, 9))
  const end = new Date(Date.UTC(2027, startSeq, 2, 9))
  const b = await bookingRepo.create(
    SYSTEM_CONTEXT,
    bookingInput({
      operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
      renterId: userId,
      requestedVehicleId: vehicleId,
      assignedVehicleId: vehicleId,
      pickupLocationId: locationIds[0]!,
      dropoffLocationId: locationIds[0]!,
      startAt: start,
      endAt: end,
    }),
  )
  bookingIds.push(b.id)
  return b.id
}

// Stamp settlement + a distant-past cancelledAt directly (the scan reads only these;
// the cancel path itself is covered by booking-cancel-settlement.test.ts).
async function setSettlement(
  id: string,
  settlement: string,
  cancelledAt: Date,
  totalPrice = 100_000,
  fee = 30_000,
): Promise<void> {
  await db
    .update(bookings)
    .set({ cancellationFeeSettlement: settlement, cancelledAt, totalPrice, cancellationFee: fee })
    .where(eq(bookings.id, id))
}

async function claimReceipt(id: string, status: 'PENDING' | 'SUCCEEDED' | 'FAILED'): Promise<void> {
  await refundRepo.claim({
    bookingId: id,
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    stripePaymentIntentId: `pi_${id}`,
    amountJpy: 70_000,
  })
  if (status !== 'PENDING') await refundRepo.markStatus(id, status)
}

async function markPaid(id: string): Promise<void> {
  await eventRepo.insert({
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    bookingId: id,
    stripeEventId: `evt_${id}`,
    stripeCheckoutSessionId: `cs_${id}`,
    stripePaymentIntentId: `pi_${id}`,
    grossJpy: 100_000,
    platformFeeJpy: 0,
    netToPartnerJpy: 100_000,
    currency: 'jpy',
    status: 'SUCCEEDED',
  })
}

const D2000 = (day: number) => new Date(Date.UTC(2000, 0, day, 0))

beforeAll(async () => {
  const [user] = await db
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      email: `reconciler-${Date.now()}@kuruma-test.com`,
      role: 'RENTER',
      language: 'en',
    })
    .returning()
  userId = user.id

  const klass = await seedVehicleClass('reconciler')
  classIds.push(klass.id)
  const location = await seedLocation('reconciler')
  locationIds.push(location.id)
  const vehicle = await vehicleRepo.create(SYSTEM_CONTEXT, {
    operatorId: BEST_CAR_RENTAL_OPERATOR_ID,
    classId: klass.id,
    name: 'Reconciler Test Car',
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
  vehicleId = vehicle.id
  vehicleIds.push(vehicle.id)
})

afterAll(async () => {
  await db.delete(paymentEvents).where(inArray(paymentEvents.bookingId, bookingIds))
  await db.delete(paymentRefunds).where(inArray(paymentRefunds.bookingId, bookingIds))
  await cleanupBookings(bookingIds)
  await cleanupVehicles(vehicleIds)
  await cleanupVehicleClasses(classIds)
  await cleanupLocations(locationIds)
  await cleanupUsers([userId])
})

// Filter a scan result to the ids this test seeded — the scan is system-wide, so a
// concurrent REFUND_DUE row elsewhere must not break a membership assertion.
const ours = (rows: { id: string }[], ids: string[]): string[] =>
  rows.map((r) => r.id).filter((id) => ids.includes(id))

describe('DrizzleRefundReconcilerRepository.listRefundDueNeedingDrive (#851 Slice 4, real pg)', () => {
  it('LEFT JOIN keeps no-receipt + PENDING REFUND_DUE rows; excludes terminal receipts and non-REFUND_DUE', async () => {
    const noReceipt = await seedConfirmed()
    const pending = await seedConfirmed()
    const succeeded = await seedConfirmed()
    const failed = await seedConfirmed()
    const advisory = await seedConfirmed()
    const refunded = await seedConfirmed()
    const seeded = [noReceipt, pending, succeeded, failed, advisory, refunded]

    await setSettlement(noReceipt, 'REFUND_DUE', D2000(3))
    await setSettlement(pending, 'REFUND_DUE', D2000(2))
    await setSettlement(succeeded, 'REFUND_DUE', D2000(4))
    await setSettlement(failed, 'REFUND_DUE', D2000(1))
    await setSettlement(advisory, 'ADVISORY', D2000(5))
    await setSettlement(refunded, 'REFUNDED', D2000(6))
    await claimReceipt(pending, 'PENDING')
    await claimReceipt(succeeded, 'SUCCEEDED')
    await claimReceipt(failed, 'FAILED')

    const rows = await reconcilerRepo.listRefundDueNeedingDrive({ limit: 1000 })

    // Exactly the two retryable rows, oldest cancellation first (pending D2 < noReceipt D3).
    expect(ours(rows, seeded)).toEqual([pending, noReceipt])
  })

  it('excludes terminal-FAILED BEFORE the limit so it cannot starve retryable work', async () => {
    // failedOldest is the globally-oldest REFUND_DUE row (D1); were it not excluded
    // in the WHERE it would consume the only slot. limit:1 must still yield retryable.
    const failedOldest = await seedConfirmed()
    const retryable = await seedConfirmed()
    await setSettlement(failedOldest, 'REFUND_DUE', D2000(1))
    await setSettlement(retryable, 'REFUND_DUE', D2000(2))
    await claimReceipt(failedOldest, 'FAILED')

    const rows = await reconcilerRepo.listRefundDueNeedingDrive({ limit: 1 })

    expect(rows.map((r) => r.id)).toEqual([retryable]) // distant-past ⇒ globally first
  })
})

// A gateway holding a refund Stripe already completed but never webhooked back.
class WebhookLostGateway implements PaymentGateway {
  refundCalls = 0
  async createCheckoutSession(): Promise<never> {
    throw new Error('n/a')
  }
  async parseWebhookEvent(): Promise<never> {
    throw new Error('n/a')
  }
  async refundPayment(): Promise<never> {
    this.refundCalls += 1
    throw new Error('must not re-issue: a matching refund already exists')
  }
  async retrieveRefund(): Promise<never> {
    throw new Error('n/a')
  }
  async listRefundsByPaymentIntent(paymentIntentId: string): Promise<StripeRefund[]> {
    const bookingId = paymentIntentId.replace(/^pi_/, '')
    return [
      {
        id: `re_${bookingId}`,
        amount: 70_000,
        currency: 'jpy',
        status: 'succeeded',
        paymentIntentId,
        metadata: { bookingId },
      },
    ]
  }
}

describe('CancellationRefundReconciler end-to-end self-heal (#851 Slice 4, real pg)', () => {
  it('a refund succeeded at Stripe with no webhook → sweep adopts, confirms REFUNDED via runTx, never re-issues', async () => {
    const gateway = new WebhookLostGateway()
    const service = new PaymentService(
      eventRepo,
      refundRepo,
      bookingRepo,
      gateway,
      new DrizzlePaymentAnomalyRepository(db),
      { webBaseUrl: 'https://app.example.com' },
    )
    const reconciler = new CancellationRefundReconciler({
      scanRepo: reconcilerRepo,
      driver: service,
      refundRepo,
    })

    const stuck = await seedConfirmed()
    await setSettlement(stuck, 'REFUND_DUE', D2000(2))
    await markPaid(stuck) // a SUCCEEDED payment_event → the booking reads as PAID

    // The system-wide summary is pollution-sensitive (other REFUND_DUE rows may be
    // swept too); assert the durable per-booking state instead — that IS ours.
    await reconciler.run({ limit: 1000 })

    expect(gateway.refundCalls).toBe(0) // adopted the existing refund, never re-issued
    expect((await refundRepo.findByBookingId(stuck))?.status).toBe('SUCCEEDED')
    expect((await refundRepo.findByBookingId(stuck))?.stripeRefundId).toBe(`re_${stuck}`)
    expect((await bookingRepo.findById(SYSTEM_CONTEXT, stuck))?.cancellationFeeSettlement).toBe(
      'REFUNDED',
    )

    // Idempotent: the now-REFUNDED booking is no longer scanned, so a second sweep
    // does not touch it (and the scan, filtered to our id, no longer returns it).
    const scanAfter = await reconcilerRepo.listRefundDueNeedingDrive({ limit: 1000 })
    expect(scanAfter.map((r) => r.id)).not.toContain(stuck)
  })
})
