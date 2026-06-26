import {
  createFeeScheduleSchema,
  platformAdminCreateFeeScheduleSchema,
  updateFeeScheduleSchema,
} from '@kuruma/shared/validators/fee-schedule'
import { Hono } from 'hono'
import {
  FLEET_WRITE_ROLES,
  MANAGEMENT_READ_ROLES,
  requireAuth,
  requireUser,
  toCallerContext,
} from '../middleware/auth'
import type { FeeScheduleService } from '../services/fee-schedule'
import type { FeeScheduleFilters } from '../services/filters'
import type { FeeSchedule } from '../stores'
import type { ResolveWriteOperatorId } from '../tenancy'
import { fail, ok, parseBody, parseId, parseScopedCreate, stripUndefined } from './helpers'

export function createFeeScheduleRoutes(
  service: FeeScheduleService,
  resolveWriteOperatorId: ResolveWriteOperatorId,
) {
  const app = new Hono()

  // Fees are operator-private config — no public routes. Auth gates every path.
  app.use('/fee-schedules', requireAuth())
  app.use('/fee-schedules/*', requireAuth())

  return app
    .get('/fee-schedules', async (c) => {
      const user = requireUser(c)
      // Reads admit management roles (STAFF roles + operators); RENTER/PARTNER
      // are rejected here AND defence-in-depth at the repo via requireManagementRead.
      if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const ctx = toCallerContext(user)
      const filters: FeeScheduleFilters = {}

      const status = c.req.query('status')
      if (status === 'ACTIVE' || status === 'ARCHIVED') filters.status = status
      if (c.req.query('includeArchived') === 'true') filters.includeArchived = true
      const feeType = c.req.query('feeType')
      if (
        feeType === 'OVERTIME_HOURLY' ||
        feeType === 'CLEANING_FLAT' ||
        feeType === 'NO_FUEL_FLAT'
      )
        filters.feeType = feeType
      const vehicleClassId = c.req.query('vehicleClassId')
      if (vehicleClassId) filters.vehicleClassId = vehicleClassId

      // Cross-operator read scope is enforced in the service (audit M3): a bypass
      // caller that names neither operatorId nor includeAll is rejected there, so a
      // forgotten guard here can't leak every operator's private config. Operator
      // callers auto-scope; any operatorId they pass is ignored at the repo.
      const read = {
        operatorId: c.req.query('operatorId'),
        includeAll: c.req.query('includeAll') === 'true',
      }
      return ok(c, await service.findAll(ctx, read, filters))
    })
    .get('/fee-schedules/:id', async (c) => {
      const user = requireUser(c)
      if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const feeSchedule = await service.findById(toCallerContext(user), idResult.id)
      if (!feeSchedule) return fail(c, 'Fee schedule not found', 404)
      return ok(c, feeSchedule)
    })
    .post('/fee-schedules', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const ctx = toCallerContext(user)
      const parsed = await parseScopedCreate(
        c,
        ctx,
        { operator: createFeeScheduleSchema, admin: platformAdminCreateFeeScheduleSchema },
        resolveWriteOperatorId,
      )
      if (!parsed.ok) return parsed.response
      const { data: d, operatorId } = parsed

      const result = await service.create(ctx, {
        operatorId,
        vehicleClassId: d.vehicleClassId ?? null,
        feeType: d.feeType,
        unit: d.unit,
        amountJpy: d.amountJpy,
        status: 'ACTIVE',
      })
      if (!result.ok)
        return fail(c, result.error, result.status, result.code ? { code: result.code } : undefined)
      return ok(c, result.feeSchedule, 201)
    })
    .patch('/fee-schedules/:id', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const parsed = await parseBody(c, updateFeeScheduleSchema)
      if (!parsed.ok) return parsed.response

      const result = await service.update(
        toCallerContext(user),
        idResult.id,
        stripUndefined(parsed.data) as Partial<FeeSchedule>,
      )
      if (!result.ok)
        return fail(c, result.error, result.status, result.code ? { code: result.code } : undefined)
      return ok(c, result.feeSchedule)
    })
    .delete('/fee-schedules/:id', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const result = await service.archive(toCallerContext(user), idResult.id)
      if (!result.ok)
        return fail(c, result.error, result.status, result.code ? { code: result.code } : undefined)
      return ok(c, result.feeSchedule)
    })
}
