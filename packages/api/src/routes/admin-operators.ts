import { Hono } from 'hono'
import { requirePlatformAdmin, requireUser, toCallerContext } from '../middleware/auth'
import type { OperatorService } from '../services/operator'
import { fail, ok } from './helpers'

/**
 * Platform-owner operator directory + lifecycle (#1088, epic #1075 slice 2).
 *
 * A dedicated `/admin/operators` surface — deliberately NOT the business-tier
 * `GET /operators` picker (which projects only `{id,name,slug}` to fleet-write
 * roles). Cross-tenant by nature: the app-level `/admin/*` requireAuth 401s anon
 * callers, `requirePlatformAdmin` narrows to PLATFORM_ADMIN (OPERATOR_* / RENTER /
 * PARTNER → 403), and the service re-asserts the gate as defence-in-depth.
 *
 * Deactivate/reactivate are soft (toggle `operators.deactivatedAt`): the operator
 * is hidden from storefront/search and blocked from new bookings, while existing
 * bookings + history are untouched. Members of a deactivated operator are revoked
 * on their next request via the #939 session-freshness cascade.
 */
export function createAdminOperatorRoutes(service: OperatorService) {
  const app = new Hono()

  return app
    .get('/admin/operators', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      requirePlatformAdmin(ctx)
      return ok(c, await service.listForAdmin(ctx))
    })
    .post('/admin/operators/:id/deactivate', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      requirePlatformAdmin(ctx)
      const updated = await service.deactivate(ctx, c.req.param('id'))
      if (!updated) return fail(c, 'Operator not found', 404)
      return ok(c, updated)
    })
    .post('/admin/operators/:id/reactivate', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      requirePlatformAdmin(ctx)
      const updated = await service.reactivate(ctx, c.req.param('id'))
      if (!updated) return fail(c, 'Operator not found', 404)
      return ok(c, updated)
    })
}
