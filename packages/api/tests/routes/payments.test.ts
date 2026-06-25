import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { setupGlobalHandlers } from '../../src/error-handlers'
import { type UserRole, requireAuth } from '../../src/middleware/auth'
import { InMemoryBookingRepository } from '../../src/repositories/in-memory/booking'
import { InMemoryPaymentAnomalyRepository } from '../../src/repositories/in-memory/payment-anomaly'
import { InMemoryPaymentEventRepository } from '../../src/repositories/in-memory/payment-event'
import { InMemoryPaymentRefundRepository } from '../../src/repositories/in-memory/payment-refund'
import { createPaymentRoutes } from '../../src/routes/payments'
import { PaymentService } from '../../src/services/payment/payment'
import type {
  CheckoutSession,
  CreateCheckoutParams,
  PaymentGateway,
  VerifiedPaymentEvent,
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
  // Refund surface (#851) is unused by these checkout/webhook route tests.
  async refundPayment(): Promise<never> {
    throw new Error('no refund programmed')
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
  metadata: { bookingId: BOOKING_ID },
})

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
