import { type RateLimitBinding, rateLimit } from '@elithrar/workers-hono-rate-limit'
import {
  createVehicleClassSchema,
  updateVehicleClassSchema,
} from '@kuruma/shared/validators/vehicle-class'
import { type Context, Hono } from 'hono'
import { STAFF_ROLES, requireAuth, requireUser } from '../middleware/auth'
import type { VehicleClassService } from '../services/vehicle-class'
import type { VehicleClassAvailabilityService } from '../services/vehicle-class-availability'
import { fail, ok, parseBody, parseDateRange, stripUndefined } from './helpers'

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
        const rawStatus = c.req.query('status')
        const status: 'ACTIVE' | 'ARCHIVED' | undefined =
          rawStatus === 'ACTIVE' || rawStatus === 'ARCHIVED' ? rawStatus : undefined
        const includeArchived = c.req.query('includeArchived') === 'true'
        const classes = await service.findAll(
          status ? { status } : includeArchived ? { includeArchived } : undefined,
        )
        return ok(c, classes)
      })
      .get('/vehicle-classes/by-slug/:slug', async (c) => {
        const vc = await service.findBySlug(c.req.param('slug'))
        if (!vc) return fail(c, 'Vehicle class not found', 404)
        return ok(c, vc)
      })
      .get('/vehicle-classes/:slug/availability', async (c) => {
        const range = parseDateRange(c, true)
        if (!range.ok) return range.response

        const result = await availabilityService.getAvailabilityForClass(
          c.req.param('slug'),
          range.from,
          range.to,
        )
        if (!result.ok) return fail(c, result.error, result.status)
        return ok(c, result.data)
      })
      // --- Protected routes (auth required) ---
      .use('/vehicle-classes/*', requireAuth())
      .get('/vehicle-classes/:id', async (c) => {
        const vc = await service.findById(c.req.param('id'))
        if (!vc) return fail(c, 'Vehicle class not found', 404)
        return ok(c, vc)
      })
      .post('/vehicle-classes', async (c) => {
        const user = requireUser(c)
        if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

        const parsed = await parseBody(c, createVehicleClassSchema)
        if (!parsed.ok) return parsed.response

        const d = parsed.data
        const result = await service.create({
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
          c.req.param('id'),
          stripUndefined(parsed.data) as Partial<import('../stores').VehicleClass>,
        )
        if (!result.ok) return fail(c, result.error, result.status)
        return ok(c, result.vehicleClass)
      })
      .delete('/vehicle-classes/:id', async (c) => {
        const user = requireUser(c)
        if (!STAFF_ROLES.has(user.role)) return fail(c, 'Forbidden', 403)

        const result = await service.archive(c.req.param('id'))
        if (!result.ok) return fail(c, result.error, result.status)
        return ok(c, result.vehicleClass)
      })
  )
}
