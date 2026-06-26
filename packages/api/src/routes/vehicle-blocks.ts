import { createVehicleBlockSchema } from '@kuruma/shared/validators/vehicle-block'
import { Hono } from 'hono'
import { FLEET_WRITE_ROLES, requireAuth, requireUser, toCallerContext } from '../middleware/auth'
import type { VehicleBlockService } from '../services/vehicle-block'
import { fail, ok, parseBody, parseId } from './helpers'

export function createVehicleBlockRoutes(service: VehicleBlockService) {
  const app = new Hono()

  // Blocks are operator-private fleet config — auth gates every path; the service
  // is the tenant boundary (operatorId is server-derived from the vehicle).
  app.use('/vehicles/:vehicleId/blocks', requireAuth())
  app.use('/vehicles/:vehicleId/blocks/*', requireAuth())

  return app
    .post('/vehicles/:vehicleId/blocks', async (c) => {
      const user = requireUser(c)
      // Fleet writes admit STAFF roles AND tenant operators; RENTER / PARTNER are
      // rejected here and defence-in-depth at the vehicle-scoped service.
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const idResult = parseId(c, 'vehicleId')
      if (!idResult.ok) return idResult.response

      const parsed = await parseBody(c, createVehicleBlockSchema)
      if (!parsed.ok) return parsed.response

      const result = await service.createBlock(toCallerContext(user), idResult.id, parsed.data)
      if (!result.ok)
        return fail(c, result.error, result.status, result.code ? { code: result.code } : undefined)
      return ok(c, result.block, 201)
    })
    .delete('/vehicles/:vehicleId/blocks/:blockId', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const vehicleIdResult = parseId(c, 'vehicleId')
      if (!vehicleIdResult.ok) return vehicleIdResult.response
      const blockIdResult = parseId(c, 'blockId')
      if (!blockIdResult.ok) return blockIdResult.response

      const result = await service.deleteBlock(
        toCallerContext(user),
        vehicleIdResult.id,
        blockIdResult.id,
      )
      if (!result.ok)
        return fail(c, result.error, result.status, result.code ? { code: result.code } : undefined)
      return ok(c, result.block)
    })
}
