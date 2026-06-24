import { computePlatformCommission } from '@kuruma/shared/lib/commission'
import { type CallerContext, SYSTEM_CONTEXT } from '../../middleware/auth'
import {
  PAYMENT_EVENT_ONE_SUCCESS_CONSTRAINT,
  PG_ERROR,
  pgConstraintName,
  pgErrorCode,
} from '../../pg-errors'
import type {
  BookingRepository,
  PaymentAnomalyRepository,
  PaymentEventRepository,
  PaymentRefundRepository,
} from '../../repositories/types'
import type { Booking, PaymentAnomalyKind, PaymentRefund } from '../../stores'
import { RefundRejectedError } from './payment-gateway'
import type { PaymentGateway, StripeRefund, VerifiedPaymentEvent } from './payment-gateway'

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

/** Reconciliation identifiers carried out of the webhook for anomaly logging
 *  (#461 P1b). A `double_payment` needs the paymentIntent so an operator can
 *  actually refund; an `amount_mismatch` needs both amounts to investigate.
 *  Without these the 200 ack would discard everything Stripe just told us. */
export interface WebhookLogContext {
  eventId: string
  checkoutSessionId: string
  paymentIntentId: string | null
  bookingId: string
  amountTotal: number | null
  expectedAmountJpy: number | null
  currency: string | null
}

export interface WebhookResult {
  status: 200 | 400
  outcome: WebhookOutcome
  /** Present for anomaly/duplicate outcomes so the route can log identifiers. */
  context?: WebhookLogContext
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
    private readonly paymentRefunds: PaymentRefundRepository,
    private readonly bookings: BookingRepository,
    private readonly gateway: PaymentGateway,
    private readonly anomalies: PaymentAnomalyRepository,
    private readonly config: PaymentConfig,
  ) {}

  /** Persist an anomaly for operator review (#508 P2). operator + amounts are
   *  re-derived from the booking/event, never trusted from Stripe metadata. The
   *  record is idempotent on stripeEventId, so a redelivered webhook is a no-op. */
  private async recordAnomaly(
    kind: PaymentAnomalyKind,
    booking: Booking,
    event: VerifiedPaymentEvent,
  ): Promise<void> {
    await this.anomalies.record({
      operatorId: booking.operatorId,
      bookingId: booking.id,
      kind,
      stripeEventId: event.eventId,
      stripeCheckoutSessionId: event.checkoutSessionId,
      stripePaymentIntentId: event.paymentIntentId,
      receivedAmountJpy: event.amountTotal,
      expectedAmountJpy: booking.totalPrice,
      currency: event.currency,
    })
  }

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

    // Deterministic idempotency key per (booking, amount): two concurrent POSTs
    // return the SAME Stripe Session, so a racing double-submit can't open two
    // payable sessions (#461 P1). A later price change (e.g. #460 add-ons) yields
    // a new key → a fresh session, which is correct.
    const idempotencyKey = `checkout:${booking.id}:${amountJpy}`

    // Return target: the renter Pay UI + post-payment page are #460's surface. The
    // current web tree only has localized routes, so we point at the live web ROOT
    // (it redirects to the detected locale) and carry the booking code + outcome as
    // query params for #460 to consume — never a hardcoded path that 404s (#461 P2).
    const base = this.config.webBaseUrl.replace(/\/$/, '')
    const returnUrl = (outcome: 'success' | 'cancelled') =>
      `${base}/?payment=${outcome}&booking=${encodeURIComponent(booking.bookingCode)}`
    const session = await this.gateway.createCheckoutSession({
      bookingId: booking.id,
      operatorId: booking.operatorId,
      amountJpy,
      bookingCode: booking.bookingCode,
      idempotencyKey,
      successUrl: returnUrl('success'),
      cancelUrl: returnUrl('cancelled'),
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

    // Identifiers an operator needs to reconcile or refund an anomaly (#461 P1b).
    // Carried out with every non-trivial outcome so the 200 ack never discards
    // the paymentIntent / session / amounts Stripe just reported.
    const context: WebhookLogContext = {
      eventId: event.eventId,
      checkoutSessionId: event.checkoutSessionId,
      paymentIntentId: event.paymentIntentId,
      bookingId: booking.id,
      amountTotal: event.amountTotal,
      expectedAmountJpy: booking.totalPrice,
      currency: event.currency,
    }

    // Trust Stripe's amount over the client, but still assert it matches the
    // booking snapshot — a stale/buggy session must not record a wrong amount.
    // The explicit null check also closes the null===null hole (a booking with
    // no total can never match) and narrows amountTotal to a number below.
    if (
      event.amountTotal === null ||
      event.amountTotal !== booking.totalPrice ||
      event.currency !== CURRENCY
    ) {
      await this.recordAnomaly('AMOUNT_MISMATCH', booking, event)
      return { status: 200, outcome: 'amount_mismatch', context }
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
      // to refund (context carries the paymentIntent so an operator can act).
      // Every other unique seal is a benign redelivery.
      const outcome =
        pgConstraintName(err) === PAYMENT_EVENT_ONE_SUCCESS_CONSTRAINT
          ? 'double_payment'
          : 'duplicate'
      if (outcome === 'double_payment') {
        // A genuine second charge to refund — persist it (with pi to act on),
        // unlike a benign redelivery which is already sealed by the unique index.
        await this.recordAnomaly('DOUBLE_PAYMENT', booking, event)
      }
      return { status: 200, outcome, context }
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

  /**
   * Initiate (or re-drive) the refund for a cancelled, PAID booking (#851). The
   * single idempotent entry point shared by the eager post-commit fire AND the
   * reconciler: claim a durable receipt, create-or-retrieve/adopt at Stripe, then
   * confirm on `succeeded`. No-op when UNPAID, when nothing is owed, or when the
   * receipt is already terminal. `intendedAmountJpy` seeds a fresh claim (renter =
   * policy refundAmount, operator = full total) and is clamped to the captured amount.
   */
  async initiateCancellationRefund(booking: Booking, intendedAmountJpy: number): Promise<void> {
    // Only a PAID booking with a settled PaymentIntent has money to move.
    const payment = await this.paymentEvents.findSucceededByBookingId(booking.id)
    const paymentIntentId = payment?.stripePaymentIntentId
    if (!payment || !paymentIntentId) return
    // Clamp: never refund more than was captured (guards partial captures / drift).
    const amountJpy = Math.min(intendedAmountJpy, payment.grossJpy)
    if (amountJpy <= 0) return

    // Durable "work already started" receipt, written BEFORE Stripe. Idempotent and
    // forward-only: a re-drive returns the existing row (carrying any re_…).
    const receipt = await this.paymentRefunds.claim({
      bookingId: booking.id,
      operatorId: booking.operatorId,
      stripePaymentIntentId: paymentIntentId,
      amountJpy,
    })
    if (receipt.status === 'FAILED') return // terminal — left for the human surface
    if (receipt.status === 'SUCCEEDED') {
      // Receipt settled but the booking may still be REFUND_DUE (a crash between the
      // two confirm writes) — finish the booking side idempotently.
      await this.confirmBookingRefunded(booking.id)
      return
    }

    const refund = await this.resolveRefund(booking, receipt, amountJpy)
    if (!refund) return // terminal create rejection — receipt already marked FAILED
    if (!receipt.stripeRefundId) {
      await this.paymentRefunds.attachStripeRefund(booking.id, refund.id)
    }
    await this.applyRefundStatus(booking.id, refund)
  }

  /** Resolve the Stripe refund for this booking: an already-attached one (pull —
   *  self-heals a lost webhook), else a correlation-matching orphan to adopt, else a
   *  fresh create. Returns null only when create is TERMINALLY rejected. */
  private async resolveRefund(
    booking: Booking,
    receipt: PaymentRefund,
    amountJpy: number,
  ): Promise<StripeRefund | null> {
    if (receipt.stripeRefundId) {
      return this.gateway.retrieveRefund(receipt.stripeRefundId)
    }
    const adoptable = await this.findAdoptableRefund(
      booking.id,
      receipt.stripePaymentIntentId,
      amountJpy,
    )
    if (adoptable) return adoptable
    try {
      return await this.gateway.refundPayment({
        paymentIntentId: receipt.stripePaymentIntentId,
        amountJpy,
        idempotencyKey: `refund:${booking.id}`,
        metadata: { bookingId: booking.id },
      })
    } catch (err) {
      // Terminal (already-refunded / insufficient) → FAILED for the human surface.
      // Transient errors propagate so the reconciler retries (receipt stays PENDING).
      if (err instanceof RefundRejectedError) {
        await this.paymentRefunds.markStatus(booking.id, 'FAILED')
        return null
      }
      throw err
    }
  }

  /** A refund already on the PI is ours to adopt ONLY when the full business
   *  correlation matches — bookingId + amount + currency + PI, non-failed. A foreign
   *  or partial refund (e.g. a manual operator refund) is never adopted (#851). */
  private async findAdoptableRefund(
    bookingId: string,
    paymentIntentId: string,
    amountJpy: number,
  ): Promise<StripeRefund | null> {
    const refunds = await this.gateway.listRefundsByPaymentIntent(paymentIntentId)
    return (
      refunds.find(
        (r) =>
          r.metadata.bookingId === bookingId &&
          r.amount === amountJpy &&
          r.currency === CURRENCY &&
          r.paymentIntentId === paymentIntentId &&
          r.status !== 'failed' &&
          r.status !== 'canceled',
      ) ?? null
    )
  }

  /** Map a Stripe-verified refund status onto our records. A `succeeded` (push or
   *  pull) advances receipt + booking; terminal `failed`/`canceled` marks FAILED; a
   *  pending refund is left for the next reconciler pass. */
  private async applyRefundStatus(bookingId: string, refund: StripeRefund): Promise<void> {
    if (refund.status === 'succeeded') {
      await this.confirmRefundSucceeded(bookingId)
    } else if (refund.status === 'failed' || refund.status === 'canceled') {
      await this.paymentRefunds.markStatus(bookingId, 'FAILED')
    }
    // pending / requires_action → stay PENDING; the reconciler retrieves again later.
  }

  /** Terminal success: receipt SUCCEEDED + booking REFUND_DUE → REFUNDED. Both writes
   *  are guarded/forward-only, so a webhook push and a reconciler pull racing converge
   *  (whoever lands first wins; the other is a no-op). */
  private async confirmRefundSucceeded(bookingId: string): Promise<void> {
    await this.paymentRefunds.markStatus(bookingId, 'SUCCEEDED')
    await this.confirmBookingRefunded(bookingId)
  }

  private async confirmBookingRefunded(bookingId: string): Promise<void> {
    await this.bookings.markCancellationSettlement(SYSTEM_CONTEXT, bookingId, {
      from: 'REFUND_DUE',
      to: 'REFUNDED',
    })
  }
}
