import { bookings, users, vehicles } from '@kuruma/shared/db/schema'
import { jstDayRangeUtc } from '@kuruma/shared/lib/jst'
import {
  type OperatorOverview,
  TODAY_BUCKET_CAP,
  type TodayBookingRow,
  type TodayBuckets,
} from '@kuruma/shared/types/overview'
import { type AnyColumn, type SQL, and, asc, count, eq, gte, inArray, lt, ne } from 'drizzle-orm'
import { type CallerContext, requireManagementRead } from '../../middleware/auth'
import { bookingReadScope } from '../../tenancy'
import type { OverviewRepository } from '../types'
import type { Db } from './shared'

const EMPTY_BUCKETS: TodayBuckets = { pickups: [], returns: [], overdue: [] }
const ZERO: OperatorOverview = {
  totalBookings: 0,
  activeVehicles: 0,
  upcomingBookings: 0,
  today: EMPTY_BUCKETS,
}

// The row projection for a today bucket: minimal fields the panel renders, with
// the renter name LEFT JOINed (null for a walk-in / missing user).
const bucketColumns = {
  id: bookings.id,
  bookingCode: bookings.bookingCode,
  status: bookings.status,
  startAt: bookings.startAt,
  endAt: bookings.endAt,
  vehicleId: bookings.assignedVehicleId,
  renterName: users.name,
}

/**
 * Operator dashboard overview (#524). Three scoped `count()` headline figures
 * plus the #1102 today buckets (pickups / returns / overdue). `ctx` resolves the
 * tenant filter via {@link bookingReadScope}; `and(undefined, ...)` collapses to
 * no operator filter for bypass roles (drizzle ignores undefined operands), so
 * the same code serves both "this operator" and "all operators".
 */
export class DrizzleOverviewRepository implements OverviewRepository {
  constructor(private readonly db: Db) {}

  async getOperatorOverview(
    ctx: CallerContext,
    now: Date,
    operatorId?: string,
  ): Promise<OperatorOverview> {
    // Defence-in-depth (mirrors insurance/fees repos): reject RENTER/PARTNER
    // here too — without this seal a non-operator bypassing the route would read
    // operator counts. Only the admin tier (`all`) and OPERATOR_* (`operator`)
    // own an operator overview; `partner` is a channel, not an operator (#1119).
    requireManagementRead(ctx)
    const scope = bookingReadScope(ctx)
    if (scope.kind === 'none' || scope.kind === 'renter' || scope.kind === 'partner') {
      return { ...ZERO, today: { ...EMPTY_BUCKETS } }
    }
    // `operator` keeps its own tenant; an `all` (bypass) caller may narrow to the
    // picked operator (#407 slice 4) or, with no pick, aggregate every operator
    // (undefined -> `and(undefined, ...)` drops the filter). The picker id is
    // honored only here in the `all` branch, so it can never widen a tenant.
    const opId = scope.kind === 'operator' ? scope.operatorId : operatorId

    const bookingOp = opId ? eq(bookings.operatorId, opId) : undefined
    const vehicleOp = opId ? eq(vehicles.operatorId, opId) : undefined
    const { startUtc, endUtc } = jstDayRangeUtc(now)

    const [totalBookings, activeVehicles, upcomingBookings, today] = await Promise.all([
      this.db
        .select({ c: count() })
        .from(bookings)
        .where(and(bookingOp, ne(bookings.status, 'CANCELLED'))),
      this.db
        .select({ c: count() })
        .from(vehicles)
        .where(and(vehicleOp, eq(vehicles.status, 'AVAILABLE'))),
      this.db
        .select({ c: count() })
        .from(bookings)
        .where(
          and(
            bookingOp,
            inArray(bookings.status, ['CONFIRMED', 'ACTIVE'] as const),
            gte(bookings.startAt, now),
          ),
        ),
      this.buildTodayBuckets(bookingOp, now, startUtc, endUtc),
    ])

    return {
      totalBookings: totalBookings[0]?.c ?? 0,
      activeVehicles: activeVehicles[0]?.c ?? 0,
      upcomingBookings: upcomingBookings[0]?.c ?? 0,
      today,
    }
  }

  // Disjoint buckets (a car due earlier today but not yet returned is OVERDUE,
  // not a "return due later today"). overdue keys off the contractual `endAt`,
  // NOT `effectiveEndAt` (the turnaround tail is irrelevant to "renter is late").
  private async buildTodayBuckets(
    bookingOp: SQL | undefined,
    now: Date,
    startUtc: Date,
    endUtc: Date,
  ): Promise<TodayBuckets> {
    const [pickups, returns, overdue] = await Promise.all([
      this.queryBucket(
        and(
          bookingOp,
          eq(bookings.status, 'CONFIRMED'),
          gte(bookings.startAt, startUtc),
          lt(bookings.startAt, endUtc),
        ),
        bookings.startAt,
      ),
      this.queryBucket(
        and(
          bookingOp,
          eq(bookings.status, 'ACTIVE'),
          gte(bookings.endAt, now),
          lt(bookings.endAt, endUtc),
        ),
        bookings.endAt,
      ),
      this.queryBucket(
        and(bookingOp, eq(bookings.status, 'ACTIVE'), lt(bookings.endAt, now)),
        bookings.endAt,
      ),
    ])
    return { pickups, returns, overdue }
  }

  private async queryBucket(where: SQL | undefined, orderCol: AnyColumn): Promise<TodayBookingRow[]> {
    const rows = await this.db
      .select(bucketColumns)
      .from(bookings)
      .leftJoin(users, eq(bookings.renterId, users.id))
      .where(where)
      .orderBy(asc(orderCol))
      .limit(TODAY_BUCKET_CAP)
    return rows.map((r) => ({
      id: r.id,
      bookingCode: r.bookingCode,
      status: r.status,
      startAt: r.startAt.toISOString(),
      endAt: r.endAt.toISOString(),
      vehicleId: r.vehicleId,
      renterName: r.renterName,
    }))
  }
}
