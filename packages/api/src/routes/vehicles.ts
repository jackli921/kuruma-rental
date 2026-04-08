import { Hono } from 'hono'
import {
  createVehicleSchema,
  updateVehicleSchema,
} from '@kuruma/shared/validators/vehicle'
import type { Vehicle } from '../stores'
import { getVehicleStore } from '../stores'

// Re-export for backward compatibility with existing tests
export { resetVehicleStore } from '../stores'

const vehicles = new Hono()

vehicles.get('/vehicles', (c) => {
  const status = c.req.query('status') ?? 'AVAILABLE'
  const filtered = [...getVehicleStore().values()].filter((v) => v.status === status)
  return c.json({ success: true, data: filtered })
})

vehicles.get('/vehicles/:id', (c) => {
  const vehicle = getVehicleStore().get(c.req.param('id'))
  if (!vehicle) {
    return c.json({ success: false, error: 'Vehicle not found' }, 404)
  }
  return c.json({ success: true, data: vehicle })
})

vehicles.post('/vehicles', async (c) => {
  const body = await c.req.json()
  const result = createVehicleSchema.safeParse(body)

  if (!result.success) {
    return c.json(
      { success: false, error: result.error.flatten().fieldErrors },
      400,
    )
  }

  const now = new Date()
  const vehicle: Vehicle = {
    id: crypto.randomUUID(),
    name: result.data.name,
    description: result.data.description ?? null,
    seats: result.data.seats,
    transmission: result.data.transmission,
    fuelType: result.data.fuelType ?? null,
    status: 'AVAILABLE',
    bufferMinutes: result.data.bufferMinutes,
    minRentalHours: result.data.minRentalHours ?? null,
    maxRentalHours: result.data.maxRentalHours ?? null,
    advanceBookingHours: result.data.advanceBookingHours ?? null,
    createdAt: now,
    updatedAt: now,
  }

  getVehicleStore().set(vehicle.id, vehicle)
  return c.json({ success: true, data: vehicle }, 201)
})

vehicles.patch('/vehicles/:id', async (c) => {
  const vehicle = getVehicleStore().get(c.req.param('id'))
  if (!vehicle) {
    return c.json({ success: false, error: 'Vehicle not found' }, 404)
  }

  const body = await c.req.json()
  const result = updateVehicleSchema.safeParse(body)

  if (!result.success) {
    return c.json(
      { success: false, error: result.error.flatten().fieldErrors },
      400,
    )
  }

  const updated: Vehicle = {
    ...vehicle,
    ...result.data,
    description: result.data.description ?? vehicle.description,
    fuelType: result.data.fuelType ?? vehicle.fuelType,
    minRentalHours: result.data.minRentalHours ?? vehicle.minRentalHours,
    maxRentalHours: result.data.maxRentalHours ?? vehicle.maxRentalHours,
    advanceBookingHours:
      result.data.advanceBookingHours ?? vehicle.advanceBookingHours,
    updatedAt: new Date(),
  }

  getVehicleStore().set(updated.id, updated)
  return c.json({ success: true, data: updated })
})

vehicles.delete('/vehicles/:id', (c) => {
  const vehicle = getVehicleStore().get(c.req.param('id'))
  if (!vehicle) {
    return c.json({ success: false, error: 'Vehicle not found' }, 404)
  }

  const retired: Vehicle = {
    ...vehicle,
    status: 'RETIRED',
    updatedAt: new Date(),
  }

  getVehicleStore().set(retired.id, retired)
  return c.json({ success: true, data: retired })
})

export default vehicles
