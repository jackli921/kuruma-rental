import Stripe from 'stripe'
import { RefundRejectedError } from './payment-gateway'
import type {
  CheckoutSession,
  CreateCheckoutParams,
  PaymentGateway,
  RefundParams,
  StripeRefund,
  VerifiedPaymentEvent,
} from './payment-gateway'

// JPY is a Stripe zero-decimal currency: unit_amount is whole yen, NOT yen*100.
const CURRENCY = 'jpy'

// Stripe `invalid_request` codes that mean the refund can NEVER succeed as-is —
// the charge is already fully refunded. Mapped to a terminal RefundRejectedError;
// everything else (network, rate-limit) propagates as transient so the reconciler
// retries. Bias is deliberate: falsely terminalizing abandons a real refund, which
// is worse than a cheap daily re-check, so only KNOWN-terminal codes land here.
const TERMINAL_REFUND_CODES: ReadonlySet<string> = new Set(['charge_already_refunded'])

function toStripeRefund(r: Stripe.Refund): StripeRefund {
  const pi = r.payment_intent
  return {
    id: r.id,
    amount: r.amount,
    currency: r.currency,
    status: r.status ?? 'unknown',
    paymentIntentId: typeof pi === 'string' ? pi : (pi?.id ?? null),
    metadata: { bookingId: r.metadata?.bookingId },
  }
}

/**
 * Stripe adapter (#461). Confines the Stripe SDK to this file (hexagonal
 * boundary) — the service depends only on PaymentGateway.
 *
 * Cloudflare Workers specifics, both mandatory:
 *  - `Stripe.createFetchHttpClient()` — the default Node http client has no
 *    equivalent on Workers and would throw at runtime.
 *  - `webhooks.constructEventAsync` (NOT the sync `constructEvent`) — signature
 *    verification must use SubtleCrypto, which is async on Workers.
 *
 * Unlike ResendEmailSender we use the SDK rather than hand-rolled REST: webhook
 * signature verification is security-critical and the SDK is the audited
 * implementation. The bundle cost lands on the API Worker, not the size-budgeted
 * web bundle.
 */
export class StripePaymentGateway implements PaymentGateway {
  private readonly stripe: Stripe

  constructor(
    secretKey: string,
    private readonly webhookSecret: string,
  ) {
    this.stripe = new Stripe(secretKey, { httpClient: Stripe.createFetchHttpClient() })
  }

  async createCheckoutSession(p: CreateCheckoutParams): Promise<CheckoutSession> {
    const session = await this.stripe.checkout.sessions.create(
      {
        mode: 'payment',
        line_items: [
          {
            price_data: {
              currency: CURRENCY,
              product_data: { name: `Rental booking ${p.bookingCode}` },
              unit_amount: p.amountJpy,
            },
            quantity: 1,
          },
        ],
        // metadata = partner-business id + booking id (#461 acceptance). The
        // webhook re-derives operatorId from the booking and ignores it here.
        metadata: { bookingId: p.bookingId, operatorId: p.operatorId },
        payment_intent_data: { metadata: { bookingId: p.bookingId } },
        success_url: p.successUrl,
        cancel_url: p.cancelUrl,
        // P1 (#461): two concurrent creates with this key return the SAME Session
        // (Stripe locks on the key), so the renter can never be double-charged by a
        // racing second checkout request. Valid 24h — matches Checkout expiry.
      },
      { idempotencyKey: p.idempotencyKey },
    )
    return { sessionId: session.id, url: session.url ?? '' }
  }

  async parseWebhookEvent(rawBody: string, signature: string): Promise<VerifiedPaymentEvent> {
    // Throws Stripe.errors.StripeSignatureVerificationError on a bad/stale sig.
    const event = await this.stripe.webhooks.constructEventAsync(
      rawBody,
      signature,
      this.webhookSecret,
    )
    // Read session fields structurally rather than asserting Stripe.Checkout.Session:
    // for non-checkout event types data.object is a different shape, and the
    // service short-circuits on `type` before touching these fields anyway.
    const obj = event.data.object as {
      id?: string
      payment_intent?: string | { id: string } | null
      amount_total?: number | null
      currency?: string | null
      payment_status?: string | null
      metadata?: Record<string, string> | null
    }
    const paymentIntentId =
      typeof obj.payment_intent === 'string' ? obj.payment_intent : (obj.payment_intent?.id ?? null)
    return {
      eventId: event.id,
      type: event.type,
      checkoutSessionId: obj.id ?? '',
      paymentIntentId,
      amountTotal: obj.amount_total ?? null,
      currency: obj.currency ?? null,
      paymentStatus: obj.payment_status ?? null,
      metadata: {
        bookingId: obj.metadata?.bookingId,
        operatorId: obj.metadata?.operatorId,
      },
    }
  }

  async refundPayment(p: RefundParams): Promise<StripeRefund> {
    try {
      const refund = await this.stripe.refunds.create(
        {
          payment_intent: p.paymentIntentId,
          amount: p.amountJpy,
          metadata: { bookingId: p.metadata.bookingId },
        },
        { idempotencyKey: p.idempotencyKey },
      )
      return toStripeRefund(refund)
    } catch (err) {
      // Terminal create rejection (already refunded) → a typed signal the service
      // maps to FAILED. Transient errors propagate untouched for the reconciler.
      if (
        err instanceof Stripe.errors.StripeInvalidRequestError &&
        err.code !== undefined &&
        TERMINAL_REFUND_CODES.has(err.code)
      ) {
        throw new RefundRejectedError(err.message, err.code)
      }
      throw err
    }
  }

  async retrieveRefund(stripeRefundId: string): Promise<StripeRefund> {
    return toStripeRefund(await this.stripe.refunds.retrieve(stripeRefundId))
  }

  async listRefundsByPaymentIntent(paymentIntentId: string): Promise<StripeRefund[]> {
    // A PaymentIntent has at most a handful of refunds; one page (limit 10) covers it.
    const page = await this.stripe.refunds.list({ payment_intent: paymentIntentId, limit: 10 })
    return page.data.map(toStripeRefund)
  }
}
