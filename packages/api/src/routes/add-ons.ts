import {
  createAddOnSchema,
  platformAdminCreateAddOnSchema,
  updateAddOnSchema,
} from '@kuruma/shared/validators/add-on'
import { Hono } from 'hono'
import {
  FLEET_WRITE_ROLES,
  MANAGEMENT_READ_ROLES,
  requireAuth,
  requireUser,
  toCallerContext,
} from '../middleware/auth'
import type { AddOnService } from '../services/add-on'
import type { AddOnFilters } from '../services/filters'
import type { AddOn } from '../stores'
import { type ResolveWriteOperatorId, operatorReadScope } from '../tenancy'
import { fail, ok, parseBody, parseId, parseScopedCreate, stripUndefined } from './helpers'

export function createAddOnRoutes(
  service: AddOnService,
  resolveWriteOperatorId: ResolveWriteOperatorId,
) {
  const app = new Hono()

  // No public routes — add-ons are operator-private config (#460). Auth gates
  // every path; reads further require a management role (RENTER/PARTNER
  // rejected) below.
  app.use('/add-ons', requireAuth())
  app.use('/add-ons/*', requireAuth())

  return app
    .get('/add-ons', async (c) => {
      const user = requireUser(c)
      // [P0] reads are management-only: RENTER + PARTNER are NOT served
      // operator-private config (unlike the public vehicle catalog).
      if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const ctx = toCallerContext(user)
      const filters: AddOnFilters = {}

      const status = c.req.query('status')
      if (status === 'ACTIVE' || status === 'ARCHIVED') filters.status = status
      if (c.req.query('includeArchived') === 'true') filters.includeArchived = true

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
    .get('/add-ons/:id', async (c) => {
      const user = requireUser(c)
      if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const option = await service.findById(toCallerContext(user), idResult.id)
      if (!option) return fail(c, 'Add-on not found', 404)
      return ok(c, option)
    })
    .post('/add-ons', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const ctx = toCallerContext(user)
      // Bypass callers name the target operator in the body; operator callers
      // never send one — their tenant is stamped server-side (#1107).
      const scoped = await parseScopedCreate(
        c,
        ctx,
        {
          operatorSchema: createAddOnSchema,
          adminSchema: platformAdminCreateAddOnSchema,
        },
        resolveWriteOperatorId,
      )
      if (!scoped.ok) return scoped.response
      const { data: d, operatorId } = scoped

      const result = await service.create(ctx, {
        operatorId,
        name: d.name,
        description: d.description ?? null,
        priceJpy: d.priceJpy,
        status: 'ACTIVE',
      })
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.option, 201)
    })
    .patch('/add-ons/:id', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const parsed = await parseBody(c, updateAddOnSchema)
      if (!parsed.ok) return parsed.response

      const result = await service.update(
        toCallerContext(user),
        idResult.id,
        stripUndefined(parsed.data) as Partial<AddOn>,
      )
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.option)
    })
    .delete('/add-ons/:id', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const result = await service.archive(toCallerContext(user), idResult.id)
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.option)
    })
}
