import { Hono } from 'hono'
import { MANAGEMENT_READ_ROLES, requireUser, toCallerContext } from '../middleware/auth'
import type { MaintenanceService } from '../services/maintenance'
import { fail, ok } from './helpers'

export function createMaintenanceLogRoutes(maintenanceService: MaintenanceService) {
  return new Hono().get('/vehicles/:vehicleId/maintenance-logs', async (c) => {
    // Admit STAFF roles AND tenant-scoped operators (MANAGEMENT_READ_ROLES); the
    // service is the tenant boundary, so an operator only sees its own vehicle's
    // logs — a foreign-tenant vehicleId resolves to [] (#705, same fix class as
    // fleet-overview #594 / vehicle-detail). RENTER / PARTNER are excluded here.
    const user = requireUser(c)
    if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

    const logs = await maintenanceService.findLogsByVehicleId(
      toCallerContext(user),
      c.req.param('vehicleId'),
    )
    return ok(c, logs)
  })
}
