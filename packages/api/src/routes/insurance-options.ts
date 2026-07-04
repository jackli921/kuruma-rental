import {
  createInsuranceOptionSchema,
  platformAdminCreateInsuranceOptionSchema,
  updateInsuranceOptionSchema,
} from '@kuruma/shared/validators/insurance-option'
import { Hono } from 'hono'
import {
  FLEET_WRITE_ROLES,
  MANAGEMENT_READ_ROLES,
  requireAuth,
  requireUser,
  toCallerContext,
} from '../middleware/auth'
import type { InsuranceOptionFilters } from '../services/filters'
import type { InsuranceOptionService } from '../services/insurance-option'
import type { ResolveWriteOperatorId } from '../tenancy'
import {
  fail,
  failResult,
  ok,
  parseArchivableFilters,
  parseBody,
  parseCrossOperatorRead,
  parseId,
  parseScopedCreate,
  stripUndefined,
} from './helpers'

export function createInsuranceOptionRoutes(
  service: InsuranceOptionService,
  resolveWriteOperatorId: ResolveWriteOperatorId,
) {
  const app = new Hono()

  // No public routes — insurance options are operator-private config (slice 4a
  // #404). Auth gates every path; reads further require a management role
  // (RENTER/PARTNER rejected) below.
  app.use('/insurance-options', requireAuth())
  app.use('/insurance-options/*', requireAuth())

  return app
    .get('/insurance-options', async (c) => {
      const user = requireUser(c)
      // [P0] reads are management-only: RENTER + PARTNER are NOT served
      // operator-private config (unlike the public vehicle catalog).
      if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const ctx = toCallerContext(user)
      const filters: InsuranceOptionFilters = { ...parseArchivableFilters(c) }

      return ok(c, await service.findAll(ctx, parseCrossOperatorRead(c), filters))
    })
    .get('/insurance-options/:id', async (c) => {
      const user = requireUser(c)
      if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const option = await service.findById(toCallerContext(user), idResult.id)
      if (!option) return fail(c, 'Insurance option not found', 404)
      return ok(c, option)
    })
    .post('/insurance-options', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const ctx = toCallerContext(user)
      const parsed = await parseScopedCreate(
        c,
        ctx,
        { operator: createInsuranceOptionSchema, admin: platformAdminCreateInsuranceOptionSchema },
        resolveWriteOperatorId,
      )
      if (!parsed.ok) return parsed.response
      const { data: d, operatorId } = parsed

      const result = await service.create(ctx, {
        operatorId,
        name: d.name,
        description: d.description ?? null,
        dailyPriceJpy: d.dailyPriceJpy,
        deductibleJpy: d.deductibleJpy ?? null,
        status: 'ACTIVE',
      })
      if (!result.ok) return failResult(c, result)
      return ok(c, result.option, 201)
    })
    .patch('/insurance-options/:id', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const parsed = await parseBody(c, updateInsuranceOptionSchema)
      if (!parsed.ok) return parsed.response

      const result = await service.update(
        toCallerContext(user),
        idResult.id,
        stripUndefined(parsed.data),
      )
      if (!result.ok) return failResult(c, result)
      return ok(c, result.option)
    })
    .delete('/insurance-options/:id', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const result = await service.archive(toCallerContext(user), idResult.id)
      if (!result.ok) return failResult(c, result)
      return ok(c, result.option)
    })
}
