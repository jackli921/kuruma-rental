import { Hono } from 'hono'
import { requireAuth, requirePlatformRead, requireUser, toCallerContext } from '../middleware/auth'
import type { AdminRevenueService } from '../services/admin-revenue'
import { fail, ok } from './helpers'

// `YYYY-MM` with a real calendar month (01-12), JST (#628). A syntactically valid
// month with no data simply yields an empty report — only malformed input 400s.
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/

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

    const month = c.req.query('month')
    if (month !== undefined && !MONTH_RE.test(month)) {
      return fail(c, 'Invalid month — expected YYYY-MM', 400)
    }

    const data = await service.getReport(ctx, month)
    return ok(c, data)
  })
}
