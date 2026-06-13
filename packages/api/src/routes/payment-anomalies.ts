import { Hono } from 'hono'
import { requireAuth, requirePlatformRead, requireUser, toCallerContext } from '../middleware/auth'
import type { PaymentAnomalyService } from '../services/payment-anomaly'
import { ok } from './helpers'

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
    const anomalies = await service.listUnresolved(ctx)
    return ok(c, { anomalies })
  })
}
