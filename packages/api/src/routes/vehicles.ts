import {
  createVehicleSchema,
  updateVehicleSchema,
  updateVehicleStatusSchema,
} from '@kuruma/shared/validators/vehicle'
import { Hono } from 'hono'
import type { Vehicle, VehicleRepository } from '../repositories/types'

export function createVehicleRoutes(repo: VehicleRepository): Hono {
  const vehicles = new Hono()

  vehicles.get('/vehicles', async (c) => {
    const status = c.req.query('status')
    const filtered = status ? await repo.findAll({ status }) : await repo.findAll()
    return c.json({ success: true, data: filtered })
  })

  vehicles.get('/vehicles/:id', async (c) => {
    const vehicle = await repo.findById(c.req.param('id'))
    if (!vehicle) {
      return c.json({ success: false, error: 'Vehicle not found' }, 404)
    }
    return c.json({ success: true, data: vehicle })
  })

  vehicles.post('/vehicles', async (c) => {
    const body = await c.req.json()
    const result = createVehicleSchema.safeParse(body)

    if (!result.success) {
      return c.json({ success: false, error: result.error.flatten().fieldErrors }, 400)
    }

    const vehicle = await repo.create({
      name: result.data.name,
      description: result.data.description ?? null,
      photos: result.data.photos,
      seats: result.data.seats,
      transmission: result.data.transmission,
      fuelType: result.data.fuelType ?? null,
      status: 'AVAILABLE',
      bufferMinutes: result.data.bufferMinutes,
      minRentalHours: result.data.minRentalHours ?? null,
      maxRentalHours: result.data.maxRentalHours ?? null,
      advanceBookingHours: result.data.advanceBookingHours ?? null,
      dailyRateJpy: result.data.dailyRateJpy ?? null,
      hourlyRateJpy: result.data.hourlyRateJpy ?? null,
    })

    return c.json({ success: true, data: vehicle }, 201)
  })

  vehicles.patch('/vehicles/:id', async (c) => {
    const existing = await repo.findById(c.req.param('id'))
    if (!existing) {
      return c.json({ success: false, error: 'Vehicle not found' }, 404)
    }

    const body = await c.req.json()
    const result = updateVehicleSchema.safeParse(body)

    if (!result.success) {
      return c.json({ success: false, error: result.error.flatten().fieldErrors }, 400)
    }

    // Strip keys the partial schema left as `undefined` — Partial<Vehicle>
    // under exactOptionalPropertyTypes forbids explicit undefined values.
    const updated = await repo.update(
      existing.id,
      Object.fromEntries(
        Object.entries({
          ...result.data,
          description: result.data.description ?? existing.description,
          fuelType: result.data.fuelType ?? existing.fuelType,
          minRentalHours: result.data.minRentalHours ?? existing.minRentalHours,
          maxRentalHours: result.data.maxRentalHours ?? existing.maxRentalHours,
          advanceBookingHours: result.data.advanceBookingHours ?? existing.advanceBookingHours,
          dailyRateJpy: result.data.dailyRateJpy ?? existing.dailyRateJpy,
          hourlyRateJpy: result.data.hourlyRateJpy ?? existing.hourlyRateJpy,
        }).filter(([, v]) => v !== undefined),
      ) as Partial<Vehicle>,
    )

    return c.json({ success: true, data: updated })
  })

  // Issue #51: one-shot status toggle. Kept separate from PATCH /vehicles/:id
  // so the fleet list UI can bind a tiny optimistic mutation without sending
  // the full vehicle payload. Any transition is allowed (owner needs to be
  // able to flip a car back out of RETIRED if they soft-deleted by mistake).
  vehicles.patch('/vehicles/:id/status', async (c) => {
    const existing = await repo.findById(c.req.param('id'))
    if (!existing) {
      return c.json({ success: false, error: 'Vehicle not found' }, 404)
    }

    const body = await c.req.json()
    const result = updateVehicleStatusSchema.safeParse(body)
    if (!result.success) {
      return c.json({ success: false, error: result.error.flatten().fieldErrors }, 400)
    }

    const updated = await repo.update(existing.id, { status: result.data.status })
    return c.json({ success: true, data: updated })
  })

  vehicles.delete('/vehicles/:id', async (c) => {
    const existing = await repo.findById(c.req.param('id'))
    if (!existing) {
      return c.json({ success: false, error: 'Vehicle not found' }, 404)
    }

    const retired = await repo.softDelete(existing.id)
    return c.json({ success: true, data: retired })
  })

  return vehicles
}
