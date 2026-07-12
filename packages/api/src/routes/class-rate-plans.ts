import {
  createClassRatePlanSchema,
  platformAdminCreateClassRatePlanSchema,
  updateClassRatePlanSchema,
} from '@kuruma/shared/validators/class-rate-plan'
import { Hono } from 'hono'
import { MANAGEMENT_READ_ROLES, requireAuth, requireUser, toCallerContext } from '../middleware/auth'
import type { ClassRatePlanService } from '../services/class-rate-plan'
import type { ClassRatePlanFilters } from '../services/filters'
import type { ResolveWriteOperatorId } from '../tenancy'
import {
  fail,
  failResult,
  ok,
  parseBody,
  parseCrossOperatorRead,
  parseId,
  parseScopedCreate,
  requireFleetWriteRole,
  stripUndefined,
} from './helpers'

export function createClassRatePlanRoutes(
  service: ClassRatePlanService,
  resolveWriteOperatorId: ResolveWriteOperatorId,
) {
  const app = new Hono()

  // Combo deals are operator-private config — no public routes. Auth gates every path.
  app.use('/class-rate-plans', requireAuth())
  app.use('/class-rate-plans/*', requireAuth())

  return app
    .get('/class-rate-plans', async (c) => {
      const user = requireUser(c)
      if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const ctx = toCallerContext(user)
      const filters: ClassRatePlanFilters = {}

      const classId = c.req.query('classId')
      if (classId) filters.classId = classId

      const pickupLocationId = c.req.query('pickupLocationId')
      if (pickupLocationId) filters.pickupLocationId = pickupLocationId

      const isActive = c.req.query('isActive')
      if (isActive === 'true' || isActive === 'false') filters.isActive = isActive === 'true'

      return ok(c, await service.findAll(ctx, parseCrossOperatorRead(c), filters))
    })
    .get('/class-rate-plans/:id', async (c) => {
      const user = requireUser(c)
      if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const plan = await service.findById(toCallerContext(user), idResult.id)
      if (!plan) return fail(c, 'Combo deal not found', 404)
      return ok(c, plan)
    })
    .post('/class-rate-plans', async (c) => {
      const user = requireUser(c)
      const denied = requireFleetWriteRole(c, user)
      if (denied) return denied

      const ctx = toCallerContext(user)
      const parsed = await parseScopedCreate(
        c,
        ctx,
        { operator: createClassRatePlanSchema, admin: platformAdminCreateClassRatePlanSchema },
        resolveWriteOperatorId,
      )
      if (!parsed.ok) return parsed.response
      const { data: d, operatorId } = parsed

      const result = await service.create(ctx, {
        operatorId,
        classId: d.classId,
        pickupLocationId: d.pickupLocationId,
        dayRateJpy: d.dayRateJpy,
        isActive: d.isActive ?? true,
        label: d.label ?? null,
      })
      if (!result.ok) return failResult(c, result)
      return ok(c, result.plan, 201)
    })
    .patch('/class-rate-plans/:id', async (c) => {
      const user = requireUser(c)
      const denied = requireFleetWriteRole(c, user)
      if (denied) return denied

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const parsed = await parseBody(c, updateClassRatePlanSchema)
      if (!parsed.ok) return parsed.response

      const result = await service.update(
        toCallerContext(user),
        idResult.id,
        stripUndefined(parsed.data),
        c.req.query('operatorId'),
      )
      if (!result.ok) return failResult(c, result)
      return ok(c, result.plan)
    })
    .delete('/class-rate-plans/:id', async (c) => {
      const user = requireUser(c)
      const denied = requireFleetWriteRole(c, user)
      if (denied) return denied

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const result = await service.remove(
        toCallerContext(user),
        idResult.id,
        c.req.query('operatorId'),
      )
      if (!result.ok) return failResult(c, result)
      return ok(c, result.plan)
    })
}
