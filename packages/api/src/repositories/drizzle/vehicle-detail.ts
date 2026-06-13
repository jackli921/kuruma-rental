import { bookings, maintenanceLogs, users, vehicles } from '@kuruma/shared/db/schema'
import type { MaintenanceLogSummary } from '@kuruma/shared/types/maintenance-log'
import type { DailyUtilization, VehicleDetail } from '@kuruma/shared/types/vehicle-detail'
import { type SQL, and, eq, gt, inArray, ne, sql } from 'drizzle-orm'
import type { CallerContext } from '../../middleware/auth'
import { operatorReadScope } from '../../tenancy'
import type { VehicleDetailRepository } from '../types'
import {
  type Db,
  maintenanceLogColumns,
  overlapHours,
  toMaintenanceLog,
  toVehicle,
  toVehicleDetailBooking,
  vehicleColumns,
} from './shared'

const UPCOMING_LIMIT = 10
const UTILIZATION_WINDOW_DAYS = 30
const MS_PER_HOUR = 60 * 60 * 1000
const MS_PER_DAY = 24 * MS_PER_HOUR

type Revenue = { revenueLast7d: number; revenueLast30d: number; revenueAllTime: number }
type UtilizationRow = { startAt: Date; endAt: Date }

function formatDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function dayStart(d: Date): Date {
  const r = new Date(d)
  r.setHours(0, 0, 0, 0)
  return r
}

export class DrizzleVehicleDetailRepository implements VehicleDetailRepository {
  constructor(private readonly db: Db) {}

  async findVehicleDetail(
    ctx: CallerContext,
    vehicleId: string,
    now: Date,
  ): Promise<VehicleDetail | undefined> {
    const vehicleRow = await this.fetchVehicleRow(ctx, vehicleId)
    if (!vehicleRow) return undefined
    const vehicle = toVehicle(vehicleRow)

    const todayStart = dayStart(now)
    const windowStart = new Date(todayStart.getTime() - (UTILIZATION_WINDOW_DAYS - 1) * MS_PER_DAY)
    const windowEnd = new Date(todayStart.getTime() + MS_PER_DAY)

    // Round-trips 2-5 are independent — run in parallel.
    const [logRows, upcomingRows, revenue, utilizationRows] = await Promise.all([
      this.fetchMaintenanceLogs(vehicleId),
      this.fetchUpcomingBookings(vehicleId, now),
      this.fetchRevenue(vehicleId, now),
      this.fetchUtilizationRows(vehicleId, windowStart, windowEnd),
    ])

    return {
      ...vehicle,
      maintenanceLogs: logRows.map(toMaintenanceLogSummary),
      upcomingBookings: upcomingRows.map(toVehicleDetailBooking),
      ...revenue,
      utilizationLast30Days: computeDailyUtilization(utilizationRows, todayStart),
    }
  }

  // The tenant boundary. An OPERATOR_* caller only resolves a vehicle in its own
  // tenant; a foreign id returns no row -> the caller gets a 404, never another
  // operator's data. Once the vehicle is authorised here, the booking/maintenance
  // sub-reads are keyed by that vehicleId alone (no further operator predicate) —
  // they can only return data for the already-authorised vehicle.
  private async fetchVehicleRow(ctx: CallerContext, vehicleId: string) {
    const scope = operatorReadScope(ctx)
    if (scope.kind === 'none') return undefined
    const conditions: SQL[] = [eq(vehicles.id, vehicleId)]
    if (scope.kind === 'operator') conditions.push(eq(vehicles.operatorId, scope.operatorId))
    const rows = await this.db.select(vehicleColumns).from(vehicles).where(and(...conditions))
    return rows[0]
  }

  private fetchMaintenanceLogs(vehicleId: string) {
    return this.db
      .select(maintenanceLogColumns)
      .from(maintenanceLogs)
      .where(eq(maintenanceLogs.vehicleId, vehicleId))
  }

  private fetchUpcomingBookings(vehicleId: string, now: Date) {
    return this.db
      .select({
        id: bookings.id,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        source: bookings.source,
        status: bookings.status,
        renterName: users.name,
      })
      .from(bookings)
      .leftJoin(users, eq(bookings.renterId, users.id))
      .where(
        and(
          eq(bookings.assignedVehicleId, vehicleId),
          inArray(bookings.status, ['CONFIRMED', 'ACTIVE']),
          gt(bookings.startAt, now),
        ),
      )
      .orderBy(bookings.startAt)
      .limit(UPCOMING_LIMIT)
  }

  private async fetchRevenue(vehicleId: string, now: Date): Promise<Revenue> {
    const sevenDaysAgo = new Date(now.getTime() - 7 * MS_PER_DAY)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * MS_PER_DAY)

    // Drizzle's `sql<number>` is a type assertion, not a runtime coercion.
    // Postgres returns SUM as string (numeric/bigint). Number() below is load-bearing.
    const rows = await this.db
      .select({
        revenueAllTime: sql<string | number>`COALESCE(SUM(${bookings.totalPrice}), 0)`,
        revenueLast30d: sql<string | number>`COALESCE(SUM(CASE WHEN ${bookings.endAt} > ${thirtyDaysAgo.toISOString()} THEN ${bookings.totalPrice} ELSE 0 END), 0)`,
        revenueLast7d: sql<string | number>`COALESCE(SUM(CASE WHEN ${bookings.endAt} > ${sevenDaysAgo.toISOString()} THEN ${bookings.totalPrice} ELSE 0 END), 0)`,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.assignedVehicleId, vehicleId),
          eq(bookings.status, 'COMPLETED'),
          sql`${bookings.totalPrice} IS NOT NULL`,
        ),
      )

    const rev = rows[0]
    return {
      revenueAllTime: Number(rev?.revenueAllTime ?? 0),
      revenueLast30d: Number(rev?.revenueLast30d ?? 0),
      revenueLast7d: Number(rev?.revenueLast7d ?? 0),
    }
  }

  private fetchUtilizationRows(
    vehicleId: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<UtilizationRow[]> {
    return this.db
      .select({
        startAt: bookings.startAt,
        endAt: bookings.endAt,
      })
      .from(bookings)
      .where(
        and(
          eq(bookings.assignedVehicleId, vehicleId),
          ne(bookings.status, 'CANCELLED'),
          sql`${bookings.endAt} > ${windowStart.toISOString()}`,
          sql`${bookings.startAt} < ${windowEnd.toISOString()}`,
        ),
      )
  }
}

// --- Mappers ---

function toMaintenanceLogSummary(r: Parameters<typeof toMaintenanceLog>[0]): MaintenanceLogSummary {
  const log = toMaintenanceLog(r)
  return {
    id: log.id,
    vehicleId: log.vehicleId,
    reason: log.reason,
    notes: log.notes,
    costJpy: log.costJpy,
    startedAt: log.startedAt,
    resolvedAt: log.resolvedAt,
    createdAt: log.createdAt,
  }
}

// --- Pure utilization computation ---

function computeDailyUtilization(rows: UtilizationRow[], todayStart: Date): DailyUtilization[] {
  const days: DailyUtilization[] = []
  for (let i = UTILIZATION_WINDOW_DAYS - 1; i >= 0; i--) {
    const dayBegin = new Date(todayStart.getTime() - i * MS_PER_DAY)
    const dayEnd = new Date(dayBegin.getTime() + MS_PER_DAY)

    let bookedHours = 0
    for (const row of rows) {
      bookedHours += overlapHours(row.startAt, row.endAt, dayBegin, dayEnd)
    }

    days.push({
      date: formatDate(dayBegin),
      bookedHours: Math.round(bookedHours * 100) / 100,
    })
  }
  return days
}
