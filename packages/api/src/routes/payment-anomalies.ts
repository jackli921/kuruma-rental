import { resolvePaymentAnomalySchema } from '@kuruma/shared/validators/payment-anomaly'
import { Hono } from 'hono'
import {
  requireAuth,
  requirePlatformAdmin,
  requirePlatformRead,
  requireUser,
  toCallerContext,
} from '../middleware/auth'
import type { PaymentAnomalyService } from '../services/payment-anomaly'
import { fail, ok, parseBody } from './helpers'

/**
 * Platform-admin payment anomalies (#508 P2; resolution UI #1075 slice 3). Cross-tenant
 * by nature, so `requireAuth` gates the paths and the per-handler `requirePlatform*`
 * guards narrow them to platform-admin roles — OPERATOR_* are rejected (payment
 * oversight is platform only) — and the service re-asserts the gate as defence-in-depth.
 *
 * The LIST read uses `requirePlatformRead`; the resolve WRITE uses the stricter
 * `requirePlatformAdmin`. The split is intentional even though both resolve to
 * {PLATFORM_ADMIN} today (#487). v1 resolve moves NO money — it only clears the queue.
 */
export function createPaymentAnomalyRoutes(service: PaymentAnomalyService) {
  const app = new Hono()
  app.use('/admin/payment-anomalies', requireAuth())
  app.use('/admin/payment-anomalies/*', requireAuth())

  return app
    .get('/admin/payment-anomalies', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      requirePlatformRead(ctx)

      // ?status=resolved|unresolved (default unresolved — the review queue). The two
      // tabs share this one endpoint so the Revenue-tab panel and the dedicated page
      // stay pointed at the same query.
      const status = c.req.query('status') ?? 'unresolved'
      if (status !== 'resolved' && status !== 'unresolved') {
        return fail(c, 'status must be "resolved" or "unresolved"', 400)
      }

      const anomalies =
        status === 'resolved' ? await service.listResolved(ctx) : await service.listUnresolved(ctx)
      return ok(c, { anomalies })
    })
    .post('/admin/payment-anomalies/:id/resolve', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      requirePlatformAdmin(ctx)

      const parsed = await parseBody(c, resolvePaymentAnomalySchema)
      if (!parsed.ok) return parsed.response

      const anomaly = await service.resolve(
        ctx,
        c.req.param('id'),
        parsed.data.resolution,
        parsed.data.note ?? null,
      )
      return ok(c, { anomaly })
    })
}
