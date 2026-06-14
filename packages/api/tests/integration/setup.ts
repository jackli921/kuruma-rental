import { BEST_CAR_RENTAL_OPERATOR_ID } from '@kuruma/shared/db/constants'
import { bookings, locations, users, vehicleClasses, vehicles } from '@kuruma/shared/db/schema'
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
  operatorId: string = BEST_CAR_RENTAL_OPERATOR_ID,
  // Default NULL (current behavior for every existing caller). Pass a valid
  // ACRISS (^[A-Z9]{4}$) to make the class substitutable — substitution
  // eligibility requires a non-null code shared by both vehicles (#826).
  acrissCode: string | null = null,
): Promise<{ id: string; name: string; slug: string }> {
  const uniq = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const [row] = await db
    .insert(vehicleClasses)
    .values({
      id: crypto.randomUUID(),
      // Transitional tenant (#386). Seeded by global-setup; vehicle_classes is
      // not operator-scoped yet (deferred follow-up). The composite FK
      // vehicles(operatorId, classId) requires this operator to exist first.
      operatorId,
      name: `Class ${uniq}`,
      slug: `class-${uniq}`,
      acrissCode,
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

/**
 * #392: bookings.pickupLocationId / dropoffLocationId are NOT NULL FKs sealed to
 * the booking's operator. Every integration test that seeds a booking needs a
 * location owned by the same operator first. Unique name per call so parallel
 * test files don't collide on the (operatorId, name) unique index. Turnaround is
 * overridable so availability tests can derive effectiveEndAt from the location.
 */
export async function seedLocation(
  prefix = 'test',
  defaultTurnaroundMinutes = 2880,
  operatorId: string = BEST_CAR_RENTAL_OPERATOR_ID,
): Promise<{ id: string; defaultTurnaroundMinutes: number }> {
  const uniq = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const [row] = await db
    .insert(locations)
    .values({
      id: crypto.randomUUID(),
      operatorId,
      name: `Loc ${uniq}`,
      address: '1-1 Namba, Chuo-ku, Osaka',
      operatingHours: { openTime: '09:00', closeTime: '18:00' },
      timezone: 'Asia/Tokyo',
      defaultTurnaroundMinutes,
      status: 'ACTIVE',
    })
    .returning({
      id: locations.id,
      defaultTurnaroundMinutes: locations.defaultTurnaroundMinutes,
    })
  if (!row) throw new Error('Failed to seed location')
  return row
}

export async function cleanupLocations(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  for (const id of ids) {
    await db.delete(locations).where(eq(locations.id, id))
  }
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
    await db.delete(bookings).where(eq(bookings.assignedVehicleId, id))
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
