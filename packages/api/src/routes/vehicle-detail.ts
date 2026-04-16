import { Hono } from 'hono'
import { STAFF_ROLES, requireUser } from '../middleware/auth'
import type { VehicleDetailRepository } from '../repositories/types'
import { fail, ok } from './helpers'

export function createVehicleDetailRoutes(repo: VehicleDetailRepository) {
  return new Hono().get('/vehicles/:id/detail', async (c) => {
    const user = requireUser(c)
    if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

    const detail = await repo.findVehicleDetail(c.req.param('id'))
    if (!detail) {
      return fail(c, 'Vehicle not found', 404)
    }
    return ok(c, detail)
  })
}
