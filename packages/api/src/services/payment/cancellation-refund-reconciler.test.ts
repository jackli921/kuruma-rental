import { beforeEach, describe, expect, it } from 'vitest'
import type { CallerContext } from '../../middleware/auth'
import { InMemoryBookingRepository } from '../../repositories/in-memory/booking'
import { InMemoryPaymentAnomalyRepository } from '../../repositories/in-memory/payment-anomaly'
import { InMemoryPaymentEventRepository } from '../../repositories/in-memory/payment-event'
import { InMemoryPaymentRefundRepository } from '../../repositories/in-memory/payment-refund'
import { InMemoryRefundReconcilerRepository } from '../../repositories/in-memory/refund-reconciler'
import type { Booking, PaymentRefund } from '../../stores'
import {
  CancellationRefundReconciler,
  refundReconcilerStrandedAlert,
} from './cancellation-refund-reconciler'
import { PaymentService } from './payment'
import {
  type PaymentGateway,
  type RefundParams,
  RefundRejectedError,
  type StripeRefund,
} from './payment-gateway'

const RENTER: CallerContext = { userId: 'renter-1', role: 'RENTER', bypassScope: false }

function makeBooking(id: string, o: Partial<Booking> = {}): Booking {
  const now = new Date('2026-06-09T00:00:00Z')
  return {
    id,
    operatorId: 'op-1',
    renterId: 'renter-1',
    classId: 'cls-1',
    requestedVehicleId: 'veh-1',
    assignedVehicleId: 'veh-1',
    pickupLocationId: 'loc-1',
    dropoffLocationId: 'loc-1',
    fulfillmentMode: 'SPECIFIC',
    startAt: now,
    endAt: now,
    effectiveEndAt: now,
    status: 'CANCELLED',
    source: 'DIRECT',
    bookingCode: 'ABCD2345',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: 100_000,
    cancellationFee: 30_000,
    cancellationFeeSettlement: 'REFUND_DUE',
    cancelledAt: now,
    idempotencyKey: null,
    disclaimerAcknowledgedAt: null,
    disclaimerTermsVersion: null,
    createdAt: now,
    updatedAt: now,
    ...o,
  }
}

type Behavior = 'succeed' | 'rejectTerminal' | 'throw'

/** Routes each refund call by booking so one sweep can exercise success, a terminal
 *  Stripe rejection, and a transient throw in the SAME batch — the failure-isolation
 *  case. `listResultByBooking` lets a test stage an already-succeeded refund Stripe
 *  holds but we never recorded (the self-heal: webhook lost, balance correct). */
class RoutingRefundGateway implements PaymentGateway {
  refundCalls: RefundParams[] = []
  behaviorByBooking = new Map<string, Behavior>()
  listResultByBooking = new Map<string, StripeRefund[]>()

  async createCheckoutSession(): Promise<never> {
    throw new Error('n/a')
  }
  async parseWebhookEvent(): Promise<never> {
    throw new Error('n/a')
  }
  async refundPayment(p: RefundParams): Promise<StripeRefund> {
    this.refundCalls.push(p)
    const bookingId = p.metadata.bookingId
    switch (this.behaviorByBooking.get(bookingId)) {
      case 'throw':
        throw new Error('network blip')
      case 'rejectTerminal':
        throw new RefundRejectedError('charge already refunded', 'charge_already_refunded')
      default:
        return {
          id: `re_${bookingId}`,
          amount: p.amountJpy,
          currency: 'jpy',
          status: 'succeeded',
          paymentIntentId: p.paymentIntentId,
          metadata: { bookingId },
        }
    }
  }
  async retrieveRefund(): Promise<StripeRefund> {
    throw new Error('no retrieve programmed')
  }
  async listRefundsByPaymentIntent(paymentIntentId: string): Promise<StripeRefund[]> {
    return this.listResultByBooking.get(paymentIntentId) ?? []
  }
}

describe('CancellationRefundReconciler.run (#851 S4)', () => {
  let bookings: Map<string, Booking>
  let refunds: Map<string, PaymentRefund>
  let bookingRepo: InMemoryBookingRepository
  let paymentRepo: InMemoryPaymentEventRepository
  let refundRepo: InMemoryPaymentRefundRepository
  let gateway: RoutingRefundGateway
  let service: PaymentService
  let reconciler: CancellationRefundReconciler

  // Stripe PI per booking so the routing gateway and the captured-gross clamp line up.
  async function markPaid(bookingId: string, grossJpy = 100_000): Promise<void> {
    await paymentRepo.insert({
      operatorId: 'op-1',
      bookingId,
      stripeEventId: `evt_${bookingId}`,
      stripeCheckoutSessionId: `cs_${bookingId}`,
      stripePaymentIntentId: `pi_${bookingId}`,
      grossJpy,
      platformFeeJpy: 0,
      netToPartnerJpy: grossJpy,
      currency: 'jpy',
      status: 'SUCCEEDED',
    })
  }

  beforeEach(() => {
    bookings = new Map()
    refunds = new Map()
    bookingRepo = new InMemoryBookingRepository(bookings)
    paymentRepo = new InMemoryPaymentEventRepository()
    refundRepo = new InMemoryPaymentRefundRepository(refunds)
    gateway = new RoutingRefundGateway()
    service = new PaymentService(
      paymentRepo,
      refundRepo,
      bookingRepo,
      gateway,
      new InMemoryPaymentAnomalyRepository(),
      { webBaseUrl: 'https://app.example.com' },
    )
    reconciler = new CancellationRefundReconciler({
      scanRepo: new InMemoryRefundReconcilerRepository(bookings, refunds),
      driver: service,
      refundRepo,
    })
  })

  it('drives the refundAmount (totalPrice - cancellationFee) for a stuck REFUND_DUE booking', async () => {
    bookings.set('bk-1', makeBooking('bk-1', { totalPrice: 100_000, cancellationFee: 30_000 }))
    await markPaid('bk-1')

    const summary = await reconciler.run({ limit: 10 })

    expect(gateway.refundCalls).toHaveLength(1)
    expect(gateway.refundCalls[0]?.amountJpy).toBe(70_000)
    expect(summary).toEqual({ attempted: 1, succeeded: 1, failed: 0, pending: 0 })
    expect((await bookingRepo.findById(RENTER, 'bk-1'))?.cancellationFeeSettlement).toBe('REFUNDED')
  })

  it('self-heals a refund Stripe already completed but no webhook recorded — adopts, never re-creates', async () => {
    bookings.set('bk-1', makeBooking('bk-1'))
    await markPaid('bk-1')
    // Stripe already holds our matching, succeeded refund; the webhook never landed.
    gateway.listResultByBooking.set('pi_bk-1', [
      {
        id: 're_existing',
        amount: 70_000,
        currency: 'jpy',
        status: 'succeeded',
        paymentIntentId: 'pi_bk-1',
        metadata: { bookingId: 'bk-1' },
      },
    ])

    const summary = await reconciler.run({ limit: 10 })

    expect(gateway.refundCalls).toHaveLength(0) // adopted, not re-issued
    expect(await refundRepo.findByBookingId('bk-1')).toMatchObject({
      stripeRefundId: 're_existing',
      status: 'SUCCEEDED',
    })
    expect(summary).toEqual({ attempted: 1, succeeded: 1, failed: 0, pending: 0 })
    expect((await bookingRepo.findById(RENTER, 'bk-1'))?.cancellationFeeSettlement).toBe('REFUNDED')
  })

  it('isolates failures: a success, a terminal rejection, and a transient throw in ONE batch', async () => {
    for (const id of ['ok', 'fail', 'poison']) {
      bookings.set(id, makeBooking(id))
      await markPaid(id)
    }
    gateway.behaviorByBooking.set('fail', 'rejectTerminal')
    gateway.behaviorByBooking.set('poison', 'throw')

    const summary = await reconciler.run({ limit: 10 })

    // The poison throw did NOT abort the batch — all three were attempted.
    expect(summary).toEqual({ attempted: 3, succeeded: 1, failed: 1, pending: 1 })
    const settlement = async (id: string) =>
      (await bookingRepo.findById(RENTER, id))?.cancellationFeeSettlement
    expect(await settlement('ok')).toBe('REFUNDED')
    expect(await settlement('fail')).toBe('REFUND_DUE') // terminal receipt, human surface
    expect(await settlement('poison')).toBe('REFUND_DUE') // retried next run
    expect(await refundRepo.findByBookingId('fail')).toMatchObject({ status: 'FAILED' })
  })

  it('is idempotent across runs: the second sweep finds nothing left to drive', async () => {
    bookings.set('bk-1', makeBooking('bk-1'))
    await markPaid('bk-1')

    const first = await reconciler.run({ limit: 10 })
    const second = await reconciler.run({ limit: 10 })

    expect(first).toEqual({ attempted: 1, succeeded: 1, failed: 0, pending: 0 })
    expect(second).toEqual({ attempted: 0, succeeded: 0, failed: 0, pending: 0 })
    expect(gateway.refundCalls).toHaveLength(1) // never re-issued on the second run
  })

  it('skips an already-REFUNDED booking (settlement past REFUND_DUE)', async () => {
    bookings.set('done', makeBooking('done', { cancellationFeeSettlement: 'REFUNDED' }))
    await markPaid('done')

    const summary = await reconciler.run({ limit: 10 })

    expect(summary).toEqual({ attempted: 0, succeeded: 0, failed: 0, pending: 0 })
    expect(gateway.refundCalls).toHaveLength(0)
  })
})

describe('refundReconcilerStrandedAlert', () => {
  it('raises an alert naming the FAILED count when refunds are stranded', () => {
    const alert = refundReconcilerStrandedAlert({
      attempted: 5,
      succeeded: 3,
      failed: 2,
      pending: 0,
    })

    // A FAILED receipt keeps the booking REFUND_DUE but is excluded from every later
    // sweep (drizzle/refund-reconciler.ts), so this run is the ONLY signal that money
    // is stuck — it must page a human, not sit in the info-level summary.
    expect(alert).toBe(
      '2 cancellation refund(s) FAILED at Stripe and are stranded at REFUND_DUE — manual reconciliation needed',
    )
  })

  it('is silent (null) when no refund failed', () => {
    expect(
      refundReconcilerStrandedAlert({ attempted: 4, succeeded: 4, failed: 0, pending: 0 }),
    ).toBeNull()
  })

  it('is silent for a clean empty sweep', () => {
    expect(
      refundReconcilerStrandedAlert({ attempted: 0, succeeded: 0, failed: 0, pending: 0 }),
    ).toBeNull()
  })
})
