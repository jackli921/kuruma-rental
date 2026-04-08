import { eq } from 'drizzle-orm'
import { getDb } from '@kuruma/shared/db'
import { vehicles, bookings, users } from '@kuruma/shared/db/schema'

const db = getDb()

export { db }

export async function cleanupVehicles(ids: string[]): Promise<void> {
  if (ids.length === 0) return

  for (const id of ids) {
    await db.delete(bookings).where(eq(bookings.vehicleId, id))
  }
  for (const id of ids) {
    await db.delete(vehicles).where(eq(vehicles.id, id))
  }
}

export async function cleanupBookings(ids: string[]): Promise<void> {
  if (ids.length === 0) return

  for (const id of ids) {
    await db.delete(bookings).where(eq(bookings.id, id))
  }
}

export async function cleanupUsers(ids: string[]): Promise<void> {
  if (ids.length === 0) return

  for (const id of ids) {
    await db.delete(bookings).where(eq(bookings.renterId, id))
  }
  for (const id of ids) {
    await db.delete(users).where(eq(users.id, id))
  }
}
