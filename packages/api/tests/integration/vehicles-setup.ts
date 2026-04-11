// Cleanup helper for the vehicles integration tests. The shared drizzle/
// postgres-js client lives in `pg-test-client.ts` and is re-exported here
// for convenience. See issue #48 for the pricing slice that this supports.

import { bookings, vehicles } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import { testDb } from './pg-test-client'

export { testDb }

/**
 * Tear down vehicles and any bookings that reference them. Bookings have a
 * FK to vehicles so they must go first. Safe no-op on an empty id list.
 */
export async function cleanupVehicles(vehicleIds: string[]): Promise<void> {
  if (vehicleIds.length === 0) return

  await testDb.delete(bookings).where(inArray(bookings.vehicleId, vehicleIds))
  await testDb.delete(vehicles).where(inArray(vehicles.id, vehicleIds))
}
