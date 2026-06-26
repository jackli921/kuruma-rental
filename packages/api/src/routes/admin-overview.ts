import { Hono } from 'hono'
import { requireAuth, requirePlatformAdmin, requireUser, toCallerContext } from '../middleware/auth'
import type { AdminOverviewService } from '../services/admin-overview'
import { ok } from './helpers'

/**
 * Platform-owner home overview (#1087, epic #1075 slice 1). Cross-tenant by
 * nature, so `requireAuth` gates the path and `requirePlatformAdmin` narrows it to
 * PLATFORM_ADMIN — legacy STAFF/ADMIN, OPERATOR_*, RENTER and PARTNER are all
 * rejected. `requireAuth` alone is insufficient: `bypassScope` also admits PARTNER
 * (Trip.com). The service re-asserts the same gate as defence-in-depth.
 */
export function createAdminOverviewRoutes(service: AdminOverviewService) {
  const app = new Hono()
  app.use('/admin/overview', requireAuth())

  return app.get('/admin/overview', async (c) => {
    const ctx = toCallerContext(requireUser(c))
    requirePlatformAdmin(ctx)

    const data = await service.getOverview(ctx)
    return ok(c, data)
  })
}
