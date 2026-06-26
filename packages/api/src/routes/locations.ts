import {
  createLocationSchema,
  platformAdminCreateLocationSchema,
  updateLocationSchema,
} from '@kuruma/shared/validators/location'
import { Hono } from 'hono'
import { FLEET_WRITE_ROLES, requireAuth, requireUser, toCallerContext } from '../middleware/auth'
import { LOCATIONS_REGION_FK, PG_ERROR, pgConstraintName, pgErrorCode } from '../pg-errors'
import type { LocationFilters } from '../services/filters'
import type { LocationService, LocationUpdateData } from '../services/location'
import { type ResolveWriteOperatorId, operatorReadScope } from '../tenancy'
import { fail, ok, parseBody, parseId, parseScopedCreate, stripUndefined } from './helpers'

export function createLocationRoutes(
  service: LocationService,
  resolveWriteOperatorId: ResolveWriteOperatorId,
) {
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
      // explicitly. This 400 is now redundant defence-in-depth (#387 amendment
      // item 2): the repo reads nothing for an unscoped bypass caller (#1107),
      // so the real seal is the threaded intent below — operatorId narrows,
      // includeAllOperators opts in. Operator callers auto-scope at the repo.
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
    .get('/locations/:id', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const location = await service.findById(toCallerContext(user), idResult.id)
      if (!location) return fail(c, 'Location not found', 404)
      return ok(c, location)
    })
    .post('/locations', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const ctx = toCallerContext(user)
      // Bypass callers name the target operator in the body; operator callers
      // never send one — their tenant is stamped server-side (#1107).
      const scoped = await parseScopedCreate(
        c,
        ctx,
        {
          operatorSchema: createLocationSchema,
          adminSchema: platformAdminCreateLocationSchema,
        },
        resolveWriteOperatorId,
      )
      if (!scoped.ok) return scoped.response
      const { data: d, operatorId } = scoped

      try {
        const result = await service.create(ctx, {
          operatorId,
          name: d.name,
          address: d.address,
          // A submitted coord pair is an operator pin (→ MANUAL); omitted coords
          // make the service geocode `address`. Provenance is server-derived.
          latitude: d.latitude,
          longitude: d.longitude,
          operatingHours: d.operatingHours,
          timezone: d.timezone,
          defaultTurnaroundMinutes: d.defaultTurnaroundMinutes,
          regionId: d.regionId,
          status: 'ACTIVE',
        })
        if (!result.ok) return fail(c, result.error, result.status)
        return ok(c, result.location, 201)
      } catch (err) {
        // Two client-supplied FKs now: operatorId -> operators and regionId ->
        // regions (#394). A bare 23503 is ambiguous, so disambiguate on the
        // constraint name to tell a bad region apart from a bad operator (mirrors
        // the #400 vehicle/class FK->422 contract). Both map to 422 (client error).
        if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION) {
          if (pgConstraintName(err) === LOCATIONS_REGION_FK) return fail(c, 'Invalid region', 422)
          return fail(c, 'Invalid operator', 422)
        }
        throw err
      }
    })
    .patch('/locations/:id', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const parsed = await parseBody(c, updateLocationSchema)
      if (!parsed.ok) return parsed.response

      // parsed.data carries latitude/longitude/regeocode (#531) + regionId (#394);
      // the service derives coordinateSource and strips regeocode before the write.
      try {
        const result = await service.update(
          toCallerContext(user),
          idResult.id,
          stripUndefined(parsed.data) as LocationUpdateData,
        )
        if (!result.ok) return fail(c, result.error, result.status)
        return ok(c, result.location)
      } catch (err) {
        // regionId is the only client-supplied FK on update (#394) — operatorId
        // is not patchable — so a 23503 here is always a bad region. Map to 422.
        if (pgErrorCode(err) === PG_ERROR.FOREIGN_KEY_VIOLATION) {
          return fail(c, 'Invalid region', 422)
        }
        throw err
      }
    })
    .delete('/locations/:id', async (c) => {
      const user = requireUser(c)
      if (!FLEET_WRITE_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

      const idResult = parseId(c)
      if (!idResult.ok) return idResult.response

      const result = await service.archive(toCallerContext(user), idResult.id)
      if (!result.ok) {
        // Surface the active-bookings discriminator so the portal can prompt the
        // owner to reassign/cancel first instead of showing a generic 409 (#412).
        const extras: Record<string, unknown> = {}
        if (result.code) extras.code = result.code
        if (result.activeBookingsCount !== undefined) {
          extras.activeBookingsCount = result.activeBookingsCount
        }
        return fail(c, result.error, result.status, extras)
      }
      return ok(c, result.location)
    })
}
