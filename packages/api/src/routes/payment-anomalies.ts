import type { PaymentAnomalyView } from '@kuruma/shared/types/payment-anomaly'
import { Hono } from 'hono'
import { requireAuth, requirePlatformRead, requireUser, toCallerContext } from '../middleware/auth'
import type { PaymentAnomalyService } from '../services/payment-anomaly'
import type { PaymentAnomaly } from '../stores'
import { ok } from './helpers'

// Project a persisted anomaly onto the admin wire view (@kuruma/shared): drop the
// internal resolved flag (this list is unresolved-only) and the checkout-session
// id (refunds are issued against the paymentIntent), and serialize createdAt as ISO.
function toView(a: PaymentAnomaly): PaymentAnomalyView {
  return {
    id: a.id,
    kind: a.kind,
    operatorId: a.operatorId,
    bookingId: a.bookingId,
    receivedAmountJpy: a.receivedAmountJpy,
    expectedAmountJpy: a.expectedAmountJpy,
    currency: a.currency,
    stripeEventId: a.stripeEventId,
    stripePaymentIntentId: a.stripePaymentIntentId,
    createdAt: a.createdAt.toISOString(),
  }
}

/**
 * Platform-admin payment anomalies needing review (#508 P2). Cross-tenant by
 * nature, so `requireAuth` gates the path and `requirePlatformRead` narrows it to
 * platform-admin roles — OPERATOR_* are rejected (payment oversight is platform
 * only) — and the service re-asserts the gate as defence-in-depth.
 */
export function createPaymentAnomalyRoutes(service: PaymentAnomalyService) {
  const app = new Hono()
  app.use('/admin/payment-anomalies', requireAuth())

  return app.get('/admin/payment-anomalies', async (c) => {
    const ctx = toCallerContext(requireUser(c))
    requirePlatformRead(ctx)
    const anomalies = (await service.listUnresolved(ctx)).map(toView)
    return ok(c, { anomalies })
  })
}
