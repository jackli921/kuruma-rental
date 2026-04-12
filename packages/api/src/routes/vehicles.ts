import {
  createVehicleSchema,
  updateVehicleSchema,
  updateVehicleStatusSchema,
} from '@kuruma/shared/validators/vehicle'
import { Hono } from 'hono'
import type { Vehicle, VehicleRepository } from '../repositories/types'
import { fail, ok, parseBody, stripUndefined } from './helpers'

export function createVehicleRoutes(repo: VehicleRepository): Hono {
  const vehicles = new Hono()

  vehicles.get('/vehicles', async (c) => {
    const status = c.req.query('status')
    const limitParam = c.req.query('limit')
    const offsetParam = c.req.query('offset')

    const limit = limitParam ? Number.parseInt(limitParam, 10) : 50
    if (Number.isNaN(limit) || limit < 1 || limit > 100) {
      return fail(c, 'limit must be between 1 and 100', 400)
    }
    const offset = offsetParam ? Number.parseInt(offsetParam, 10) : 0
    if (Number.isNaN(offset) || offset < 0) {
      return fail(c, 'offset must be a non-negative integer', 400)
    }

    const all = status ? await repo.findAll({ status }) : await repo.findAll()
    const page = all.slice(offset, offset + limit)
    return ok(c, page, 200, { total: all.length, limit, offset })
  })

  vehicles.get('/vehicles/:id', async (c) => {
    const vehicle = await repo.findById(c.req.param('id'))
    if (!vehicle) {
      return fail(c, 'Vehicle not found', 404)
    }
    return ok(c, vehicle)
  })

  vehicles.post('/vehicles', async (c) => {
    const parsed = await parseBody(c, createVehicleSchema)
    if (!parsed.ok) return parsed.response

    const vehicle = await repo.create({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      photos: parsed.data.photos,
      seats: parsed.data.seats,
      transmission: parsed.data.transmission,
      fuelType: parsed.data.fuelType ?? null,
      status: 'AVAILABLE',
      bufferMinutes: parsed.data.bufferMinutes,
      minRentalHours: parsed.data.minRentalHours ?? null,
      maxRentalHours: parsed.data.maxRentalHours ?? null,
      advanceBookingHours: parsed.data.advanceBookingHours ?? null,
      dailyRateJpy: parsed.data.dailyRateJpy ?? null,
      hourlyRateJpy: parsed.data.hourlyRateJpy ?? null,
    })

    return ok(c, vehicle, 201)
  })

  vehicles.patch('/vehicles/:id', async (c) => {
    const existing = await repo.findById(c.req.param('id'))
    if (!existing) {
      return fail(c, 'Vehicle not found', 404)
    }

    const parsed = await parseBody(c, updateVehicleSchema)
    if (!parsed.ok) return parsed.response

    // Merge patch with existing: use patch value if key was sent (even null),
    // otherwise keep existing. `??` would swallow explicit nulls.
    const d = parsed.data
    const merge = <T>(key: string, fallback: T): T =>
      key in d ? ((d as Record<string, unknown>)[key] as T) : fallback

    const changes = {
      ...d,
      description: merge('description', existing.description),
      fuelType: merge('fuelType', existing.fuelType),
      minRentalHours: merge('minRentalHours', existing.minRentalHours),
      maxRentalHours: merge('maxRentalHours', existing.maxRentalHours),
      advanceBookingHours: merge('advanceBookingHours', existing.advanceBookingHours),
      dailyRateJpy: merge('dailyRateJpy', existing.dailyRateJpy),
      hourlyRateJpy: merge('hourlyRateJpy', existing.hourlyRateJpy),
    }

    if (changes.dailyRateJpy == null && changes.hourlyRateJpy == null) {
      return fail(c, 'At least one rate (daily or hourly) is required', 400)
    }

    const mergedMin = changes.minRentalHours
    const mergedMax = changes.maxRentalHours
    if (mergedMin != null && mergedMax != null && mergedMin > mergedMax) {
      return fail(
        c,
        { maxRentalHours: ['Maximum rental hours must be greater than or equal to minimum'] },
        400,
      )
    }

    const updated = await repo.update(existing.id, stripUndefined(changes) as Partial<Vehicle>)

    return ok(c, updated)
  })

  vehicles.patch('/vehicles/:id/status', async (c) => {
    const existing = await repo.findById(c.req.param('id'))
    if (!existing) {
      return fail(c, 'Vehicle not found', 404)
    }

    const parsed = await parseBody(c, updateVehicleStatusSchema)
    if (!parsed.ok) return parsed.response

    const updated = await repo.update(existing.id, { status: parsed.data.status })
    return ok(c, updated)
  })

  vehicles.delete('/vehicles/:id', async (c) => {
    const existing = await repo.findById(c.req.param('id'))
    if (!existing) {
      return fail(c, 'Vehicle not found', 404)
    }

    const retired = await repo.softDelete(existing.id)
    return ok(c, retired)
  })

  return vehicles
}
