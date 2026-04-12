import {
  createVehicleSchema,
  updateVehicleSchema,
  updateVehicleStatusSchema,
} from '@kuruma/shared/validators/vehicle'
import { Hono } from 'hono'
import { STAFF_ROLES, getUser } from '../middleware/auth'
import type { Vehicle, VehicleRepository } from '../repositories/types'
import { fail, ok, parseBody, stripUndefined } from './helpers'

function requireStaff(c: { get: (key: string) => unknown }): Response | null {
  const user = getUser(c)
  if (user && !STAFF_ROLES.has(user.role)) {
    return fail(c as Parameters<typeof fail>[0], 'Forbidden: requires STAFF or ADMIN role', 403)
  }
  return null
}

export function createVehicleRoutes(repo: VehicleRepository): Hono {
  const vehicles = new Hono()

  // Read endpoints — any authenticated user
  vehicles.get('/vehicles', async (c) => {
    const status = c.req.query('status')
    const filtered = status ? await repo.findAll({ status }) : await repo.findAll()
    return ok(c, filtered)
  })

  vehicles.get('/vehicles/:id', async (c) => {
    const vehicle = await repo.findById(c.req.param('id'))
    if (!vehicle) {
      return fail(c, 'Vehicle not found', 404)
    }
    return ok(c, vehicle)
  })

  // Write endpoints — STAFF/ADMIN only
  vehicles.post('/vehicles', async (c) => {
    const denied = requireStaff(c)
    if (denied) return denied

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
    const denied = requireStaff(c)
    if (denied) return denied

    const existing = await repo.findById(c.req.param('id'))
    if (!existing) {
      return fail(c, 'Vehicle not found', 404)
    }

    const parsed = await parseBody(c, updateVehicleSchema)
    if (!parsed.ok) return parsed.response

    const changes = {
      ...parsed.data,
      description: parsed.data.description ?? existing.description,
      fuelType: parsed.data.fuelType ?? existing.fuelType,
      minRentalHours: parsed.data.minRentalHours ?? existing.minRentalHours,
      maxRentalHours: parsed.data.maxRentalHours ?? existing.maxRentalHours,
      advanceBookingHours: parsed.data.advanceBookingHours ?? existing.advanceBookingHours,
      dailyRateJpy: parsed.data.dailyRateJpy ?? existing.dailyRateJpy,
      hourlyRateJpy: parsed.data.hourlyRateJpy ?? existing.hourlyRateJpy,
    }
    const updated = await repo.update(existing.id, stripUndefined(changes) as Partial<Vehicle>)

    return ok(c, updated)
  })

  vehicles.patch('/vehicles/:id/status', async (c) => {
    const denied = requireStaff(c)
    if (denied) return denied

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
    const denied = requireStaff(c)
    if (denied) return denied

    const existing = await repo.findById(c.req.param('id'))
    if (!existing) {
      return fail(c, 'Vehicle not found', 404)
    }

    const retired = await repo.softDelete(existing.id)
    return ok(c, retired)
  })

  return vehicles
}
