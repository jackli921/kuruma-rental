import { Hono } from 'hono'
import { MANAGEMENT_READ_ROLES, requireUser, toCallerContext } from '../middleware/auth'
import type { VehicleDetailService } from '../services/vehicle-detail'
import { fail, ok, parseId } from './helpers'

export function createVehicleDetailRoutes(service: VehicleDetailService) {
  return new Hono().get('/vehicles/:id/detail', async (c) => {
    // Admit STAFF roles AND tenant-scoped operators (MANAGEMENT_READ_ROLES); the
    // repo is the tenant boundary, so an operator only sees its own vehicle —
    // a foreign-tenant id resolves to undefined -> 404, never a cross-tenant leak
    // (same fix class as fleet-overview #594). RENTER / PARTNER are excluded.
    const user = requireUser(c)
    if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

    const idResult = parseId(c)
    if (!idResult.ok) return idResult.response

    const detail = await service.findVehicleDetail(toCallerContext(user), idResult.id)
    if (!detail) {
      return fail(c, 'Vehicle not found', 404)
    }
    return ok(c, detail)
  })
}
