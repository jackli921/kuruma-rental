import { Hono } from 'hono'
import { MANAGEMENT_READ_ROLES, requireUser, toCallerContext } from '../middleware/auth'
import type { FleetOverviewService } from '../services/fleet-overview'
import { fail, ok } from './helpers'

export function createFleetOverviewRoutes(service: FleetOverviewService) {
  return new Hono().get('/vehicles/fleet-overview', async (c) => {
    const user = requireUser(c)
    // Admit STAFF roles AND tenant-scoped operators (#594); RENTER/PARTNER are
    // rejected here BEFORE the repo's operatorReadScope runs (that helper maps a
    // RENTER to {kind:'all'}, so without this gate a renter would read the whole
    // cross-operator fleet). Operators are then bounded to their own tenant by
    // the repository's operator predicate — the repo, not the route, is the
    // tenant boundary (#386 F2 / #397).
    if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

    const data = await service.findFleetOverview(toCallerContext(user))
    return ok(c, data)
  })
}
