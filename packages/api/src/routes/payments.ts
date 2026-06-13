import { Hono } from 'hono'
import { requireUser, toCallerContext } from '../middleware/auth'
import type { PaymentService } from '../services/payment/payment'
import { fail, ok } from './helpers'

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
      const result = await service.createCheckoutSession(ctx, c.req.param('bookingId'))
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, { url: result.url })
    })
    .get('/bookings/:bookingId/payment', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      const status = await service.getBookingPaymentStatus(ctx, c.req.param('bookingId'))
      if (!status) return fail(c, 'Booking not found', 404)
      return ok(c, status)
    })
    .post('/webhooks/stripe', async (c) => {
      const signature = c.req.header(STRIPE_SIGNATURE_HEADER)
      if (!signature) return fail(c, 'Missing stripe-signature header', 400)

      // Raw body (NOT parsed JSON) — the signature is computed over the exact bytes.
      const rawBody = await c.req.text()
      const result = await service.handleWebhook(rawBody, signature)

      // A double charge or an amount mismatch needs an operator's eyes. The
      // service now PERSISTS these to payment_anomalies (#508 P2, idempotent on
      // stripeEventId); this log is supplementary real-time signal carrying the
      // FULL context (event/session/paymentIntent/booking/amounts). NOTE: because
      // persistence happens before the 200 ack, a transient insert failure rejects
      // here → 500 → Stripe retry, which re-converges (the insert is idempotent) —
      // an intentional trade-off favouring durable capture over a silent log-only ack.
      if (result.outcome === 'double_payment' || result.outcome === 'amount_mismatch') {
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
