import { Hono } from 'hono'
import { STAFF_ROLES, requireUser } from '../middleware/auth'
import type { FleetOverviewRepository } from '../repositories/types'
import { fail, ok } from './helpers'

export function createFleetOverviewRoutes(repo: FleetOverviewRepository) {
  return new Hono().get('/vehicles/fleet-overview', async (c) => {
    const user = requireUser(c)
    if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

    const data = await repo.findFleetOverview()
    return ok(c, data)
  })
}
