import type { CreateLocationInput } from '@kuruma/shared/validators/location'
import {
  createLocationSchema,
  platformAdminCreateLocationSchema,
  updateLocationSchema,
} from '@kuruma/shared/validators/location'
import { Hono } from 'hono'
import { FLEET_WRITE_ROLES, requireAuth, requireUser, toCallerContext } from '../middleware/auth'
import type { LocationFilters } from '../repositories/types'
import type { LocationService } from '../services/location'
import type { Location } from '../stores'
import { operatorReadScope, resolveOperatorIdForWrite } from '../tenancy'
import { fail, ok, parseBody, stripUndefined } from './helpers'

export function createLocationRoutes(service: LocationService) {
  const app = new Hono()

  // No public routes in slice 2 — locations are operator-portal only until
  // renter discovery lands (slice 5 / #391). Auth gates every path.
  app.use('/locations', requireAuth())
  app.use('/locations/*', requireAuth())

  return app
    .get('/locations', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const ctx = toCallerContext(user)
      const filters: LocationFilters = {}

      const status = c.req.query('status')
      if (status === 'ACTIVE' || status === 'ARCHIVED') filters.status = status
      if (c.req.query('includeArchived') === 'true') filters.includeArchived = true

      // Bypass-scope callers (PLATFORM_ADMIN, legacy STAFF/ADMIN) must scope
      // explicitly — an accidental unscoped list across every operator is the
      // exact leak we guard (#387 amendment item 2). Operator callers
      // auto-scope, and any operatorId they pass is ignored here + at the repo.
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
    .get('/locations/:id', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const location = await service.findById(toCallerContext(user), c.req.param('id'))
      if (!location) return fail(c, 'Location not found', 404)
      return ok(c, location)
    })
    .post('/locations', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const ctx = toCallerContext(user)
      // Bypass callers must name the target operator in the body; operator
      // callers never send one — their tenant is stamped server-side. Resolve
      // operatorId inside each branch where the body type is concrete.
      const isBypass = operatorReadScope(ctx).kind === 'all'

      let d: CreateLocationInput
      let operatorId: string
      if (isBypass) {
        const parsed = await parseBody(c, platformAdminCreateLocationSchema)
        if (!parsed.ok) return parsed.response
        d = parsed.data
        operatorId = resolveOperatorIdForWrite(ctx, parsed.data.operatorId)
      } else {
        const parsed = await parseBody(c, createLocationSchema)
        if (!parsed.ok) return parsed.response
        d = parsed.data
        operatorId = resolveOperatorIdForWrite(ctx)
      }

      const result = await service.create(ctx, {
        operatorId,
        name: d.name,
        address: d.address,
        operatingHours: d.operatingHours,
        timezone: d.timezone,
        defaultTurnaroundMinutes: d.defaultTurnaroundMinutes,
        status: 'ACTIVE',
      })
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.location, 201)
    })
    .patch('/locations/:id', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const parsed = await parseBody(c, updateLocationSchema)
      if (!parsed.ok) return parsed.response

      const result = await service.update(
        toCallerContext(user),
        c.req.param('id'),
        stripUndefined(parsed.data) as Partial<Location>,
      )
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.location)
    })
    .delete('/locations/:id', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const result = await service.archive(toCallerContext(user), c.req.param('id'))
      if (!result.ok) return fail(c, result.error, result.status)
      return ok(c, result.location)
    })
}
