import { getDb } from '@kuruma/shared/db'
import { vehicles } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'

export async function getAvailableVehicles() {
  const db = getDb()
  return db.select().from(vehicles).where(eq(vehicles.status, 'AVAILABLE'))
}

export async function getVehicleById(id: string) {
  const db = getDb()
  const rows = await db.select().from(vehicles).where(eq(vehicles.id, id))
  const vehicle = rows[0]
  return vehicle ?? null
}
