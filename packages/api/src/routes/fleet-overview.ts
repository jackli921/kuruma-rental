import { Hono } from 'hono'
import { MANAGEMENT_READ_ROLES, requireUser, toCallerContext } from '../middleware/auth'
import type { FleetOverviewService } from '../services/fleet-overview'
import { fail, ok } from './helpers'

export function createFleetOverviewRoutes(service: FleetOverviewService) {
  return new Hono().get('/vehicles/fleet-overview', async (c) => {
    const user = requireUser(c)
    // Admit MANAGEMENT_READ_ROLES (#594); RENTER/PARTNER are rejected here. The
    // repo also fail-closes them (#1273: it reads bookingReadScope, under which
    // RENTER/PARTNER never reach `all` and requireManagementRead throws) — this
    // gate is the outer seal of that defense-in-depth, returning a clean 403
    // rather than an empty 200. Operators are bounded to their own tenant by the
    // repository's operator predicate — the repo, not the route, is the tenant
    // boundary (#386 F2 / #397).
    if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

    // #407 slice 4: the operator-context picker narrows a bypass admin to one
    // operator; the service bypass-gates it (undefined `now` = current clock).
    const requestedOperatorId = c.req.query('operatorId')
    const data = await service.findFleetOverview(
      toCallerContext(user),
      undefined,
      requestedOperatorId,
    )
    return ok(c, data)
  })
}
