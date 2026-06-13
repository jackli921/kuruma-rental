import { Hono } from 'hono'
import {
  requireAuth,
  requireManagementRead,
  requireUser,
  toCallerContext,
} from '../middleware/auth'
import type { OverviewService } from '../services/overview'
import { ok } from './helpers'

/**
 * Operator dashboard overview (#524). Operator-private — auth gates the path and
 * reads require a management role (RENTER/PARTNER → 403, like insurance/fees).
 * `requireManagementRead` seals the role at the route; the repo re-asserts it as
 * defence-in-depth. Tenant scoping is the service/repo's job: an OPERATOR_*
 * caller sees only its own tenant; bypass roles aggregate across all operators.
 */
export function createOverviewRoutes(service: OverviewService) {
  const app = new Hono()
  app.use('/dashboard/overview', requireAuth())

  return app.get('/dashboard/overview', async (c) => {
    const ctx = toCallerContext(requireUser(c))
    requireManagementRead(ctx)

    const data = await service.getOverview(ctx)
    return ok(c, data)
  })
}
