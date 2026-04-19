import { bookings, users, vehicleClasses, vehicles } from '@kuruma/shared/db/schema'
import { eq } from 'drizzle-orm'
import { testDb } from './pg-test-client'

// Re-export as `db` so existing test files keep their import unchanged.
const db = testDb
export { db }

/** Satisfies the vehicles_pricing_at_least_one CHECK constraint. */
export const DEFAULT_DAILY_RATE_JPY = 5000

/**
 * Issue #308: bookings.classId is NOT NULL. Every integration test that
 * seeds a booking needs a vehicle_class first. Seeds a unique class so
 * parallel test files don't collide on slug/name.
 */
export async function seedVehicleClass(
  prefix = 'test',
): Promise<{ id: string; name: string; slug: string }> {
  const uniq = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const [row] = await db
    .insert(vehicleClasses)
    .values({
      id: crypto.randomUUID(),
      name: `Class ${uniq}`,
      slug: `class-${uniq}`,
      description: null,
      photos: [],
      seats: 5,
      luggageCapacity: 2,
      transmission: 'AUTO',
      fuelType: null,
      dailyRateJpy: DEFAULT_DAILY_RATE_JPY,
      hourlyRateJpy: null,
      sortOrder: 0,
      status: 'ACTIVE',
    })
    .returning({ id: vehicleClasses.id, name: vehicleClasses.name, slug: vehicleClasses.slug })
  if (!row) throw new Error('Failed to seed vehicle class')
  return row
}

export async function cleanupVehicleClasses(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  for (const id of ids) {
    await db.delete(vehicleClasses).where(eq(vehicleClasses.id, id))
  }
}

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
