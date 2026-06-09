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
  /** Metadata we set at session creation. operatorId is ignored on the webhook.
   *  `| undefined` (not just `?`) because a tampered/legacy session may omit a key
   *  under exactOptionalPropertyTypes. */
  metadata: { bookingId?: string | undefined; operatorId?: string | undefined }
}

export interface PaymentGateway {
  createCheckoutSession(params: CreateCheckoutParams): Promise<CheckoutSession>
  /**
   * Verify the webhook signature and return the narrowed event. MUST throw when
   * the signature is invalid or stale — the PaymentService maps a throw to 400
   * and records nothing. "Don't trust the client for money."
   */
  parseWebhookEvent(rawBody: string, signature: string): Promise<VerifiedPaymentEvent>
}
