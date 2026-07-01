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

    // #407 slice 4: the operator-context picker narrows a bypass admin to one
    // operator; the service bypass-gates it (undefined `now` = current clock).
    const requestedOperatorId = c.req.query('operatorId')
    const data = await service.getOverview(ctx, undefined, requestedOperatorId)
    return ok(c, data)
  })
}
