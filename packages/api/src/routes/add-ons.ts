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
import {
  fail,
  ok,
  parseArchivableFilters,
  parseBody,
  parseCrossOperatorRead,
  parseId,
  parseLocale,
  parseScopedCreate,
  stripUndefined,
} from './helpers'

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

      const locale = parseLocale(c)
      if (!locale.ok) return locale.response

      const ctx = toCallerContext(user)
      const filters: AddOnFilters = { ...parseArchivableFilters(c) }

      return ok(c, await service.findAll(ctx, parseCrossOperatorRead(c), filters, locale.locale))
    })
    .get('/add-ons/:id', async (c) => {
      const user = requireUser(c)
      if (!MANAGEMENT_READ_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const locale = parseLocale(c)
      if (!locale.ok) return locale.response

      const option = await service.findById(toCallerContext(user), idResult.id, locale.locale)
      if (!option) return fail(c, 'Add-on not found', 404)
      return ok(c, option)
    })
    .post('/add-ons', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const locale = parseLocale(c)
      if (!locale.ok) return locale.response

      const ctx = toCallerContext(user)
      const parsed = await parseScopedCreate(
        c,
        ctx,
        { operator: createAddOnSchema, admin: platformAdminCreateAddOnSchema },
        resolveWriteOperatorId,
      )
      if (!parsed.ok) return parsed.response
      const { data: d, operatorId } = parsed

      const result = await service.create(
        ctx,
        {
          operatorId,
          templateId: d.templateId,
          descriptionOverride: d.descriptionOverride ?? null,
          priceJpy: d.priceJpy,
        },
        locale.locale,
      )
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

      const locale = parseLocale(c)
      if (!locale.ok) return locale.response

      const result = await service.update(
        toCallerContext(user),
        idResult.id,
        stripUndefined(parsed.data) as AddOnUpdate,
        locale.locale,
      )
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.option)
    })
    .delete('/add-ons/:id', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const locale = parseLocale(c)
      if (!locale.ok) return locale.response

      const result = await service.archive(toCallerContext(user), idResult.id, locale.locale)
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.option)
    })
}
