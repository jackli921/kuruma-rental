import { Hono } from 'hono'
import { STAFF_ROLES, getUser } from '../middleware/auth'
import type { AvailabilityRepository } from '../repositories/types'
import { fail, ok, parseDateRange, parseId } from './helpers'

export function createAvailabilityRoutes(repo: AvailabilityRepository) {
  return new Hono()
    .get('/availability', async (c) => {
      const range = parseDateRange(c, true)
      if (!range.ok) return range.response

      const available = await repo.findAvailableVehicles(range.from, range.to)
      return ok(c, available)
    })
    .get('/availability/:vehicleId', async (c) => {
      const idResult = parseId(c, 'vehicleId')
      if (!idResult.ok) return idResult.response
      const range = parseDateRange(c, true)
      if (!range.ok) return range.response

      const result = await repo.checkVehicleAvailability(idResult.id, range.from, range.to)
      if (!result) {
        return fail(c, 'Vehicle not found', 404)
      }

      if (result.available) {
        return ok(c, { available: true, vehicle: result.vehicle })
      }

      const user = getUser(c)
      const isStaff = user != null && STAFF_ROLES.has(user.role)

      const conflicts = isStaff
        ? result.conflicts
        : result.conflicts.map((b) => ({ startAt: b.startAt, effectiveEndAt: b.effectiveEndAt }))

      return ok(c, {
        available: false,
        vehicle: result.vehicle,
        conflicts,
      })
    })
}
