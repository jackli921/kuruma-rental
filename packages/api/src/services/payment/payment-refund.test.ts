import { beforeEach, describe, expect, it } from 'vitest'
import type { CallerContext } from '../../middleware/auth'
import { InMemoryBookingRepository } from '../../repositories/in-memory/booking'
import { InMemoryPaymentAnomalyRepository } from '../../repositories/in-memory/payment-anomaly'
import { InMemoryPaymentEventRepository } from '../../repositories/in-memory/payment-event'
import { InMemoryPaymentRefundRepository } from '../../repositories/in-memory/payment-refund'
import type { Booking } from '../../stores'
import { PaymentService } from './payment'
import {
  type PaymentGateway,
  type RefundParams,
  RefundRejectedError,
  type StripeRefund,
} from './payment-gateway'

const RENTER: CallerContext = { userId: 'renter-1', role: 'RENTER', bypassScope: false }
const PI = 'pi_1'

function makeBooking(overrides: Partial<Booking> = {}): Booking {
  const now = new Date('2026-06-09T00:00:00Z')
  return {
    id: 'bk-1',
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
    // The renter cancel tx (Slice 3) commits REFUND_DUE before initiate runs.
    cancellationFeeSettlement: 'REFUND_DUE',
    cancelledAt: now,
    idempotencyKey: null,
    disclaimerAcknowledgedAt: null,
    disclaimerTermsVersion: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function stripeRefund(o: Partial<StripeRefund> = {}): StripeRefund {
  return {
    id: 're_default',
    amount: 70_000,
    currency: 'jpy',
    status: 'succeeded',
    paymentIntentId: PI,
    metadata: { bookingId: 'bk-1' },
    ...o,
  }
}

// A programmable refund gateway: records every refundPayment call, and hands back a
// configurable created/listed/retrieved Refund (or throws) so each test drives the
// create-or-retrieve/adopt branch it targets.
class FakeRefundGateway implements PaymentGateway {
  refundCalls: RefundParams[] = []
  createResult: StripeRefund | (() => never) = () => {
    throw new Error('no create programmed')
  }
  listResult: StripeRefund[] = []
  retrieveResult?: StripeRefund

  async createCheckoutSession(): Promise<never> {
    throw new Error('n/a')
  }
  async parseWebhookEvent(): Promise<never> {
    throw new Error('n/a')
  }
  async refundPayment(p: RefundParams): Promise<StripeRefund> {
    this.refundCalls.push(p)
    const r = this.createResult
    return typeof r === 'function' ? r() : r
  }
  async retrieveRefund(): Promise<StripeRefund> {
    if (!this.retrieveResult) throw new Error('no retrieve programmed')
    return this.retrieveResult
  }
  async listRefundsByPaymentIntent(): Promise<StripeRefund[]> {
    return this.listResult
  }
}

describe('PaymentService.initiateCancellationRefund (#851)', () => {
  let bookings: Map<string, Booking>
  let bookingRepo: InMemoryBookingRepository
  let paymentRepo: InMemoryPaymentEventRepository
  let refundRepo: InMemoryPaymentRefundRepository
  let anomalyRepo: InMemoryPaymentAnomalyRepository
  let gateway: FakeRefundGateway
  let service: PaymentService

  // Record a SUCCEEDED payment so the booking reads as PAID (grossJpy = captured).
  async function markPaid(bookingId: string, grossJpy: number): Promise<void> {
    await paymentRepo.insert({
      operatorId: 'op-1',
      bookingId,
      stripeEventId: `evt_${bookingId}`,
      stripeCheckoutSessionId: `cs_${bookingId}`,
      stripePaymentIntentId: PI,
      grossJpy,
      platformFeeJpy: 0,
      netToPartnerJpy: grossJpy,
      currency: 'jpy',
      status: 'SUCCEEDED',
    })
  }

  beforeEach(async () => {
    bookings = new Map([['bk-1', makeBooking()]])
    bookingRepo = new InMemoryBookingRepository(bookings)
    paymentRepo = new InMemoryPaymentEventRepository()
    refundRepo = new InMemoryPaymentRefundRepository()
    anomalyRepo = new InMemoryPaymentAnomalyRepository()
    gateway = new FakeRefundGateway()
    service = new PaymentService(paymentRepo, refundRepo, bookingRepo, gateway, anomalyRepo, {
      webBaseUrl: 'https://app.example.com',
    })
    await markPaid('bk-1', 100_000)
  })

  const booking = (): Booking => bookings.get('bk-1') as Booking

  it('creates one refund for the refundAmount, persists re_, and confirms the booking REFUNDED', async () => {
    gateway.listResult = []
    gateway.createResult = stripeRefund({ id: 're_new', amount: 70_000, status: 'succeeded' })

    await service.initiateCancellationRefund(booking(), 70_000)

    expect(gateway.refundCalls).toHaveLength(1)
    expect(gateway.refundCalls[0]).toMatchObject({
      paymentIntentId: PI,
      amountJpy: 70_000,
      idempotencyKey: 'refund:bk-1',
      metadata: { bookingId: 'bk-1' },
    })
    expect(await refundRepo.findByBookingId('bk-1')).toMatchObject({
      stripeRefundId: 're_new',
      amountJpy: 70_000,
      status: 'SUCCEEDED',
    })
    expect((await bookingRepo.findById(RENTER, 'bk-1'))?.cancellationFeeSettlement).toBe('REFUNDED')
  })

  it('no-ops for an UNPAID booking (no SUCCEEDED payment) — never calls Stripe', async () => {
    const unpaid = makeBooking({ id: 'bk-unpaid' })
    await service.initiateCancellationRefund(unpaid, 70_000)
    expect(gateway.refundCalls).toHaveLength(0)
    expect(await refundRepo.findByBookingId('bk-unpaid')).toBeNull()
  })

  it('adopts an orphaned refund ONLY when bookingId + amount + currency + paymentIntent all match', async () => {
    gateway.listResult = [
      stripeRefund({
        id: 're_orphan',
        amount: 70_000,
        currency: 'jpy',
        paymentIntentId: PI,
        metadata: { bookingId: 'bk-1' },
        status: 'succeeded',
      }),
    ]

    await service.initiateCancellationRefund(booking(), 70_000)

    // Adopted, never re-created.
    expect(gateway.refundCalls).toHaveLength(0)
    expect(await refundRepo.findByBookingId('bk-1')).toMatchObject({
      stripeRefundId: 're_orphan',
      status: 'SUCCEEDED',
    })
    expect((await bookingRepo.findById(RENTER, 'bk-1'))?.cancellationFeeSettlement).toBe('REFUNDED')
  })

  it('does NOT adopt a foreign/partial refund on the same PI — creates our own instead', async () => {
    // A manual operator partial refund: different amount, no bookingId correlation.
    gateway.listResult = [
      stripeRefund({ id: 're_manual', amount: 30_000, metadata: {}, status: 'succeeded' }),
    ]
    gateway.createResult = stripeRefund({ id: 're_ours', amount: 70_000, status: 'succeeded' })

    await service.initiateCancellationRefund(booking(), 70_000)

    expect(gateway.refundCalls).toHaveLength(1)
    const receipt = await refundRepo.findByBookingId('bk-1')
    expect(receipt?.stripeRefundId).toBe('re_ours')
    expect(receipt?.stripeRefundId).not.toBe('re_manual')
  })

  it('never confirms the booking from a foreign refund: a terminal rejection marks FAILED and leaves REFUND_DUE', async () => {
    // The charge was already (manually) fully refunded; our create is terminally rejected.
    gateway.listResult = [
      stripeRefund({ id: 're_manual_full', amount: 100_000, metadata: {}, status: 'succeeded' }),
    ]
    gateway.createResult = () => {
      throw new RefundRejectedError('charge already refunded', 'charge_already_refunded')
    }

    await service.initiateCancellationRefund(booking(), 70_000)

    expect((await refundRepo.findByBookingId('bk-1'))?.status).toBe('FAILED')
    expect((await bookingRepo.findById(RENTER, 'bk-1'))?.cancellationFeeSettlement).toBe(
      'REFUND_DUE',
    )
  })

  it('re-drives via retrieve once a re_ is attached — never creates a second refund', async () => {
    gateway.listResult = []
    gateway.createResult = stripeRefund({ id: 're_1', status: 'pending' }) // settles later
    await service.initiateCancellationRefund(booking(), 70_000)
    expect(gateway.refundCalls).toHaveLength(1)
    expect((await bookingRepo.findById(RENTER, 'bk-1'))?.cancellationFeeSettlement).toBe(
      'REFUND_DUE',
    )

    // Reconciler re-drive: receipt now holds re_1 → retrieve (now succeeded), no new create.
    gateway.retrieveResult = stripeRefund({ id: 're_1', status: 'succeeded' })
    await service.initiateCancellationRefund(booking(), 70_000)

    expect(gateway.refundCalls).toHaveLength(1)
    expect((await refundRepo.findByBookingId('bk-1'))?.status).toBe('SUCCEEDED')
    expect((await bookingRepo.findById(RENTER, 'bk-1'))?.cancellationFeeSettlement).toBe('REFUNDED')
  })

  it('clamps the refund to the captured amount (never refunds more than was paid)', async () => {
    gateway.listResult = []
    gateway.createResult = stripeRefund({ id: 're_clamp', amount: 100_000, status: 'succeeded' })
    await service.initiateCancellationRefund(booking(), 120_000) // intended > captured 100k
    expect(gateway.refundCalls[0]?.amountJpy).toBe(100_000)
  })

  it('claim() is forward-only: re-claiming a SUCCEEDED receipt never resets it to PENDING', async () => {
    await refundRepo.claim({
      bookingId: 'bk-9',
      operatorId: 'op-1',
      stripePaymentIntentId: 'pi_9',
      amountJpy: 50_000,
    })
    await refundRepo.markStatus('bk-9', 'SUCCEEDED')
    const re = await refundRepo.claim({
      bookingId: 'bk-9',
      operatorId: 'op-1',
      stripePaymentIntentId: 'pi_9',
      amountJpy: 50_000,
    })
    expect(re.status).toBe('SUCCEEDED')
  })
})
