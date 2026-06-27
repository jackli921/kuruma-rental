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
import type { AddOnService, AddOnUpdate } from '../services/add-on'
import type { AddOnFilters } from '../services/filters'
import type { ResolveWriteOperatorId } from '../tenancy'
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
      const parsed = await parseScopedCreate(
        c,
        ctx,
        { operator: createAddOnSchema, admin: platformAdminCreateAddOnSchema },
        resolveWriteOperatorId,
      )
      if (!parsed.ok) return parsed.response
      const { data: d, operatorId } = parsed

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
        stripUndefined(parsed.data) as AddOnUpdate,
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
