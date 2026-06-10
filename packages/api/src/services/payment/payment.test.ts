import { beforeEach, describe, expect, it } from 'vitest'
import type { CallerContext } from '../../middleware/auth'
import { InMemoryBookingRepository } from '../../repositories/in-memory/booking'
import { InMemoryPaymentEventRepository } from '../../repositories/in-memory/payment-event'
import type { Booking } from '../../stores'
import { PaymentService } from './payment'
import type {
  CheckoutSession,
  CreateCheckoutParams,
  PaymentGateway,
  VerifiedPaymentEvent,
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
    cancelledAt: null,
    idempotencyKey: null,
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
    metadata: { bookingId: 'bk-1', operatorId: 'spoofed-operator' },
    ...overrides,
  }
}

describe('PaymentService.createCheckoutSession', () => {
  let bookings: Map<string, Booking>
  let bookingRepo: InMemoryBookingRepository
  let paymentRepo: InMemoryPaymentEventRepository
  let gateway: FakeGateway
  let service: PaymentService

  beforeEach(() => {
    bookings = new Map([['bk-1', makeBooking()]])
    bookingRepo = new InMemoryBookingRepository(bookings)
    paymentRepo = new InMemoryPaymentEventRepository()
    gateway = new FakeGateway()
    service = new PaymentService(paymentRepo, bookingRepo, gateway, { webBaseUrl: WEB_BASE })
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
  let gateway: FakeGateway
  let service: PaymentService

  beforeEach(() => {
    bookings = new Map([['bk-1', makeBooking()]])
    bookingRepo = new InMemoryBookingRepository(bookings)
    paymentRepo = new InMemoryPaymentEventRepository()
    gateway = new FakeGateway()
    service = new PaymentService(paymentRepo, bookingRepo, gateway, { webBaseUrl: WEB_BASE })
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

  it('rejects a non-JPY currency', async () => {
    gateway.nextEvent = completedEvent({ currency: 'usd' })
    expect(await service.handleWebhook('raw', 'sig')).toMatchObject({ outcome: 'amount_mismatch' })
  })

  it('rejects a null amount even against a booking with no total (no null===null match)', async () => {
    bookings.set('bk-1', makeBooking({ totalPrice: null }))
    gateway.nextEvent = completedEvent({ amountTotal: null })
    expect(await service.handleWebhook('raw', 'sig')).toMatchObject({ outcome: 'amount_mismatch' })
    expect(await paymentRepo.findSucceededByBookingId('bk-1')).toBeNull()
  })

  it('is idempotent on a redelivered event (no duplicate row)', async () => {
    gateway.nextEvent = completedEvent()
    await service.handleWebhook('raw', 'sig')
    const second = await service.handleWebhook('raw', 'sig')
    expect(second).toMatchObject({ status: 200, outcome: 'duplicate' })
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
})

describe('PaymentService.getBookingPaymentStatus', () => {
  it('reflects PAID only after a recorded payment, scoped to the caller', async () => {
    const bookings = new Map([['bk-1', makeBooking()]])
    const bookingRepo = new InMemoryBookingRepository(bookings)
    const paymentRepo = new InMemoryPaymentEventRepository()
    const gateway = new FakeGateway()
    const service = new PaymentService(paymentRepo, bookingRepo, gateway, { webBaseUrl: WEB_BASE })

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
