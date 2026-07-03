import { beforeEach, describe, expect, it } from 'vitest'
import type { CallerContext } from '../../middleware/auth'
import { InMemoryBookingRepository } from '../../repositories/in-memory/booking'
import { InMemoryPaymentAnomalyRepository } from '../../repositories/in-memory/payment-anomaly'
import { InMemoryPaymentEventRepository } from '../../repositories/in-memory/payment-event'
import { InMemoryPaymentRefundRepository } from '../../repositories/in-memory/payment-refund'
import type { Booking } from '../../stores'
import { PaymentService } from './payment'
import {
  type CheckoutSession,
  type CreateCheckoutParams,
  type PaymentGateway,
  type RefundParams,
  RefundRejectedError,
  type StripeRefund,
  type VerifiedPaymentEvent,
} from './payment-gateway'

const RENTER: CallerContext = { userId: 'renter-1', role: 'RENTER', bypassScope: false }
const WEB_BASE = 'https://app.example.com'

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
    status: 'CONFIRMED',
    source: 'DIRECT',
    bookingCode: 'ABCD2345',
    insuranceOptionId: null,
    insuranceSnapshot: null,
    feeSnapshot: [],
    addOnSnapshot: [],
    externalId: null,
    notes: null,
    totalPrice: 100_000,
    cancellationFee: null,
    cancellationFeeSettlement: 'ADVISORY',
    cancelledAt: null,
    idempotencyKey: null,
    disclaimerAcknowledgedAt: null,
    disclaimerTermsVersion: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

// Configurable fake gateway: returns a fixed session URL; parseWebhookEvent
// echoes a programmable event and throws when told to (bad signature).
class FakeGateway implements PaymentGateway {
  lastCheckout?: CreateCheckoutParams
  nextEvent: VerifiedPaymentEvent | (() => never) = () => {
    throw new Error('no event programmed')
  }

  async createCheckoutSession(p: CreateCheckoutParams): Promise<CheckoutSession> {
    this.lastCheckout = p
    return { sessionId: 'cs_test_1', url: 'https://checkout.stripe.com/cs_test_1' }
  }

  async parseWebhookEvent(): Promise<VerifiedPaymentEvent> {
    const ev = this.nextEvent
    if (typeof ev === 'function') return ev() // throws (simulates bad signature)
    return ev
  }

  // Refund surface: refundPayment is programmable so the #1378 amount-mismatch
  // auto-refund path can be driven and asserted. retrieve/list stay throwing —
  // the mismatch path refunds DIRECTLY (no receipt ledger, no adopt), so they're
  // never reached from these webhook tests.
  refundCalls: RefundParams[] = []
  nextRefund: StripeRefund | (() => never) = () => {
    throw new Error('no refund programmed')
  }
  async refundPayment(p: RefundParams): Promise<StripeRefund> {
    this.refundCalls.push(p)
    const r = this.nextRefund
    return typeof r === 'function' ? r() : r
  }
  async retrieveRefund(): Promise<never> {
    throw new Error('no refund programmed')
  }
  async listRefundsByPaymentIntent(): Promise<never> {
    throw new Error('no refund programmed')
  }
}

function completedEvent(overrides: Partial<VerifiedPaymentEvent> = {}): VerifiedPaymentEvent {
  return {
    eventId: 'evt_1',
    type: 'checkout.session.completed',
    checkoutSessionId: 'cs_test_1',
    paymentIntentId: 'pi_1',
    amountTotal: 100_000,
    currency: 'jpy',
    paymentStatus: 'paid',
    refundStatus: null,
    refundId: null,
    metadata: { bookingId: 'bk-1', operatorId: 'spoofed-operator' },
    ...overrides,
  }
}

// A narrowed Stripe Refund the fake hands back from refundPayment (#1378 mismatch
// auto-refund). Defaults to a succeeded full refund of the mismatched charge.
function stripeRefund(o: Partial<StripeRefund> = {}): StripeRefund {
  return {
    id: 're_mismatch_1',
    amount: 99_999,
    currency: 'jpy',
    status: 'succeeded',
    paymentIntentId: 'pi_1',
    metadata: { bookingId: 'bk-1' },
    ...o,
  }
}

// A Stripe `refund.updated` event narrowed to the vendor-neutral view (#851). The
// refund id rides in the object-id slot; `metadata.bookingId` is the correlation key
// we set at refundPayment time; `refundStatus` drives the confirm.
function refundEvent(overrides: Partial<VerifiedPaymentEvent> = {}): VerifiedPaymentEvent {
  return {
    eventId: 'evt_refund_1',
    type: 'refund.updated',
    checkoutSessionId: 're_1',
    paymentIntentId: 'pi_1',
    amountTotal: null,
    currency: 'jpy',
    paymentStatus: null,
    refundStatus: 'succeeded',
    refundId: 're_1',
    metadata: { bookingId: 'bk-1' },
    ...overrides,
  }
}

describe('PaymentService.createCheckoutSession', () => {
  let bookings: Map<string, Booking>
  let bookingRepo: InMemoryBookingRepository
  let paymentRepo: InMemoryPaymentEventRepository
  let anomalyRepo: InMemoryPaymentAnomalyRepository
  let gateway: FakeGateway
  let service: PaymentService

  beforeEach(() => {
    bookings = new Map([['bk-1', makeBooking()]])
    bookingRepo = new InMemoryBookingRepository(bookings)
    paymentRepo = new InMemoryPaymentEventRepository()
    anomalyRepo = new InMemoryPaymentAnomalyRepository()
    gateway = new FakeGateway()
    service = new PaymentService(
      paymentRepo,
      new InMemoryPaymentRefundRepository(),
      bookingRepo,
      gateway,
      anomalyRepo,
      {
        webBaseUrl: WEB_BASE,
      },
    )
  })

  it('creates a session for the booking total with bookingId + operatorId metadata', async () => {
    const result = await service.createCheckoutSession(RENTER, 'bk-1')
    expect(result).toEqual({ ok: true, url: 'https://checkout.stripe.com/cs_test_1' })
    expect(gateway.lastCheckout).toMatchObject({
      bookingId: 'bk-1',
      operatorId: 'op-1',
      amountJpy: 100_000,
      bookingCode: 'ABCD2345',
      // P1: deterministic per (booking, amount) so concurrent POSTs dedupe to one session.
      idempotencyKey: 'checkout:bk-1:100000',
    })
    // P2: a live root path (not a hardcoded /bookings/:code that 404s) carrying the code.
    expect(gateway.lastCheckout?.successUrl).toBe(
      'https://app.example.com/?payment=success&booking=ABCD2345',
    )
    expect(gateway.lastCheckout?.cancelUrl).toBe(
      'https://app.example.com/?payment=cancelled&booking=ABCD2345',
    )
  })

  it('uses the same idempotency key across repeated checkout requests', async () => {
    await service.createCheckoutSession(RENTER, 'bk-1')
    const first = gateway.lastCheckout?.idempotencyKey
    await service.createCheckoutSession(RENTER, 'bk-1')
    expect(gateway.lastCheckout?.idempotencyKey).toBe(first)
  })

  it('404s when the booking is not visible to the caller', async () => {
    const result = await service.createCheckoutSession(
      { userId: 'other', role: 'RENTER', bypassScope: false },
      'bk-1',
    )
    expect(result).toEqual({ ok: false, status: 404, error: expect.any(String) })
  })

  it('409s a cancelled booking', async () => {
    bookings.set('bk-1', makeBooking({ status: 'CANCELLED' }))
    const result = await service.createCheckoutSession(RENTER, 'bk-1')
    expect(result).toMatchObject({ ok: false, status: 409 })
  })

  it('422s a non-positive or non-integer total', async () => {
    bookings.set('bk-1', makeBooking({ totalPrice: 0 }))
    expect(await service.createCheckoutSession(RENTER, 'bk-1')).toMatchObject({ status: 422 })
    bookings.set('bk-1', makeBooking({ totalPrice: null }))
    expect(await service.createCheckoutSession(RENTER, 'bk-1')).toMatchObject({ status: 422 })
    bookings.set('bk-1', makeBooking({ totalPrice: 100.5 }))
    expect(await service.createCheckoutSession(RENTER, 'bk-1')).toMatchObject({ status: 422 })
  })

  it('409s a booking that is already paid', async () => {
    await paymentRepo.insert({
      operatorId: 'op-1',
      bookingId: 'bk-1',
      stripeEventId: 'evt_old',
      stripeCheckoutSessionId: 'cs_old',
      stripePaymentIntentId: 'pi_old',
      grossJpy: 100_000,
      platformFeeJpy: 4_000,
      netToPartnerJpy: 96_000,
      currency: 'jpy',
      status: 'SUCCEEDED',
    })
    const result = await service.createCheckoutSession(RENTER, 'bk-1')
    expect(result).toMatchObject({ ok: false, status: 409 })
  })
})

describe('PaymentService.handleWebhook', () => {
  let bookings: Map<string, Booking>
  let bookingRepo: InMemoryBookingRepository
  let paymentRepo: InMemoryPaymentEventRepository
  let anomalyRepo: InMemoryPaymentAnomalyRepository
  let gateway: FakeGateway
  let service: PaymentService

  beforeEach(() => {
    bookings = new Map([['bk-1', makeBooking()]])
    bookingRepo = new InMemoryBookingRepository(bookings)
    paymentRepo = new InMemoryPaymentEventRepository()
    anomalyRepo = new InMemoryPaymentAnomalyRepository()
    gateway = new FakeGateway()
    service = new PaymentService(
      paymentRepo,
      new InMemoryPaymentRefundRepository(),
      bookingRepo,
      gateway,
      anomalyRepo,
      {
        webBaseUrl: WEB_BASE,
      },
    )
  })

  it('records a payment_events row with re-derived operator + 4% commission', async () => {
    gateway.nextEvent = completedEvent()
    const result = await service.handleWebhook('raw', 'sig')
    expect(result).toEqual({ status: 200, outcome: 'recorded' })

    const row = await paymentRepo.findSucceededByBookingId('bk-1')
    expect(row).toMatchObject({
      operatorId: 'op-1', // re-derived from booking, NOT the spoofed metadata
      grossJpy: 100_000,
      platformFeeJpy: 4_000,
      netToPartnerJpy: 96_000,
      stripeEventId: 'evt_1',
      stripeCheckoutSessionId: 'cs_test_1',
    })
  })

  it('returns 400 + records nothing on an invalid signature', async () => {
    gateway.nextEvent = () => {
      throw new Error('bad sig')
    }
    const result = await service.handleWebhook('raw', 'bad')
    expect(result).toEqual({ status: 400, outcome: 'invalid_signature' })
    expect(await paymentRepo.findSucceededByBookingId('bk-1')).toBeNull()
  })

  it('ignores non-completed event types', async () => {
    gateway.nextEvent = completedEvent({ type: 'payment_intent.created' })
    expect(await service.handleWebhook('raw', 'sig')).toEqual({ status: 200, outcome: 'ignored' })
    expect(await paymentRepo.findSucceededByBookingId('bk-1')).toBeNull()
  })

  it('ignores a completed session that is not paid', async () => {
    gateway.nextEvent = completedEvent({ paymentStatus: 'unpaid' })
    expect(await service.handleWebhook('raw', 'sig')).toMatchObject({ outcome: 'ignored' })
    expect(await paymentRepo.findSucceededByBookingId('bk-1')).toBeNull()
  })

  it('ignores an event whose booking does not exist', async () => {
    gateway.nextEvent = completedEvent({ metadata: { bookingId: 'ghost' } })
    expect(await service.handleWebhook('raw', 'sig')).toMatchObject({ outcome: 'ignored' })
  })

  it('rejects an amount that does not match the booking total, carrying reconciliation context', async () => {
    gateway.nextEvent = completedEvent({ amountTotal: 99_999 })
    gateway.nextRefund = stripeRefund({ amount: 99_999 })
    const result = await service.handleWebhook('raw', 'sig')
    expect(result.status).toBe(200)
    expect(result.outcome).toBe('amount_mismatch')
    // P1b: the anomaly carries the identifiers an operator needs to investigate.
    expect(result.context).toMatchObject({
      eventId: 'evt_1',
      checkoutSessionId: 'cs_test_1',
      paymentIntentId: 'pi_1',
      bookingId: 'bk-1',
      amountTotal: 99_999,
      expectedAmountJpy: 100_000,
    })
    expect(await paymentRepo.findSucceededByBookingId('bk-1')).toBeNull()
  })

  it('auto-refunds the captured charge on an amount mismatch, never stranding funds (#1378)', async () => {
    gateway.nextEvent = completedEvent({ amountTotal: 99_999 })
    gateway.nextRefund = stripeRefund({ amount: 99_999 })
    const result = await service.handleWebhook('raw', 'sig')
    expect(result.outcome).toBe('amount_mismatch')
    // The disposition is surfaced so the route can alert on an UNRESOLVED refund.
    expect(result.refund).toBe('refunded')
    // The FULL captured (wrong) amount is refunded against the charge's paymentIntent.
    expect(gateway.refundCalls).toEqual([
      expect.objectContaining({
        paymentIntentId: 'pi_1',
        amountJpy: 99_999,
        // The dedup key MUST be namespaced away from #851's `refund:${bookingId}`:
        // a collision would cross-fire the cancellation refund's idempotency (same
        // booking, different params → Stripe reuse error). This assertion pins it.
        idempotencyKey: 'refund:mismatch:evt_1',
        metadata: { bookingId: 'bk-1' },
      }),
    ])
    // Booking legitimately stays UNPAID — we refused a wrong amount, we didn't book it.
    expect(await paymentRepo.findSucceededByBookingId('bk-1')).toBeNull()
  })

  it('rejects a non-JPY currency and refunds the foreign-currency charge', async () => {
    gateway.nextEvent = completedEvent({ currency: 'usd' })
    gateway.nextRefund = stripeRefund({ amount: 100_000 })
    const result = await service.handleWebhook('raw', 'sig')
    expect(result).toMatchObject({ outcome: 'amount_mismatch', refund: 'refunded' })
    expect(gateway.refundCalls).toHaveLength(1)
  })

  it('flags a mismatch as unrefundable when Stripe reported no PaymentIntent (nothing to refund)', async () => {
    gateway.nextEvent = completedEvent({ amountTotal: 99_999, paymentIntentId: null })
    const result = await service.handleWebhook('raw', 'sig')
    expect(result).toMatchObject({ outcome: 'amount_mismatch', refund: 'unrefundable' })
    // Never call Stripe when there's no PI to refund against; the anomaly is the surface.
    expect(gateway.refundCalls).toEqual([])
  })

  it('flags the refund as failed when Stripe TERMINALLY rejects it (funds may still be stranded)', async () => {
    gateway.nextEvent = completedEvent({ amountTotal: 99_999 })
    gateway.nextRefund = () => {
      throw new RefundRejectedError('charge already refunded', 'charge_already_refunded')
    }
    const result = await service.handleWebhook('raw', 'sig')
    expect(result).toMatchObject({ outcome: 'amount_mismatch', refund: 'failed' })
  })

  it('flags the refund as failed when Stripe RETURNS a failed status (not thrown)', async () => {
    gateway.nextEvent = completedEvent({ amountTotal: 99_999 })
    gateway.nextRefund = stripeRefund({ amount: 99_999, status: 'failed' })
    const result = await service.handleWebhook('raw', 'sig')
    // A non-thrown 'failed'/'canceled' refund must NOT be softened to 'pending':
    // captured funds did not move, so the route has to alert LOUD, not warn.
    expect(result).toMatchObject({ outcome: 'amount_mismatch', refund: 'failed' })
  })

  it('flags the refund as failed when Stripe RETURNS a canceled status', async () => {
    gateway.nextEvent = completedEvent({ amountTotal: 99_999 })
    gateway.nextRefund = stripeRefund({ amount: 99_999, status: 'canceled' })
    const result = await service.handleWebhook('raw', 'sig')
    expect(result).toMatchObject({ outcome: 'amount_mismatch', refund: 'failed' })
  })

  it('propagates a TRANSIENT refund error so the webhook 500s and Stripe retries (never a silent strand)', async () => {
    gateway.nextEvent = completedEvent({ amountTotal: 99_999 })
    gateway.nextRefund = () => {
      throw new Error('stripe 503 timeout')
    }
    await expect(service.handleWebhook('raw', 'sig')).rejects.toThrow('stripe 503 timeout')
    // The anomaly was still captured before the refund attempt threw.
    expect(await anomalyRepo.listUnresolved()).toHaveLength(1)
    // Stripe retries the same event; the refund now succeeds and the anomaly stays
    // single (recordAnomaly is idempotent on stripeEventId) — the retry converges.
    gateway.nextRefund = stripeRefund({ amount: 99_999 })
    expect(await service.handleWebhook('raw', 'sig')).toMatchObject({ refund: 'refunded' })
    expect(await anomalyRepo.listUnresolved()).toHaveLength(1)
  })

  it('surfaces a pending refund (async settlement) so the route does not alert as stranded', async () => {
    gateway.nextEvent = completedEvent({ amountTotal: 99_999 })
    gateway.nextRefund = stripeRefund({ amount: 99_999, status: 'pending' })
    const result = await service.handleWebhook('raw', 'sig')
    expect(result).toMatchObject({ outcome: 'amount_mismatch', refund: 'pending' })
  })

  it('rejects a null amount even against a booking with no total (no null===null match)', async () => {
    bookings.set('bk-1', makeBooking({ totalPrice: null }))
    gateway.nextEvent = completedEvent({ amountTotal: null })
    // A null amount has nothing to refund against → 'unrefundable' (the anomaly is the
    // human surface), and Stripe is never called.
    expect(await service.handleWebhook('raw', 'sig')).toMatchObject({
      outcome: 'amount_mismatch',
      refund: 'unrefundable',
    })
    expect(gateway.refundCalls).toEqual([])
    expect(await paymentRepo.findSucceededByBookingId('bk-1')).toBeNull()
  })

  it('flags a zero-amount mismatch as unrefundable (nothing to refund, never calls Stripe)', async () => {
    gateway.nextEvent = completedEvent({ amountTotal: 0 })
    expect(await service.handleWebhook('raw', 'sig')).toMatchObject({
      outcome: 'amount_mismatch',
      refund: 'unrefundable',
    })
    expect(gateway.refundCalls).toEqual([])
  })

  it('is idempotent on a redelivered event (no duplicate row)', async () => {
    gateway.nextEvent = completedEvent()
    await service.handleWebhook('raw', 'sig')
    const second = await service.handleWebhook('raw', 'sig')
    expect(second).toMatchObject({ status: 200, outcome: 'duplicate' })
  })

  it('records a payment from async_payment_succeeded (konbini/bank transfer)', async () => {
    // Delayed JP methods complete the Checkout Session `unpaid`, then settle later via
    // a SEPARATE checkout.session.async_payment_succeeded event whose session is `paid`.
    // It must record the payment exactly like a card `completed` — else captured funds
    // never mark the booking paid (#payment-review LOW-1).
    gateway.nextEvent = completedEvent({
      type: 'checkout.session.async_payment_succeeded',
      eventId: 'evt_async',
      checkoutSessionId: 'cs_async',
    })
    const result = await service.handleWebhook('raw', 'sig')
    expect(result.outcome).toBe('recorded')
    const paid = await paymentRepo.findSucceededByBookingId('bk-1')
    expect(paid?.stripeEventId).toBe('evt_async')
    expect(paid?.grossJpy).toBe(100_000)
  })

  it('ignores async_payment_failed (delayed payment never settled, no row)', async () => {
    gateway.nextEvent = completedEvent({
      type: 'checkout.session.async_payment_failed',
      paymentStatus: 'unpaid',
      eventId: 'evt_async_fail',
    })
    expect((await service.handleWebhook('raw', 'sig')).outcome).toBe('ignored')
    expect(await paymentRepo.findSucceededByBookingId('bk-1')).toBeNull()
  })

  it('flags a SECOND distinct session as double-payment, carrying the paymentIntent to refund', async () => {
    gateway.nextEvent = completedEvent()
    await service.handleWebhook('raw', 'sig')
    // A wholly different Stripe event + session + paymentIntent, same booking.
    gateway.nextEvent = completedEvent({
      eventId: 'evt_2',
      checkoutSessionId: 'cs_test_2',
      paymentIntentId: 'pi_2',
    })
    const result = await service.handleWebhook('raw', 'sig')
    expect(result.status).toBe(200)
    expect(result.outcome).toBe('double_payment')
    // P1b: without pi_2 the operator can't refund the duplicate charge.
    expect(result.context).toMatchObject({
      paymentIntentId: 'pi_2',
      checkoutSessionId: 'cs_test_2',
    })
  })

  // #508 P2: anomalies are now PERSISTED (not just logged), so the admin surface
  // can list duplicate charges to refund instead of scraping logs.
  it('persists an AMOUNT_MISMATCH anomaly carrying received + expected amounts', async () => {
    gateway.nextEvent = completedEvent({ amountTotal: 99_999 })
    gateway.nextRefund = stripeRefund({ amount: 99_999 })
    await service.handleWebhook('raw', 'sig')

    const anomalies = await anomalyRepo.listUnresolved()
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]).toMatchObject({
      kind: 'AMOUNT_MISMATCH',
      operatorId: 'op-1', // re-derived from the booking, never the spoofed metadata
      bookingId: 'bk-1',
      stripeEventId: 'evt_1',
      stripeCheckoutSessionId: 'cs_test_1',
      stripePaymentIntentId: 'pi_1',
      receivedAmountJpy: 99_999,
      expectedAmountJpy: 100_000,
      currency: 'jpy',
    })
  })

  it('persists a DOUBLE_PAYMENT anomaly carrying the duplicate paymentIntent to refund', async () => {
    gateway.nextEvent = completedEvent()
    await service.handleWebhook('raw', 'sig')
    gateway.nextEvent = completedEvent({
      eventId: 'evt_2',
      checkoutSessionId: 'cs_test_2',
      paymentIntentId: 'pi_2',
    })
    await service.handleWebhook('raw', 'sig')

    const anomalies = await anomalyRepo.listUnresolved()
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]).toMatchObject({
      kind: 'DOUBLE_PAYMENT',
      operatorId: 'op-1',
      bookingId: 'bk-1',
      stripeEventId: 'evt_2',
      stripeCheckoutSessionId: 'cs_test_2',
      stripePaymentIntentId: 'pi_2',
      receivedAmountJpy: 100_000,
      expectedAmountJpy: 100_000,
    })
  })

  it('records a single anomaly when an amount_mismatch webhook is redelivered (idempotent)', async () => {
    gateway.nextEvent = completedEvent({ amountTotal: 99_999 })
    gateway.nextRefund = stripeRefund({ amount: 99_999 })
    await service.handleWebhook('raw', 'sig')
    await service.handleWebhook('raw', 'sig') // same evt_1 redelivered
    expect(await anomalyRepo.listUnresolved()).toHaveLength(1)
  })

  it('records a single anomaly when a double_payment webhook is redelivered (idempotent)', async () => {
    gateway.nextEvent = completedEvent()
    await service.handleWebhook('raw', 'sig') // evt_1 recorded
    const second = completedEvent({
      eventId: 'evt_2',
      checkoutSessionId: 'cs_test_2',
      paymentIntentId: 'pi_2',
    })
    gateway.nextEvent = second
    await service.handleWebhook('raw', 'sig') // evt_2 → double_payment, 1 anomaly
    await service.handleWebhook('raw', 'sig') // evt_2 redelivered → no stack

    const anomalies = await anomalyRepo.listUnresolved()
    expect(anomalies).toHaveLength(1)
    expect(anomalies[0]).toMatchObject({ kind: 'DOUBLE_PAYMENT', stripeEventId: 'evt_2' })
  })

  it('records no anomaly for a clean recorded payment', async () => {
    gateway.nextEvent = completedEvent()
    await service.handleWebhook('raw', 'sig')
    expect(await anomalyRepo.listUnresolved()).toEqual([])
  })

  it('records no anomaly for an ignored (unpaid) event', async () => {
    gateway.nextEvent = completedEvent({ paymentStatus: 'unpaid' })
    await service.handleWebhook('raw', 'sig')
    expect(await anomalyRepo.listUnresolved()).toEqual([])
  })
})

describe('PaymentService.handleWebhook — refund confirmation (#851)', () => {
  let bookings: Map<string, Booking>
  let bookingRepo: InMemoryBookingRepository
  let refundRepo: InMemoryPaymentRefundRepository
  let gateway: FakeGateway
  let service: PaymentService

  beforeEach(async () => {
    bookings = new Map([
      // The cancel tx (Slice 3) commits REFUND_DUE before any Stripe call.
      ['bk-1', makeBooking({ status: 'CANCELLED', cancellationFeeSettlement: 'REFUND_DUE' })],
    ])
    bookingRepo = new InMemoryBookingRepository(bookings)
    refundRepo = new InMemoryPaymentRefundRepository()
    gateway = new FakeGateway()
    service = new PaymentService(
      new InMemoryPaymentEventRepository(),
      refundRepo,
      bookingRepo,
      gateway,
      new InMemoryPaymentAnomalyRepository(),
      { webBaseUrl: WEB_BASE },
    )
    // The eager fire already claimed a PENDING receipt + attached re_1 before Stripe.
    await refundRepo.claim({
      bookingId: 'bk-1',
      operatorId: 'op-1',
      stripePaymentIntentId: 'pi_1',
      amountJpy: 70_000,
    })
    await refundRepo.attachStripeRefund('bk-1', 're_1')
  })

  const settlement = async (): Promise<string | undefined> =>
    (await bookingRepo.findById(RENTER, 'bk-1'))?.cancellationFeeSettlement

  it('confirms a succeeded refund: receipt SUCCEEDED + booking REFUND_DUE → REFUNDED', async () => {
    gateway.nextEvent = refundEvent()
    const result = await service.handleWebhook('raw', 'sig')
    expect(result).toEqual({ status: 200, outcome: 'refund_confirmed' })
    expect((await refundRepo.findByBookingId('bk-1'))?.status).toBe('SUCCEEDED')
    expect(await settlement()).toBe('REFUNDED')
  })

  it('ignores a non-succeeded (pending) refund — leaves the receipt and booking untouched', async () => {
    gateway.nextEvent = refundEvent({ refundStatus: 'pending' })
    expect(await service.handleWebhook('raw', 'sig')).toEqual({ status: 200, outcome: 'ignored' })
    expect((await refundRepo.findByBookingId('bk-1'))?.status).toBe('PENDING')
    expect(await settlement()).toBe('REFUND_DUE')
  })

  it('ignores a succeeded refund whose booking does not exist (unknown bookingId)', async () => {
    gateway.nextEvent = refundEvent({ metadata: { bookingId: 'ghost' } })
    expect(await service.handleWebhook('raw', 'sig')).toEqual({ status: 200, outcome: 'ignored' })
    // bk-1 untouched — a foreign refund event can never advance our booking.
    expect((await refundRepo.findByBookingId('bk-1'))?.status).toBe('PENDING')
    expect(await settlement()).toBe('REFUND_DUE')
  })

  it('is idempotent on a redelivered succeeded refund: second delivery flips 0 rows, no regression', async () => {
    gateway.nextEvent = refundEvent()
    await service.handleWebhook('raw', 'sig')
    // Stripe redelivers the same event — the receipt is already SUCCEEDED (forward-only)
    // and the booking already REFUNDED (the REFUND_DUE guard now matches 0 rows).
    const second = await service.handleWebhook('raw', 'sig')
    expect(second).toEqual({ status: 200, outcome: 'refund_confirmed' })
    expect((await refundRepo.findByBookingId('bk-1'))?.status).toBe('SUCCEEDED')
    expect(await settlement()).toBe('REFUNDED')
  })

  it('ignores a succeeded refund whose id does not match our receipt — a foreign/partial refund cannot flip the booking (#1056)', async () => {
    // An operator issues a manual/partial Stripe refund tagged with our bookingId; it
    // carries a DIFFERENT re_ than the one we recorded. A valid signature proves the
    // event is Stripe's — not that this refund is the one we owe.
    gateway.nextEvent = refundEvent({ refundId: 're_foreign', checkoutSessionId: 're_foreign' })
    expect(await service.handleWebhook('raw', 'sig')).toEqual({ status: 200, outcome: 'ignored' })
    expect((await refundRepo.findByBookingId('bk-1'))?.status).toBe('PENDING')
    expect(await settlement()).toBe('REFUND_DUE')
  })

  it('ignores a succeeded refund when no receipt has been claimed yet — the eager/reconciler path owns confirmation (#1056)', async () => {
    // Webhook beats the eager claim: there is no receipt to correlate against, so the
    // booking must NOT be flipped here; the path that creates the receipt confirms it.
    const fresh = new InMemoryPaymentRefundRepository()
    const noReceiptService = new PaymentService(
      new InMemoryPaymentEventRepository(),
      fresh,
      bookingRepo,
      gateway,
      new InMemoryPaymentAnomalyRepository(),
      { webBaseUrl: WEB_BASE },
    )
    gateway.nextEvent = refundEvent()
    expect(await noReceiptService.handleWebhook('raw', 'sig')).toEqual({
      status: 200,
      outcome: 'ignored',
    })
    expect(await fresh.findByBookingId('bk-1')).toBeNull()
    expect(await settlement()).toBe('REFUND_DUE')
  })

  it('ignores a succeeded refund when both ids are null — null !== null is false, the reconciler owns confirmation (#1059 review HIGH)', async () => {
    // A receipt claimed BEFORE the re_ was attached (pre-PR row, or a webhook race) has
    // `stripeRefundId: null`. A `refund.updated` body lacking `obj.id` (Stripe API drift,
    // replay tooling) parses to `event.refundId: null`. Without the explicit null guard,
    // `receipt.stripeRefundId !== event.refundId` is `null !== null` → false → the
    // booking would silently flip REFUNDED on an unverifiable refund — exactly the
    // surface this PR was opened to close.
    const fresh = new InMemoryPaymentRefundRepository()
    const noAttachService = new PaymentService(
      new InMemoryPaymentEventRepository(),
      fresh,
      bookingRepo,
      gateway,
      new InMemoryPaymentAnomalyRepository(),
      { webBaseUrl: WEB_BASE },
    )
    // Claim WITHOUT attachStripeRefund → receipt.stripeRefundId stays null.
    await fresh.claim({
      bookingId: 'bk-1',
      operatorId: 'op-1',
      stripePaymentIntentId: 'pi_1',
      amountJpy: 70_000,
    })
    gateway.nextEvent = refundEvent({ refundId: null })
    expect(await noAttachService.handleWebhook('raw', 'sig')).toEqual({
      status: 200,
      outcome: 'ignored',
    })
    expect((await fresh.findByBookingId('bk-1'))?.status).toBe('PENDING')
    expect(await settlement()).toBe('REFUND_DUE')
  })
})

describe('PaymentService.getBookingPaymentStatus', () => {
  it('reflects PAID only after a recorded payment, scoped to the caller', async () => {
    const bookings = new Map([['bk-1', makeBooking()]])
    const bookingRepo = new InMemoryBookingRepository(bookings)
    const paymentRepo = new InMemoryPaymentEventRepository()
    const anomalyRepo = new InMemoryPaymentAnomalyRepository()
    const gateway = new FakeGateway()
    const service = new PaymentService(
      paymentRepo,
      new InMemoryPaymentRefundRepository(),
      bookingRepo,
      gateway,
      anomalyRepo,
      {
        webBaseUrl: WEB_BASE,
      },
    )

    expect(await service.getBookingPaymentStatus(RENTER, 'bk-1')).toEqual({ status: 'UNPAID' })
    gateway.nextEvent = completedEvent()
    await service.handleWebhook('raw', 'sig')
    expect(await service.getBookingPaymentStatus(RENTER, 'bk-1')).toEqual({ status: 'PAID' })
    // Not visible to a different renter -> null (route maps to 404).
    expect(
      await service.getBookingPaymentStatus(
        { userId: 'other', role: 'RENTER', bypassScope: false },
        'bk-1',
      ),
    ).toBeNull()
  })
})
