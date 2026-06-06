import { bookings, users, vehicles } from '@kuruma/shared/db/schema'
import type { FleetVehicleOverview } from '@kuruma/shared/types/fleet'
import { and, ne, sql } from 'drizzle-orm'
import { eq } from 'drizzle-orm'
import type { Vehicle } from '../../stores'
import type { FleetOverviewRepository } from '../types'
import { type Db, overlapHours, toVehicle, vehicleColumns } from './shared'

// Fleet overview: owner-facing aggregated read. Two round-trips instead
// of N+1 -- one SELECT for all vehicles, one SELECT for all relevant
// bookings (last 30 days + any future) joined to users for renter name.
// JS does the per-vehicle aggregation. 40-50 cars x maybe 200 bookings
// is trivially fast and much clearer than a window-function CTE. See
// issue #52.
const UTILIZATION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

export class DrizzleFleetOverviewRepository implements FleetOverviewRepository {
  constructor(private readonly db: Db) {}

  async findFleetOverview(now: Date): Promise<FleetVehicleOverview[]> {
    const windowStart = new Date(now.getTime() - UTILIZATION_WINDOW_MS)

    // Round-trip 1: all vehicles.
    const vehicleRows = (await this.db.select(vehicleColumns).from(vehicles)).map(toVehicle)

    // Round-trip 2: bookings we care about -- non-CANCELLED, and either
    // overlapping the last-30-day window OR starting in the future.
    // LEFT JOIN users for the renter name.
    const bookingRows = await this.db
      .select({
        id: bookings.id,
        vehicleId: bookings.assignedVehicleId,
        renterId: bookings.renterId,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        status: bookings.status,
        renterName: users.name,
      })
      .from(bookings)
      .leftJoin(users, eq(bookings.renterId, users.id))
      .where(
        and(
          ne(bookings.status, 'CANCELLED'),
          sql`(${bookings.endAt} > ${windowStart.toISOString()} OR ${bookings.startAt} > ${now.toISOString()})`,
        ),
      )

    const bookingsByVehicleId = new Map<string, typeof bookingRows>()
    for (const row of bookingRows) {
      // Issue #308: bookings can be unassigned (vehicleId=null). Fleet
      // overview is per-vehicle, so skip rows without an assigned car.
      if (!row.vehicleId) continue
      const list = bookingsByVehicleId.get(row.vehicleId) ?? []
      list.push(row)
      bookingsByVehicleId.set(row.vehicleId, list)
    }

    return vehicleRows.map((vehicle) => {
      const vb = bookingsByVehicleId.get(vehicle.id) ?? []

      const recent = vb.filter((b) => b.endAt > windowStart && b.startAt < now)
      const bookedHours = recent.reduce(
        (sum, b) => sum + overlapHours(b.startAt, b.endAt, windowStart, now),
        0,
      )

      const current = vb.find((b) => b.startAt <= now && b.endAt > now) ?? null
      const futures = vb
        .filter((b) => b.startAt > now)
        .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      const next = futures[0] ?? null

      return {
        ...vehicle,
        utilization: (bookedHours / (30 * 24)) * 100,
        bookingCountLast30Days: recent.length,
        currentBooking: current
          ? { startAt: current.startAt, endAt: current.endAt, renterName: current.renterName }
          : null,
        nextBooking: next
          ? { startAt: next.startAt, endAt: next.endAt, renterName: next.renterName }
          : null,
        // TODO(#225): query maintenance_logs table when DrizzleMaintenanceLogRepository exists
        activeMaintenanceReason: null,
      }
    })
  }
}
