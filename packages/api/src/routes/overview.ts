import { Hono } from 'hono'
import {
  MANAGEMENT_READ_ROLES,
  requireAuth,
  requireUser,
  toCallerContext,
} from '../middleware/auth'
import type { OverviewService } from '../services/overview'
import { fail, ok } from './helpers'

/**
 * Operator dashboard overview (#524). Operator-private — auth gates the path and
 * reads require a management role (RENTER/PARTNER → 403, like insurance/fees).
 * Tenant scoping is the service/repo's job: an OPERATOR_* caller sees only its
 * own tenant; bypass roles aggregate across all operators.
 */
export function createOverviewRoutes(service: OverviewService) {
  const app = new Hono()
  app.use('/dashboard/overview', requireAuth())

  return app.get('/dashboard/overview', async (c) => {
    const user = requireUser(c)
    if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

    const data = await service.getOverview(toCallerContext(user))
    return ok(c, data)
  })
}
