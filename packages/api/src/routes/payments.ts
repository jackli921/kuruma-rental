import { Hono } from 'hono'
import { requireUser, toCallerContext } from '../middleware/auth'
import { reportStrandedFunds } from '../observability/money-alerts'
import type { PaymentService } from '../services/payment/payment'
import { paymentWebhookStrandedAlert } from '../services/payment/webhook-alert'
import { fail, failResult, ok, parseId } from './helpers'

const STRIPE_SIGNATURE_HEADER = 'stripe-signature'

/**
 * In-app Stripe payment surface (#461).
 *
 * - `/bookings/:bookingId/checkout-session` + `/bookings/:bookingId/payment` are
 *   mounted under `/bookings/*`, so the index.ts app-level `requireAuth()`
 *   guards them (renter must be signed in). `requireUser` is the 401 backstop.
 * - `/webhooks/stripe` is intentionally PUBLIC: Stripe is a server-to-server
 *   caller with no cookie/JWT (the global CSRF guard no-ops on cookie-less
 *   requests). Trust comes from the signed payload, verified in the service.
 */
export function createPaymentRoutes(service: PaymentService) {
  const app = new Hono()

  return app
    .post('/bookings/:bookingId/checkout-session', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      const idResult = parseId(c, 'bookingId')
      if (!idResult.ok) return idResult.response
      const result = await service.createCheckoutSession(ctx, idResult.id)
      if (!result.ok) return failResult(c, result)
      return ok(c, { url: result.url })
    })
    .get('/bookings/:bookingId/payment', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      const idResult = parseId(c, 'bookingId')
      if (!idResult.ok) return idResult.response
      const status = await service.getBookingPaymentStatus(ctx, idResult.id)
      if (!status) return fail(c, 'Booking not found', 404)
      return ok(c, status)
    })
    .post('/webhooks/stripe', async (c) => {
      const signature = c.req.header(STRIPE_SIGNATURE_HEADER)
      if (!signature) return fail(c, 'Missing stripe-signature header', 400)

      // Raw body (NOT parsed JSON) — the signature is computed over the exact bytes.
      const rawBody = await c.req.text()
      const result = await service.handleWebhook(rawBody, signature)

      // A double charge or an amount mismatch needs attention. The service PERSISTS
      // these to payment_anomalies (#508 P2, idempotent on stripeEventId); this log is
      // the real-time signal carrying FULL context (event/session/paymentIntent/booking/
      // amounts). NOTE: persistence happens before the 200 ack, so a transient failure
      // rejects here → 500 → Stripe retry, which re-converges (idempotent) — favouring
      // durable capture over a silent log-only ack.
      // Money stuck at Stripe — a stranded #1378 mismatch auto-refund ('failed'/
      // 'unrefundable'), or a double charge that (unlike a mismatch) is NOT auto-refunded —
      // must PAGE a human. The SDK only auto-captures thrown errors, so a handled money-stuck
      // condition needs an explicit Sentry event (reportStrandedFunds), not a log nobody tails.
      const strandedAlert = paymentWebhookStrandedAlert(result)
      if (strandedAlert) {
        reportStrandedFunds(`[payment:webhook] ${strandedAlert}`, { context: result.context })
      } else if (result.outcome === 'amount_mismatch') {
        // A completed/pending auto-refund self-healed — a warning-level record, not an alert.
        console.warn('[payment:webhook] amount mismatch auto-refunded', {
          refund: result.refund,
          ...result.context,
        })
      } else if (result.outcome === 'invalid_signature') {
        console.warn('[payment:webhook] rejected: invalid signature')
      }

      // Stripe only checks the status code: 2xx = handled (stop retrying), 4xx =
      // failed. The body is informational. A bad signature is the only 4xx.
      return c.json({ received: result.outcome !== 'invalid_signature' }, result.status)
    })
}
