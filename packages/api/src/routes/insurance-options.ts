import type { CreateInsuranceOptionInput } from '@kuruma/shared/validators/insurance-option'
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
import type { InsuranceOptionFilters } from '../repositories/types'
import type { InsuranceOptionService } from '../services/insurance-option'
import type { InsuranceOption } from '../stores'
import { type ResolveWriteOperatorId, operatorReadScope } from '../tenancy'
import { fail, ok, parseBody, stripUndefined } from './helpers'

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
      const filters: InsuranceOptionFilters = {}

      const status = c.req.query('status')
      if (status === 'ACTIVE' || status === 'ARCHIVED') filters.status = status
      if (c.req.query('includeArchived') === 'true') filters.includeArchived = true

      // Bypass-scope callers (PLATFORM_ADMIN, legacy STAFF/ADMIN) must scope
      // explicitly — an accidental unscoped list across every operator is the
      // exact leak we guard. Operator callers auto-scope, and any operatorId
      // they pass is ignored here + at the repo.
      if (operatorReadScope(ctx).kind === 'all') {
        const operatorIdParam = c.req.query('operatorId')
        const includeAll = c.req.query('includeAll') === 'true'
        if (!operatorIdParam && !includeAll) {
          return fail(c, 'operatorId or includeAll=true is required for cross-operator reads', 400)
        }
        if (operatorIdParam) filters.operatorId = operatorIdParam
      }

      return ok(c, await service.findAll(ctx, filters))
    })
    .get('/insurance-options/:id', async (c) => {
      const user = requireUser(c)
      if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const option = await service.findById(toCallerContext(user), c.req.param('id'))
      if (!option) return fail(c, 'Insurance option not found', 404)
      return ok(c, option)
    })
    .post('/insurance-options', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const ctx = toCallerContext(user)
      // Bypass callers must name the target operator in the body; operator
      // callers never send one — their tenant is stamped server-side. Resolve
      // operatorId inside each branch where the body type is concrete.
      const isBypass = operatorReadScope(ctx).kind === 'all'

      let d: CreateInsuranceOptionInput
      let operatorId: string
      if (isBypass) {
        const parsed = await parseBody(c, platformAdminCreateInsuranceOptionSchema)
        if (!parsed.ok) return parsed.response
        d = parsed.data
        operatorId = await resolveWriteOperatorId(ctx, parsed.data.operatorId)
      } else {
        const parsed = await parseBody(c, createInsuranceOptionSchema)
        if (!parsed.ok) return parsed.response
        d = parsed.data
        operatorId = await resolveWriteOperatorId(ctx)
      }

      const result = await service.create(ctx, {
        operatorId,
        name: d.name,
        description: d.description ?? null,
        dailyPriceJpy: d.dailyPriceJpy,
        deductibleJpy: d.deductibleJpy ?? null,
        status: 'ACTIVE',
      })
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.option, 201)
    })
    .patch('/insurance-options/:id', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const parsed = await parseBody(c, updateInsuranceOptionSchema)
      if (!parsed.ok) return parsed.response

      const result = await service.update(
        toCallerContext(user),
        c.req.param('id'),
        stripUndefined(parsed.data) as Partial<InsuranceOption>,
      )
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.option)
    })
    .delete('/insurance-options/:id', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const result = await service.archive(toCallerContext(user), c.req.param('id'))
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.option)
    })
}
