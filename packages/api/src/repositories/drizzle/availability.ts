import { bookings, vehicles } from '@kuruma/shared/db/schema'
import { type SQL, and, eq, inArray, sql } from 'drizzle-orm'
import type { Booking, Vehicle } from '../../stores'
import type { AvailabilityFilters, AvailabilityRepository } from '../types'
import {
  type Db,
  type PhotoDecoder,
  bookingColumns,
  identityPhotoDecoder,
  toBooking,
  toVehicle,
  vehicleColumns,
} from './shared'

export class DrizzleAvailabilityRepository implements AvailabilityRepository {
  constructor(
    private readonly db: Db,
    private readonly decodePhotos: PhotoDecoder = identityPhotoDecoder,
  ) {}

  async findAvailableVehicles(
    from: Date,
    to: Date,
    filters?: AvailabilityFilters,
  ): Promise<Vehicle[]> {
    const fromIso = from.toISOString()
    const toIso = to.toISOString()

    const conditions: SQL[] = [
      eq(vehicles.status, 'AVAILABLE'),
      sql`NOT EXISTS (
            SELECT 1 FROM bookings b
            WHERE b."assignedVehicleId" = ${vehicles.id}
            AND b.status IN ('CONFIRMED', 'ACTIVE')
            AND tstzrange(b."startAt", b."effectiveEndAt") && tstzrange(${fromIso}::timestamptz, ${toIso}::timestamptz)
          )`,
    ]
    // Storefront scope (#391): INNER match on the nullable pickupLocationId — a
    // vehicle with no assigned location matches no locationId, so it is
    // invisible to storefront search (§9 item 8). Additive; existing callers
    // pass no filter and scan the whole fleet unchanged.
    if (filters?.locationId) conditions.push(eq(vehicles.pickupLocationId, filters.locationId))
    // Region scope (#651 §1c): bound the scan to the in-region storefronts via the
    // idx_vehicles_pickupLocationId index. An empty set means "no in-region
    // storefront" → no vehicles (mirrors DrizzleStorefrontRepository's regionIds
    // short-circuit). A null pickupLocationId is never IN the set.
    if (filters?.locationIds) {
      if (filters.locationIds.length === 0) return []
      conditions.push(inArray(vehicles.pickupLocationId, filters.locationIds))
    }
    if (filters?.operatorId) conditions.push(eq(vehicles.operatorId, filters.operatorId))
    if (filters?.classId) conditions.push(eq(vehicles.classId, filters.classId))

    const rows = await this.db
      .select(vehicleColumns)
      .from(vehicles)
      .where(and(...conditions))
    return rows.map((r) => toVehicle(r, this.decodePhotos))
  }

  async checkVehicleAvailability(
    vehicleId: string,
    from: Date,
    to: Date,
  ): Promise<{ available: boolean; vehicle: Vehicle; conflicts: Booking[] } | undefined> {
    const [vehicle] = await this.db
      .select(vehicleColumns)
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId))

    if (!vehicle) return undefined

    const fromIso = from.toISOString()
    const toIso = to.toISOString()

    const conflicts = await this.db
      .select(bookingColumns)
      .from(bookings)
      .where(
        and(
          eq(bookings.assignedVehicleId, vehicleId),
          sql`status IN ('CONFIRMED', 'ACTIVE')`,
          sql`tstzrange("startAt", "effectiveEndAt") && tstzrange(${fromIso}::timestamptz, ${toIso}::timestamptz)`,
        ),
      )

    return {
      available: conflicts.length === 0,
      vehicle: toVehicle(vehicle, this.decodePhotos),
      conflicts: conflicts.map(toBooking),
    }
  }
}
