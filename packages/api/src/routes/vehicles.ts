import {
  bulkUpdateVehicleStatusSchema,
  createVehicleSchema,
  updateVehicleSchema,
  updateVehicleStatusWithReasonSchema,
} from '@kuruma/shared/validators/vehicle'
import { Hono } from 'hono'
import { requireUser, toCallerContext } from '../middleware/auth'
import type { MaintenanceService } from '../services/maintenance'
import type { VehicleService } from '../services/vehicle'
import {
  fail,
  failResult,
  ok,
  parseBody,
  parseId,
  parsePagination,
  requireFleetWriteRole,
} from './helpers'

export function createVehicleRoutes(
  service: VehicleService,
  maintenanceService: MaintenanceService,
) {
  return new Hono()
    .get('/vehicles', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      const status = c.req.query('status')
      const operatorId = c.req.query('operatorId')
      const pg = parsePagination(c, { defaultLimit: 50 })
      if (!pg.ok) return pg.response
      const { limit, offset } = pg

      const { data, total } = await service.findAll(
        ctx,
        { limit, offset, ...(status ? { status } : {}) },
        operatorId,
      )
      return ok(c, data, 200, { total, limit, offset })
    })
    .get('/vehicles/:id', async (c) => {
      const ctx = toCallerContext(requireUser(c))
      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response
      const vehicle = await service.findById(ctx, idResult.id)
      if (!vehicle) {
        return fail(c, 'Vehicle not found', 404)
      }
      return ok(c, vehicle)
    })
    .post('/vehicles', async (c) => {
      const user = requireUser(c)
      const denied = requireFleetWriteRole(c, user)
      if (denied) return denied

      const parsed = await parseBody(c, createVehicleSchema)
      if (!parsed.ok) return parsed.response

      const result = await service.create(toCallerContext(user), parsed.data)
      if (!result.ok) return failResult(c, result)
      return ok(c, result.vehicle, 201)
    })
    .patch('/vehicles/bulk-status', async (c) => {
      const user = requireUser(c)
      const denied = requireFleetWriteRole(c, user)
      if (denied) return denied

      const parsed = await parseBody(c, bulkUpdateVehicleStatusSchema)
      if (!parsed.ok) return parsed.response

      const result = await service.bulkUpdateStatus(
        toCallerContext(user),
        parsed.data.vehicleIds,
        parsed.data.status,
        c.req.query('operatorId'),
      )
      if (!result.ok) return failResult(c, result)
      return ok(c, result.vehicles)
    })
    .patch('/vehicles/:id', async (c) => {
      const user = requireUser(c)
      const denied = requireFleetWriteRole(c, user)
      if (denied) return denied

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const parsed = await parseBody(c, updateVehicleSchema)
      if (!parsed.ok) return parsed.response

      const result = await service.update(
        toCallerContext(user),
        idResult.id,
        parsed.data,
        c.req.query('operatorId'),
      )
      if (!result.ok) return failResult(c, result)
      return ok(c, result.vehicle)
    })
    .patch('/vehicles/:id/status', async (c) => {
      const user = requireUser(c)
      const denied = requireFleetWriteRole(c, user)
      if (denied) return denied
      const ctx = toCallerContext(user)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const parsed = await parseBody(c, updateVehicleStatusWithReasonSchema)
      if (!parsed.ok) return parsed.response

      const result = await maintenanceService.toggleStatus(
        ctx,
        idResult.id,
        parsed.data.status,
        parsed.data.reason,
        c.req.query('operatorId'),
      )
      if (!result.ok) return failResult(c, result)
      return ok(c, result.vehicle)
    })
    .delete('/vehicles/:id', async (c) => {
      const user = requireUser(c)
      const denied = requireFleetWriteRole(c, user)
      if (denied) return denied

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const result = await service.softDelete(
        toCallerContext(user),
        idResult.id,
        c.req.query('operatorId'),
      )
      if (!result.ok) return failResult(c, result)
      return ok(c, result.vehicle)
    })
}
