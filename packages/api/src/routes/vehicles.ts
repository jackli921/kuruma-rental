import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getDb } from '@kuruma/shared/db'
import { vehicles as vehiclesTable } from '@kuruma/shared/db/schema'
import {
  createVehicleSchema,
  updateVehicleSchema,
} from '@kuruma/shared/validators/vehicle'

const vehicles = new Hono()

vehicles.get('/vehicles', async (c) => {
  const db = getDb()
  const status = c.req.query('status') ?? 'AVAILABLE'
  const rows = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.status, status as 'AVAILABLE' | 'MAINTENANCE' | 'RETIRED'))
  return c.json({ success: true, data: rows })
})

vehicles.get('/vehicles/:id', async (c) => {
  const db = getDb()
  const rows = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, c.req.param('id')))
  const vehicle = rows[0]
  if (!vehicle) {
    return c.json({ success: false, error: 'Vehicle not found' }, 404)
  }
  return c.json({ success: true, data: vehicle })
})

vehicles.post('/vehicles', async (c) => {
  const db = getDb()
  const body = await c.req.json()
  const result = createVehicleSchema.safeParse(body)

  if (!result.success) {
    return c.json(
      { success: false, error: result.error.flatten().fieldErrors },
      400,
    )
  }

  const rows = await db
    .insert(vehiclesTable)
    .values(result.data)
    .returning()
  return c.json({ success: true, data: rows[0] }, 201)
})

vehicles.patch('/vehicles/:id', async (c) => {
  const db = getDb()
  const id = c.req.param('id')

  const existing = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, id))
  if (!existing[0]) {
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

  const rows = await db
    .update(vehiclesTable)
    .set({ ...result.data, updatedAt: new Date() })
    .where(eq(vehiclesTable.id, id))
    .returning()
  return c.json({ success: true, data: rows[0] })
})

vehicles.delete('/vehicles/:id', async (c) => {
  const db = getDb()
  const id = c.req.param('id')

  const existing = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, id))
  if (!existing[0]) {
    return c.json({ success: false, error: 'Vehicle not found' }, 404)
  }

  const rows = await db
    .update(vehiclesTable)
    .set({ status: 'RETIRED', updatedAt: new Date() })
    .where(eq(vehiclesTable.id, id))
    .returning()
  return c.json({ success: true, data: rows[0] })
})

export default vehicles
