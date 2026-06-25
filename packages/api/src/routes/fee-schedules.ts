import type { CreateFeeScheduleInput } from '@kuruma/shared/validators/fee-schedule'
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
import { type ResolveWriteOperatorId, operatorReadScope } from '../tenancy'
import { fail, ok, parseBody, parseId, stripUndefined } from './helpers'

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

      // Bypass-scope callers (PLATFORM_ADMIN, legacy STAFF/ADMIN) must scope
      // explicitly. This 400 is now redundant defence-in-depth: the repo reads
      // nothing for an unscoped bypass caller (#1107), so the real seal is the
      // threaded intent below — operatorId narrows, includeAllOperators opts in.
      if (operatorReadScope(ctx).kind === 'all') {
        const operatorIdParam = c.req.query('operatorId')
        const includeAll = c.req.query('includeAll') === 'true'
        if (!operatorIdParam && !includeAll) {
          return fail(c, 'operatorId or includeAll=true is required for cross-operator reads', 400)
        }
        if (operatorIdParam) filters.operatorId = operatorIdParam
        if (includeAll) filters.includeAllOperators = true
      }

      return ok(c, await service.findAll(ctx, filters))
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
      // Bypass callers must name the target operator in the body; operator
      // callers never send one — their tenant is stamped server-side.
      const isBypass = operatorReadScope(ctx).kind === 'all'

      let d: CreateFeeScheduleInput
      let operatorId: string
      if (isBypass) {
        const parsed = await parseBody(c, platformAdminCreateFeeScheduleSchema)
        if (!parsed.ok) return parsed.response
        d = parsed.data
        operatorId = await resolveWriteOperatorId(ctx, parsed.data.operatorId)
      } else {
        const parsed = await parseBody(c, createFeeScheduleSchema)
        if (!parsed.ok) return parsed.response
        d = parsed.data
        operatorId = await resolveWriteOperatorId(ctx)
      }

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
