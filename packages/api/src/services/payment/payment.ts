import { computePlatformCommission } from '@kuruma/shared/lib/commission'
import { type CallerContext, SYSTEM_CONTEXT } from '../../middleware/auth'
import {
  PAYMENT_EVENT_ONE_SUCCESS_CONSTRAINT,
  PG_ERROR,
  pgConstraintName,
  pgErrorCode,
} from '../../pg-errors'
import type { BookingRepository, PaymentEventRepository } from '../../repositories/types'
import type { PaymentGateway } from './payment-gateway'

const CURRENCY = 'jpy'
const COMPLETED_EVENT = 'checkout.session.completed'
const PAID = 'paid'

export interface PaymentConfig {
  /** Origin the renter is redirected back to after Stripe Checkout. */
  webBaseUrl: string
}

export type CreateCheckoutResult =
  | { ok: true; url: string }
  | { ok: false; status: 404 | 409 | 422; error: string }

/** Why a webhook did or did not record a payment. The route logs on it (the
 *  service core stays side-effect-free and unit-testable). */
export type WebhookOutcome =
  | 'recorded' // a new payment_events row was written
  | 'duplicate' // a redelivered event/session — no-op
  | 'double_payment' // a DIFFERENT session already paid this booking — anomaly
  | 'amount_mismatch' // amount/currency != the booking snapshot — rejected
  | 'ignored' // wrong type / unpaid / missing or unknown booking
  | 'invalid_signature' // bad or stale Stripe signature

export interface WebhookResult {
  status: 200 | 400
  outcome: WebhookOutcome
}

export interface BookingPaymentStatus {
  status: 'PAID' | 'UNPAID'
}

/**
 * In-app Stripe payment of the rental total (#461). The signed webhook is the
 * SOURCE OF TRUTH; the client redirect never marks anything paid. This service
 * owns the money policy — the gateway is pure Stripe glue, the repo pure storage.
 */
export class PaymentService {
  constructor(
    private readonly paymentEvents: PaymentEventRepository,
    private readonly bookings: BookingRepository,
    private readonly gateway: PaymentGateway,
    private readonly config: PaymentConfig,
  ) {}

  async createCheckoutSession(
    ctx: CallerContext,
    bookingId: string,
  ): Promise<CreateCheckoutResult> {
    const booking = await this.bookings.findById(ctx, bookingId)
    if (!booking) return { ok: false, status: 404, error: 'Booking not found' }
    if (booking.status === 'CANCELLED') {
      return { ok: false, status: 409, error: 'Booking is cancelled' }
    }
    const amountJpy = booking.totalPrice
    if (amountJpy === null || !Number.isInteger(amountJpy) || amountJpy <= 0) {
      return { ok: false, status: 422, error: 'Booking total is not a positive integer JPY amount' }
    }
    // Close the double-pay window before it opens: never hand out a second
    // Checkout Session once a booking is already paid (the DB seal is the
    // backstop for a concurrent race).
    const existing = await this.paymentEvents.findSucceededByBookingId(bookingId)
    if (existing) return { ok: false, status: 409, error: 'Booking is already paid' }

    const base = this.config.webBaseUrl.replace(/\/$/, '')
    const url = `${base}/bookings/${booking.bookingCode}`
    const session = await this.gateway.createCheckoutSession({
      bookingId: booking.id,
      operatorId: booking.operatorId,
      amountJpy,
      bookingCode: booking.bookingCode,
      successUrl: `${url}?payment=success`,
      cancelUrl: `${url}?payment=cancelled`,
    })
    return { ok: true, url: session.url }
  }

  async handleWebhook(rawBody: string, signature: string): Promise<WebhookResult> {
    let event: Awaited<ReturnType<PaymentGateway['parseWebhookEvent']>>
    try {
      event = await this.gateway.parseWebhookEvent(rawBody, signature)
    } catch {
      // Bad/stale signature — return 400 so the forged delivery is rejected.
      return { status: 400, outcome: 'invalid_signature' }
    }

    if (event.type !== COMPLETED_EVENT || event.paymentStatus !== PAID) {
      return { status: 200, outcome: 'ignored' }
    }
    const bookingId = event.metadata.bookingId
    if (!bookingId) return { status: 200, outcome: 'ignored' }

    // SYSTEM_CONTEXT: Stripe is not an authenticated caller, so the booking is
    // loaded unscoped. Operator attribution is RE-DERIVED here — the metadata
    // operatorId is never trusted for money.
    const booking = await this.bookings.findById(SYSTEM_CONTEXT, bookingId)
    if (!booking) return { status: 200, outcome: 'ignored' }

    // Trust Stripe's amount over the client, but still assert it matches the
    // booking snapshot — a stale/buggy session must not record a wrong amount.
    // The explicit null check also closes the null===null hole (a booking with
    // no total can never match) and narrows amountTotal to a number below.
    if (
      event.amountTotal === null ||
      event.amountTotal !== booking.totalPrice ||
      event.currency !== CURRENCY
    ) {
      return { status: 200, outcome: 'amount_mismatch' }
    }

    const grossJpy = event.amountTotal
    const { platformFeeJpy, netToPartnerJpy } = computePlatformCommission(grossJpy)
    try {
      await this.paymentEvents.insert({
        operatorId: booking.operatorId,
        bookingId: booking.id,
        stripeEventId: event.eventId,
        stripeCheckoutSessionId: event.checkoutSessionId,
        stripePaymentIntentId: event.paymentIntentId,
        grossJpy,
        platformFeeJpy,
        netToPartnerJpy,
        currency: CURRENCY,
        status: 'SUCCEEDED',
      })
      return { status: 200, outcome: 'recorded' }
    } catch (err) {
      if (pgErrorCode(err) !== PG_ERROR.UNIQUE_VIOLATION) throw err
      // A different Session already paid THIS booking — a genuine double charge
      // to refund. Every other unique seal is a benign redelivery.
      const outcome =
        pgConstraintName(err) === PAYMENT_EVENT_ONE_SUCCESS_CONSTRAINT
          ? 'double_payment'
          : 'duplicate'
      return { status: 200, outcome }
    }
  }

  async getBookingPaymentStatus(
    ctx: CallerContext,
    bookingId: string,
  ): Promise<BookingPaymentStatus | null> {
    const booking = await this.bookings.findById(ctx, bookingId)
    if (!booking) return null
    const paid = await this.paymentEvents.findSucceededByBookingId(bookingId)
    return { status: paid ? 'PAID' : 'UNPAID' }
  }
}
