import { Hono } from 'hono'
import { describe, expect, it, vi } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import { type UserRole, requireAuth } from '../../src/middleware/auth'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryPaymentAnomalyRepository } from '../../src/repositories/in-memory/payment-anomaly'
import { InMemoryPaymentEventRepository } from '../../src/repositories/in-memory/payment-event'
import { InMemoryPaymentRefundRepository } from '../../src/repositories/in-memory/payment-refund'
import { createPaymentRoutes } from '../../src/routes/payments'
import { PaymentService } from '../../src/services/payment/payment'
import {
  type CheckoutSession,
  type CreateCheckoutParams,
  type PaymentGateway,
  type RefundParams,
  RefundRejectedError,
  type StripeRefund,
  type VerifiedPaymentEvent,
} from '../../src/services/payment/payment-gateway'
import type { Booking } from '../../src/stores'
import { testAuthMiddleware } from '../helpers/auth'
import { makeBooking as makeBookingFixture } from '../helpers/booking'

// Bookings carry DB-generated UUIDs; the route now validates `:bookingId` as a
// uuid at the boundary (#691), so the fixture id must be a real uuid too.
const BOOKING_ID = '00000000-0000-4000-8000-0000000000b1'

function makeBooking(): Booking {
  const now = new Date('2026-06-09T00:00:00Z')
  return makeBookingFixture({
    id: BOOKING_ID,
    classId: 'cls-1',
    startAt: now,
    endAt: now,
    effectiveEndAt: now,
    bookingCode: 'ABCD2345',
    totalPrice: 100_000,
    createdAt: now,
    updatedAt: now,
  })
}

class StubGateway implements PaymentGateway {
  event: VerifiedPaymentEvent | null = null
  async createCheckoutSession(_p: CreateCheckoutParams): Promise<CheckoutSession> {
    return { sessionId: 'cs_1', url: 'https://checkout.stripe.com/cs_1' }
  }
  async parseWebhookEvent(): Promise<VerifiedPaymentEvent> {
    if (!this.event) throw new Error('bad signature')
    return this.event
  }
  // Refund surface: programmable so the #1378 amount-mismatch auto-refund + alert
  // path can be driven at the route boundary. retrieve/list stay unused here.
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

function setup(role: UserRole = 'RENTER', userId = 'renter-1') {
  const bookings = new Map([[BOOKING_ID, makeBooking()]])
  const bookingRepo = new InMemoryBookingRepository(bookings)
  const paymentRepo = new InMemoryPaymentEventRepository()
  const gateway = new StubGateway()
  const service = new PaymentService(
    paymentRepo,
    new InMemoryPaymentRefundRepository(),
    bookingRepo,
    gateway,
    new InMemoryPaymentAnomalyRepository(),
    { webBaseUrl: 'https://app.example.com' },
  )
  const app = new Hono()
  setupGlobalHandlers(app)
  app.use('*', testAuthMiddleware(userId, role))
  app.route('/', createPaymentRoutes(service))
  return { app, gateway, paymentRepo }
}

function publicApp() {
  // Webhook must work with NO auth middleware mounted (Stripe is unauthenticated).
  const bookingRepo = new InMemoryBookingRepository(new Map([[BOOKING_ID, makeBooking()]]))
  const paymentRepo = new InMemoryPaymentEventRepository()
  const gateway = new StubGateway()
  const service = new PaymentService(
    paymentRepo,
    new InMemoryPaymentRefundRepository(),
    bookingRepo,
    gateway,
    new InMemoryPaymentAnomalyRepository(),
    { webBaseUrl: 'https://app.example.com' },
  )
  const app = new Hono()
  setupGlobalHandlers(app)
  app.route('/', createPaymentRoutes(service))
  return { app, gateway, paymentRepo }
}

const completed = (): VerifiedPaymentEvent => ({
  eventId: 'evt_1',
  type: 'checkout.session.completed',
  checkoutSessionId: 'cs_1',
  paymentIntentId: 'pi_1',
  amountTotal: 100_000,
  currency: 'jpy',
  paymentStatus: 'paid',
  refundStatus: null,
  refundId: null,
  metadata: { bookingId: BOOKING_ID },
})

// A charge captured for the WRONG amount (99_999 vs the booking's 100_000) → #1378.
const mismatch = (): VerifiedPaymentEvent => ({
  ...completed(),
  eventId: 'evt_mm',
  amountTotal: 99_999,
})

const succeededRefund: StripeRefund = {
  id: 're_1',
  amount: 99_999,
  currency: 'jpy',
  status: 'succeeded',
  paymentIntentId: 'pi_1',
  metadata: { bookingId: BOOKING_ID },
}

describe('POST /bookings/:id/checkout-session', () => {
  it('401 when unauthenticated (relies on the app-level /bookings/* guard)', async () => {
    // Mirror index.ts: checkout sits under /bookings/*, guarded by requireAuth().
    const bookingRepo = new InMemoryBookingRepository(new Map([[BOOKING_ID, makeBooking()]]))
    const service = new PaymentService(
      new InMemoryPaymentEventRepository(),
      new InMemoryPaymentRefundRepository(),
      bookingRepo,
      new StubGateway(),
      new InMemoryPaymentAnomalyRepository(),
      { webBaseUrl: 'https://app.example.com' },
    )
    const app = new Hono()
    setupGlobalHandlers(app)
    app.use('/bookings/*', requireAuth())
    app.route('/', createPaymentRoutes(service))
    const res = await app.request(`/bookings/${BOOKING_ID}/checkout-session`, { method: 'POST' })
    expect(res.status).toBe(401)
  })

  it('returns the Stripe Checkout URL for the booking owner', async () => {
    const { app } = setup()
    const res = await app.request(`/bookings/${BOOKING_ID}/checkout-session`, { method: 'POST' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      success: true,
      data: { url: 'https://checkout.stripe.com/cs_1' },
    })
  })

  it('maps a non-owner to 404', async () => {
    const { app } = setup('RENTER', 'someone-else')
    const res = await app.request(`/bookings/${BOOKING_ID}/checkout-session`, { method: 'POST' })
    expect(res.status).toBe(404)
  })
})

describe('POST /webhooks/stripe (public)', () => {
  it('400 when the stripe-signature header is missing', async () => {
    const { app } = publicApp()
    const res = await app.request('/webhooks/stripe', { method: 'POST', body: '{}' })
    expect(res.status).toBe(400)
  })

  it('400 on an invalid signature, records nothing', async () => {
    const { app, paymentRepo } = publicApp()
    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 'bad' },
      body: '{}',
    })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ received: false })
    expect(await paymentRepo.findSucceededByBookingId(BOOKING_ID)).toBeNull()
  })

  it('200 + records a payment on a verified completed event', async () => {
    const { app, gateway, paymentRepo } = publicApp()
    gateway.event = completed()
    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=good' },
      body: 'raw-stripe-body',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ received: true })
    expect(await paymentRepo.findSucceededByBookingId(BOOKING_ID)).toMatchObject({
      grossJpy: 100_000,
    })
  })

  it('auto-refunds a mismatched charge and logs at WARNING level, not an alert (#1378)', async () => {
    const { app, gateway } = publicApp()
    gateway.event = mismatch()
    gateway.nextRefund = succeededRefund
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=good' },
      body: 'raw',
    })
    expect(res.status).toBe(200)
    expect(gateway.refundCalls).toHaveLength(1)
    // A clean auto-refund is NOT an alert.
    expect(error).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith(
      '[payment:webhook] amount mismatch',
      expect.objectContaining({ refund: 'refunded', stranded: false, bookingId: BOOKING_ID }),
    )
    warn.mockRestore()
    error.mockRestore()
  })

  it('ALERTS via console.error when the mismatch refund is rejected — funds may be stranded (#1378)', async () => {
    const { app, gateway } = publicApp()
    gateway.event = mismatch()
    gateway.nextRefund = () => {
      throw new RefundRejectedError('charge already refunded', 'charge_already_refunded')
    }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=good' },
      body: 'raw',
    })
    // Still a 200 ack (the anomaly + failed disposition are recorded, not re-driven here).
    expect(res.status).toBe(200)
    expect(error).toHaveBeenCalledWith(
      '[payment:webhook] amount mismatch',
      expect.objectContaining({ refund: 'failed', stranded: true, bookingId: BOOKING_ID }),
    )
    // A stranded alert must be an ALERT, not a soft warning.
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
    error.mockRestore()
  })

  it('ALERTS when a mismatch is unrefundable (no PaymentIntent to reverse) (#1378)', async () => {
    const { app, gateway } = publicApp()
    gateway.event = { ...mismatch(), paymentIntentId: null }
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=good' },
      body: 'raw',
    })
    expect(res.status).toBe(200)
    // No PI → we never call Stripe, but the funds are unaccounted → alert.
    expect(gateway.refundCalls).toEqual([])
    expect(error).toHaveBeenCalledWith(
      '[payment:webhook] amount mismatch',
      expect.objectContaining({ refund: 'unrefundable', stranded: true }),
    )
    error.mockRestore()
  })
})

describe('GET /bookings/:id/payment', () => {
  it('UNPAID before, PAID after the webhook', async () => {
    const { app, gateway } = setup()
    const before = await app.request(`/bookings/${BOOKING_ID}/payment`)
    expect(await before.json()).toEqual({ success: true, data: { status: 'UNPAID' } })

    gateway.event = completed()
    await app.request('/webhooks/stripe', {
      method: 'POST',
      headers: { 'stripe-signature': 't=1,v1=good' },
      body: 'raw',
    })
    const after = await app.request(`/bookings/${BOOKING_ID}/payment`)
    expect(await after.json()).toEqual({ success: true, data: { status: 'PAID' } })
  })
})
