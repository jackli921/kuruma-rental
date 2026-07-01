import { bookings, vehicles } from '@kuruma/shared/db/schema'
import type { OperatorOverview } from '@kuruma/shared/types/overview'
import { and, count, eq, gte, inArray, ne } from 'drizzle-orm'
import { type CallerContext, requireManagementRead } from '../../middleware/auth'
import { bookingReadScope } from '../../tenancy'
import type { OverviewRepository } from '../types'
import type { Db } from './shared'

const ZERO: OperatorOverview = { totalBookings: 0, activeVehicles: 0, upcomingBookings: 0 }

/**
 * Operator dashboard overview (#524) as three scoped `count()` queries. `ctx`
 * resolves the tenant filter via {@link bookingReadScope}; `and(undefined, ...)`
 * collapses to no operator filter for bypass roles (drizzle ignores undefined
 * operands), so the same code serves both "this operator" and "all operators".
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
      return { ...ZERO }
    }
    // `operator` keeps its own tenant; an `all` (bypass) caller may narrow to the
    // picked operator (#407 slice 4) or, with no pick, aggregate every operator
    // (undefined -> `and(undefined, ...)` drops the filter). The picker id is
    // honored only here in the `all` branch, so it can never widen a tenant.
    const opId = scope.kind === 'operator' ? scope.operatorId : operatorId

    const bookingOp = opId ? eq(bookings.operatorId, opId) : undefined
    const vehicleOp = opId ? eq(vehicles.operatorId, opId) : undefined

    const [totalBookings, activeVehicles, upcomingBookings] = await Promise.all([
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
    ])

    return {
      totalBookings: totalBookings[0]?.c ?? 0,
      activeVehicles: activeVehicles[0]?.c ?? 0,
      upcomingBookings: upcomingBookings[0]?.c ?? 0,
    }
  }
}
