import { Hono } from 'hono'
import {
  createVehicleSchema,
  updateVehicleSchema,
} from '@kuruma/shared/validators/vehicle'

interface Vehicle {
  id: string
  name: string
  description: string | null
  seats: number
  transmission: 'AUTO' | 'MANUAL'
  fuelType: string | null
  status: 'AVAILABLE' | 'MAINTENANCE' | 'RETIRED'
  bufferMinutes: number
  minRentalHours: number | null
  maxRentalHours: number | null
  advanceBookingHours: number | null
  createdAt: Date
  updatedAt: Date
}

// In-memory store (will be replaced by Drizzle repository later)
let store = new Map<string, Vehicle>()

export function resetVehicleStore(): void {
  store = new Map()
}

const vehicles = new Hono()

vehicles.get('/vehicles', (c) => {
  const status = c.req.query('status') ?? 'AVAILABLE'
  const filtered = [...store.values()].filter((v) => v.status === status)
  return c.json({ success: true, data: filtered })
})

vehicles.get('/vehicles/:id', (c) => {
  const vehicle = store.get(c.req.param('id'))
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

  store.set(vehicle.id, vehicle)
  return c.json({ success: true, data: vehicle }, 201)
})

vehicles.patch('/vehicles/:id', async (c) => {
  const vehicle = store.get(c.req.param('id'))
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

  store.set(updated.id, updated)
  return c.json({ success: true, data: updated })
})

vehicles.delete('/vehicles/:id', (c) => {
  const vehicle = store.get(c.req.param('id'))
  if (!vehicle) {
    return c.json({ success: false, error: 'Vehicle not found' }, 404)
  }

  const retired: Vehicle = {
    ...vehicle,
    status: 'RETIRED',
    updatedAt: new Date(),
  }

  store.set(retired.id, retired)
  return c.json({ success: true, data: retired })
})

export default vehicles
