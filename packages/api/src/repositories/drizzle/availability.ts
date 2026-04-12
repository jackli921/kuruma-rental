import { bookings, vehicles } from '@kuruma/shared/db/schema'
import { and, eq, sql } from 'drizzle-orm'
import type { Booking, Vehicle } from '../../stores'
import type { AvailabilityRepository } from '../types'
import { type Db, bookingColumns, vehicleColumns } from './shared'

export class DrizzleAvailabilityRepository implements AvailabilityRepository {
  constructor(private readonly db: Db) {}

  async findAvailableVehicles(from: Date, to: Date): Promise<Vehicle[]> {
    const fromIso = from.toISOString()
    const toIso = to.toISOString()

    const rows = await this.db
      .select(vehicleColumns)
      .from(vehicles)
      .where(
        and(
          eq(vehicles.status, 'AVAILABLE'),
          sql`NOT EXISTS (
            SELECT 1 FROM bookings b
            WHERE b."vehicleId" = ${vehicles.id}
            AND b.status IN ('CONFIRMED', 'ACTIVE')
            AND tstzrange(b."startAt", b."effectiveEndAt") && tstzrange(${fromIso}::timestamptz, ${toIso}::timestamptz)
          )`,
        ),
      )
    return rows as Vehicle[]
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
          eq(bookings.vehicleId, vehicleId),
          sql`status IN ('CONFIRMED', 'ACTIVE')`,
          sql`tstzrange("startAt", "effectiveEndAt") && tstzrange(${fromIso}::timestamptz, ${toIso}::timestamptz)`,
        ),
      )

    return {
      available: conflicts.length === 0,
      vehicle: vehicle as Vehicle,
      conflicts: conflicts as Booking[],
    }
  }
}
