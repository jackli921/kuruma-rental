import { Hono } from 'hono'
import { getUser } from '../middleware/auth'
import type { AvailabilityService } from '../services/availability'
import { fail, ok, parseDateRange, parseId } from './helpers'

export function createAvailabilityRoutes(service: AvailabilityService) {
  return new Hono()
    .get('/availability', async (c) => {
      const range = parseDateRange(c, true)
      if (!range.ok) return range.response

      const available = await service.findAvailableVehicles(range.from, range.to)
      return ok(c, available)
    })
    .get('/availability/:vehicleId', async (c) => {
      const idResult = parseId(c, 'vehicleId')
      if (!idResult.ok) return idResult.response
      const range = parseDateRange(c, true)
      if (!range.ok) return range.response

      // Role is the only authz input; extracting it here keeps getUser (a context
      // concern) out of the service, which stays a pure policy core (FC/IS).
      const result = await service.checkVehicleAvailability(
        idResult.id,
        range.from,
        range.to,
        getUser(c)?.role,
      )

      switch (result.kind) {
        case 'not_found':
          return fail(c, 'Vehicle not found', 404)
        case 'available':
          return ok(c, { available: true, vehicle: result.vehicle })
        case 'unavailable':
          return ok(c, { available: false, vehicle: result.vehicle, conflicts: result.conflicts })
      }
    })
}
