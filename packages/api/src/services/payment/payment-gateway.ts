/**
 * Provider-agnostic payment port (#461). The PaymentService depends on this
 * interface; the Stripe SDK lives only in the adapter (StripePaymentGateway) so
 * vendor types never leak into business logic — swap the gateway at the
 * composition root. Mirrors the EmailSender / TranslationProvider seam.
 */

export interface CreateCheckoutParams {
  /** Our booking id — echoed in metadata so the webhook can find the booking. */
  bookingId: string
  /** Partner attribution — echoed in metadata to satisfy #461; the webhook still
   *  re-derives the operator from the booking (never trusts this). */
  operatorId: string
  /** Whole JPY (zero-decimal currency) — the booking total the renter pays. */
  amountJpy: number
  /** Human reservation code, shown as the Stripe line-item description. */
  bookingCode: string
  /**
   * Stripe idempotency key (#461 P1). Deterministic per (booking, amount), so two
   * concurrent checkout POSTs return the SAME Session instead of two live ones —
   * Stripe itself dedupes the create. Closes the double-charge window the DB seal
   * could only detect AFTER Stripe may have charged twice.
   */
  idempotencyKey: string
  successUrl: string
  cancelUrl: string
}

export interface CheckoutSession {
  sessionId: string
  /** Stripe-hosted Checkout URL to redirect the renter to. */
  url: string
}

/**
 * The narrowed, vendor-neutral view of a verified Stripe event. Only the fields
 * the PaymentService needs — Stripe's own event/session types stay in the adapter.
 */
export interface VerifiedPaymentEvent {
  /** Stripe event id (`evt_…`) — the redelivery idempotency fence. */
  eventId: string
  /** e.g. `checkout.session.completed`. */
  type: string
  /** Checkout Session id (`cs_…`). */
  checkoutSessionId: string
  /** Payment Intent id (`pi_…`), or null when not yet attached. */
  paymentIntentId: string | null
  /** Whole JPY actually charged (Stripe `amount_total`), or null. Trusted over the client. */
  amountTotal: number | null
  /** ISO currency (`jpy`), or null. */
  currency: string | null
  /** `paid` | `unpaid` | `no_payment_required`, or null. */
  paymentStatus: string | null
  /** Stripe Refund.status (`succeeded` | `pending` | `failed` | `canceled` |
   *  `requires_action`) when this is a refund event (`refund.updated`), else null.
   *  The webhook confirms a booking REFUNDED only on `succeeded` (#851). */
  refundStatus: string | null
  /** Metadata we set at session creation. operatorId is ignored on the webhook.
   *  `| undefined` (not just `?`) because a tampered/legacy session may omit a key
   *  under exactOptionalPropertyTypes. */
  metadata: { bookingId?: string | undefined; operatorId?: string | undefined }
}

/** A narrowed, vendor-neutral view of a Stripe Refund (#851). Only the fields the
 *  PaymentService needs to correlate (metadata.bookingId + amount + currency + PI)
 *  and confirm (status) a refund — Stripe's own Refund type stays in the adapter. */
export interface StripeRefund {
  /** Stripe refund id (`re_…`). */
  id: string
  /** Whole JPY refunded (Stripe `amount`, zero-decimal). */
  amount: number
  /** ISO currency (`jpy`). */
  currency: string
  /** `succeeded` | `pending` | `failed` | `canceled` | `requires_action`. */
  status: string
  /** The PaymentIntent this refund is against (`pi_…`), or null. */
  paymentIntentId: string | null
  /** Metadata we set at creation; `bookingId` is our adoption correlation key. */
  metadata: { bookingId?: string | undefined }
}

export interface RefundParams {
  paymentIntentId: string
  /** Whole JPY to refund — already clamped to the captured amount by the service. */
  amountJpy: number
  /** Deterministic per booking (`refund:${bookingId}`): Stripe dedupes the create
   *  within its ~24h key window; the durable receipt covers re-drives past it. */
  idempotencyKey: string
  /** Echoed onto the Refund so a webhook/list can correlate it to our booking. */
  metadata: { bookingId: string }
}

/** Thrown by refundPayment when Stripe TERMINALLY rejects the create — the charge
 *  is already (manually) refunded or the remaining balance is insufficient. The
 *  service maps this to a FAILED receipt + leaves the booking for the human surface;
 *  it NEVER confirms REFUNDED. Transient errors propagate instead so the reconciler
 *  retries. */
export class RefundRejectedError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
    this.name = 'RefundRejectedError'
  }
}

export interface PaymentGateway {
  createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutSession>
  /**
   * Verify the webhook signature and return the narrowed event. MUST throw when
   * the signature is invalid or stale — the PaymentService maps a throw to 400
   * and records nothing. "Don't trust the client for money."
   */
  parseWebhookEvent(rawBody: string, signature: string): Promise<VerifiedPaymentEvent>
  /** Create a refund against a captured PaymentIntent (#851). Throws
   *  RefundRejectedError on a TERMINAL Stripe rejection (already-refunded /
   *  insufficient balance); transient errors propagate for the reconciler to retry. */
  refundPayment(params: RefundParams): Promise<StripeRefund>
  /** Fetch a refund by id (`re_…`) — the pull path that lets a lost webhook self-heal. */
  retrieveRefund(stripeRefundId: string): Promise<StripeRefund>
  /** Refunds on a PaymentIntent — used ONLY to adopt a refund we created but failed
   *  to persist; the service correlates by metadata.bookingId + amount before adopting. */
  listRefundsByPaymentIntent(paymentIntentId: string): Promise<StripeRefund[]>
}
