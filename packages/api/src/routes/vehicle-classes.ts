import { type RateLimitBinding, rateLimit } from '@elithrar/workers-hono-rate-limit'
import {
  createVehicleClassSchema,
  updateVehicleClassSchema,
} from '@kuruma/shared/validators/vehicle-class'
import { type Context, Hono } from 'hono'
import {
  PUBLIC_CONTEXT,
  STAFF_ROLES,
  requireAuth,
  requireUser,
  toCallerContext,
} from '../middleware/auth'
import type { VehicleClassService } from '../services/vehicle-class'
import type { VehicleClassAvailabilityService } from '../services/vehicle-class-availability'
import { resolveOperatorIdForWrite } from '../tenancy'
import { cachePublic, fail, ok, parseBody, parseDateRange, stripUndefined } from './helpers'

export function createVehicleClassRoutes(
  service: VehicleClassService,
  availabilityService: VehicleClassAvailabilityService,
  publicCatalogLimiter?: RateLimitBinding,
) {
  const app = new Hono()

  // --- Public routes (no auth) ---
  // Registered before requireAuth so anonymous renters can browse the catalog.
  // Stack a stricter per-IP limiter on top of the global RATE_LIMITER: the
  // public endpoints are the only unauthenticated data paths and are the
  // most attractive scraping target, so they need a tighter budget than
  // the shared global one.
  if (publicCatalogLimiter) {
    const ipKey = (c: Context) => c.req.header('cf-connecting-ip') ?? ''
    app.use('/vehicle-classes', rateLimit(publicCatalogLimiter, ipKey))
    app.use('/vehicle-classes/by-slug/*', rateLimit(publicCatalogLimiter, ipKey))
    app.use('/vehicle-classes/:slug/availability', rateLimit(publicCatalogLimiter, ipKey))
  }

  return (
    app
      .get('/vehicle-classes', async (c) => {
        // Public catalog: anonymous callers see the cross-operator marketplace
        // (PUBLIC_CONTEXT -> 'all' scope) but only ACTIVE classes. status /
        // includeArchived params are ignored here — archived inventory is never
        // publicly listable (#395). Admin-scoped archived views go through the
        // protected endpoints.
        const classes = await service.findAll(PUBLIC_CONTEXT)
        // Catalog changes minutes-to-hours, not per-request. 60s at the edge
        // cuts origin traffic ~95% while keeping propagation fast enough that
        // owner edits (rate change, name fix) are visible within a minute.
        cachePublic(c, 60)
        return ok(c, classes)
      })
      .get('/vehicle-classes/by-slug/:slug', async (c) => {
        const vc = await service.findBySlug(PUBLIC_CONTEXT, c.req.param('slug'))
        if (!vc) return fail(c, 'Vehicle class not found', 404)
        cachePublic(c, 60)
        return ok(c, vc)
      })
      .get('/vehicle-classes/:slug/availability', async (c) => {
        const range = parseDateRange(c, true)
        if (!range.ok) return range.response

        const result = await availabilityService.getAvailabilityForClass(
          PUBLIC_CONTEXT,
          c.req.param('slug'),
          range.from,
          range.to,
        )
        if (!result.ok) return fail(c, result.error, result.status)
        // Short TTL — availability is time-sensitive (bookings land, vehicles
        // go under maintenance). 10s absorbs a renter's click-to-confirm
        // round trip without keeping a stale view for long. The DB exclusion
        // constraint is the real guardrail for overlap; this is just perf.
        cachePublic(c, 10)
        return ok(c, result.data)
      })
      // --- Protected routes (auth required) ---
      .use('/vehicle-classes/*', requireAuth())
      .get('/vehicle-classes/:id', async (c) => {
        // Operator-scoped: an OPERATOR_* caller can only read its own class;
        // bypass roles (STAFF/ADMIN/PLATFORM_ADMIN) read across operators (#395).
        const ctx = toCallerContext(requireUser(c))
        const vc = await service.findById(ctx, c.req.param('id'))
        if (!vc) return fail(c, 'Vehicle class not found', 404)
        return ok(c, vc)
      })
      .post('/vehicle-classes', async (c) => {
        const user = requireUser(c)
        if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

        const parsed = await parseBody(c, createVehicleClassSchema)
        if (!parsed.ok) return parsed.response

        const d = parsed.data
        const result = await service.create(toCallerContext(user), {
          // Transitional: legacy STAFF/ADMIN writes attach to the default
          // operator until operator-portal write flows land (#386).
          operatorId: resolveOperatorIdForWrite(toCallerContext(user)),
          name: d.name,
          slug: d.slug,
          description: d.description ?? null,
          photos: d.photos,
          seats: d.seats,
          luggageCapacity: d.luggageCapacity,
          transmission: d.transmission,
          fuelType: d.fuelType ?? null,
          dailyRateJpy: d.dailyRateJpy ?? null,
          hourlyRateJpy: d.hourlyRateJpy ?? null,
          sortOrder: d.sortOrder,
          status: 'ACTIVE',
        })

        if (!result.ok) return fail(c, result.error, result.status)
        return ok(c, result.vehicleClass, 201)
      })
      .patch('/vehicle-classes/:id', async (c) => {
        const user = requireUser(c)
        if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

        const parsed = await parseBody(c, updateVehicleClassSchema)
        if (!parsed.ok) return parsed.response

        const result = await service.update(
          toCallerContext(user),
          c.req.param('id'),
          stripUndefined(parsed.data) as Partial<import('../stores').VehicleClass>,
        )
        if (!result.ok) return fail(c, result.error, result.status)
        return ok(c, result.vehicleClass)
      })
      .delete('/vehicle-classes/:id', async (c) => {
        const user = requireUser(c)
        if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

        const result = await service.archive(toCallerContext(user), c.req.param('id'))
        if (!result.ok) {
          const extras: Record<string, unknown> = {}
          if (result.code) extras.code = result.code
          if (result.activeBookingsCount !== undefined) {
            extras.activeBookingsCount = result.activeBookingsCount
          }
          return fail(c, result.error, result.status, extras)
        }
        return ok(c, result.vehicleClass)
      })
  )
}
