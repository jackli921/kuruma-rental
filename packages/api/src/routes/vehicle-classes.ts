import {
  createVehicleClassSchema,
  updateVehicleClassSchema,
} from '@kuruma/shared/validators/vehicle-class'
import { Hono } from 'hono'
import { STAFF_ROLES, requireUser } from '../middleware/auth'
import type { VehicleClassService } from '../services/vehicle-class'
import { fail, ok, parseBody, stripUndefined } from './helpers'

export function createVehicleClassRoutes(service: VehicleClassService) {
  return new Hono()
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
}
