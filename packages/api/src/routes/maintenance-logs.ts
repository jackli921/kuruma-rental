import { Hono } from 'hono'
import { STAFF_ROLES, requireUser } from '../middleware/auth'
import type { MaintenanceService } from '../services/maintenance'
import { fail, ok } from './helpers'

export function createMaintenanceLogRoutes(maintenanceService: MaintenanceService) {
  return new Hono().get('/vehicles/:vehicleId/maintenance-logs', async (c) => {
    const user = requireUser(c)
    if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

    const logs = await maintenanceService.findLogsByVehicleId(c.req.param('vehicleId'))
    return ok(c, logs)
  })
}
