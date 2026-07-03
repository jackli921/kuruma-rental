import { Hono } from 'hono'
import { requireUser, toCallerContext } from '../middleware/auth'
import type { PaymentService } from '../services/payment/payment'
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
      if (result.outcome === 'amount_mismatch') {
        // #1378: the mismatched charge is AUTO-REFUNDED. Alert LOUD only when the refund
        // did not go through ('failed'/'unrefundable') — captured funds may still be
        // stranded and need a human. A completed/pending refund is a warning-level record.
        const stranded = result.refund === 'failed' || result.refund === 'unrefundable'
        const emit = stranded ? console.error : console.warn
        emit('[payment:webhook] amount mismatch', {
          refund: result.refund,
          stranded,
          ...result.context,
        })
      } else if (result.outcome === 'double_payment') {
        console.error('[payment:webhook] anomaly', {
          outcome: result.outcome,
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
