import { Hono } from 'hono'
import type { AvailabilityRepository } from '../repositories/types'
import { fail, ok, parseDateRange } from './helpers'

export function createAvailabilityRoutes(repo: AvailabilityRepository): Hono {
  const availability = new Hono()

  availability.get('/availability', async (c) => {
    const range = parseDateRange(c, true)
    if (!range.ok) return range.response

    const available = await repo.findAvailableVehicles(range.from, range.to)
    return ok(c, available)
  })

  availability.get('/availability/:vehicleId', async (c) => {
    const vehicleId = c.req.param('vehicleId')
    const range = parseDateRange(c, true)
    if (!range.ok) return range.response

    const result = await repo.checkVehicleAvailability(vehicleId, range.from, range.to)
    if (!result) {
      return fail(c, 'Vehicle not found', 404)
    }

    if (result.available) {
      return ok(c, { available: true, vehicle: result.vehicle })
    }

    return ok(c, {
      available: false,
      vehicle: result.vehicle,
      conflicts: result.conflicts,
    })
  })

  return availability
}
