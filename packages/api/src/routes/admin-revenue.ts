import { Hono } from 'hono'
import { requireAuth, requirePlatformRead, requireUser, toCallerContext } from '../middleware/auth'
import type { AdminRevenueService } from '../services/admin-revenue'
import { ok } from './helpers'

/**
 * Platform-admin partner revenue (#462). Cross-tenant by nature, so `requireAuth`
 * gates the path and `requirePlatformRead` narrows it to platform-admin roles —
 * OPERATOR_* are rejected here (they must never see another partner's revenue),
 * and the service re-asserts the gate as defence-in-depth.
 */
export function createAdminRevenueRoutes(service: AdminRevenueService) {
  const app = new Hono()
  app.use('/admin/revenue', requireAuth())

  return app.get('/admin/revenue', async (c) => {
    const ctx = toCallerContext(requireUser(c))
    requirePlatformRead(ctx)

    const data = await service.getReport(ctx)
    return ok(c, data)
  })
}
