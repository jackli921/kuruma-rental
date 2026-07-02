import { createVehicleBlockSchema } from '@kuruma/shared/validators/vehicle-block'
import { Hono } from 'hono'
import {
  FLEET_WRITE_ROLES,
  MANAGEMENT_READ_ROLES,
  requireAuth,
  requireUser,
  toCallerContext,
} from '../middleware/auth'
import type { VehicleBlockService } from '../services/vehicle-block'
import { fail, ok, parseBody, parseDateRange, parseId } from './helpers'

export function createVehicleBlockRoutes(service: VehicleBlockService) {
  const app = new Hono()

  // Blocks are operator-private fleet config — auth gates every path; the service
  // is the tenant boundary (operatorId is server-derived from the vehicle).
  app.use('/vehicles/:vehicleId/blocks', requireAuth())
  app.use('/vehicles/:vehicleId/blocks/*', requireAuth())

  // The fleet-wide read lives at a top-level path, so it is NOT covered by the
  // vehicle-scoped requireAuth above — guard it here (requireUser throws 500
  // without it). Reads are management-tier (RENTER/PARTNER excluded at the gate).
  app.use('/vehicle-blocks', requireAuth())

  return app
    .get('/vehicle-blocks', async (c) => {
      const user = requireUser(c)
      if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      // The time window is the only bound (no limit/cursor), so require it: an
      // omitted range must 400, never dump all-time fleet-wide (or cross-operator).
      const range = parseDateRange(c, true)
      if (!range.ok) return range.response

      // #1230 slice 5b: a picker admin narrows the fleet read to one operator. The
      // service drops the id for any non-bypass caller, so a tenant read never widens.
      const operatorId = c.req.query('operatorId')
      const blocks = await service.listBlocks(
        toCallerContext(user),
        range.from,
        range.to,
        operatorId,
      )
      return ok(c, blocks)
    })
    .post('/vehicles/:vehicleId/blocks', async (c) => {
      const user = requireUser(c)
      // Fleet writes admit STAFF roles AND tenant operators; RENTER / PARTNER are
      // rejected here and defence-in-depth at the vehicle-scoped service.
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const idResult = parseId(c, 'vehicleId')
      if (!idResult.ok) return idResult.response

      const parsed = await parseBody(c, createVehicleBlockSchema)
      if (!parsed.ok) return parsed.response

      // #1260: a picker admin binds the write to the operator it is acting as; the
      // service drops the id for a tenant operator, so it can never widen scope.
      const actingOperatorId = c.req.query('operatorId')
      const result = await service.createBlock(
        toCallerContext(user),
        idResult.id,
        parsed.data,
        actingOperatorId,
      )
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

      // #1260: bind an admin delete to the operator it is acting as (see POST).
      const actingOperatorId = c.req.query('operatorId')
      const result = await service.deleteBlock(
        toCallerContext(user),
        vehicleIdResult.id,
        blockIdResult.id,
        actingOperatorId,
      )
      if (!result.ok)
        return fail(c, result.error, result.status, result.code ? { code: result.code } : undefined)
      return ok(c, result.block)
    })
}
