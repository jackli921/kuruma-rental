import {
  type OperatorOverview,
  TODAY_BUCKET_CAP,
  type TodayBookingRow,
  type TodayBuckets,
} from '@kuruma/shared/types/overview'
import { jstDayRangeUtc } from '@kuruma/shared/lib/jst'
import { type CallerContext, SYSTEM_CONTEXT, requireManagementRead } from '../../middleware/auth'
import type { Booking } from '../../stores'
import { bookingReadScope } from '../../tenancy'
import type { BookingRepository, OverviewRepository, VehicleRepository } from '../types'

const EMPTY_BUCKETS: TodayBuckets = { pickups: [], returns: [], overdue: [] }
const ZERO: OperatorOverview = {
  totalBookings: 0,
  activeVehicles: 0,
  upcomingBookings: 0,
  today: EMPTY_BUCKETS,
}

/**
 * In-memory operator overview (#524). Reads every vehicle/booking via
 * SYSTEM_CONTEXT, then applies one {@link bookingReadScope} decision uniformly
 * to both — so the Drizzle impl's `WHERE operatorId = $1` and this filter stay
 * behaviourally identical. Backs route-level tests; the Drizzle repo backs prod.
 *
 * #1102: the today buckets resolve the renter name via `renterNameByUserId`
 * (mirrors {@link InMemoryFleetOverviewRepository}) — the `Booking` store row
 * carries only `renterId`, so the join the Drizzle repo does in SQL is done here
 * against an injected map (empty in unit tests that don't assert names).
 */
export class InMemoryOverviewRepository implements OverviewRepository {
  constructor(
    private readonly vehicleRepo: VehicleRepository,
    private readonly bookingRepo: BookingRepository,
    private readonly renterNameByUserId: Map<string, string> = new Map(),
  ) {}

  async getOperatorOverview(
    ctx: CallerContext,
    now: Date,
    operatorId?: string,
  ): Promise<OperatorOverview> {
    // Defence-in-depth (mirrors insurance/fees repos): reject RENTER/PARTNER
    // here too — without this seal a non-operator bypassing the route would read
    // operator counts. Only the admin tier (`all`) and OPERATOR_* (`operator`)
    // own an operator overview.
    requireManagementRead(ctx)
    const scope = bookingReadScope(ctx)
    // `none` (operator without operatorId), `renter`, and `partner` (a channel,
    // not an operator) never see operator data.
    if (scope.kind === 'none' || scope.kind === 'renter' || scope.kind === 'partner') {
      return { ...ZERO, today: { ...EMPTY_BUCKETS } }
    }

    const [vehiclePage, bookings] = await Promise.all([
      this.vehicleRepo.findAll(SYSTEM_CONTEXT, { status: 'AVAILABLE' }),
      this.bookingRepo.findAll(SYSTEM_CONTEXT),
    ])

    // The picker's bypass narrowing (#407 slice 4): an `all` caller who named an
    // operatorId aggregates just that operator; without a pick it stays the full
    // cross-operator aggregate. Honored ONLY for `all` — a tenant caller keeps its
    // own operatorId, so a foreign id can never widen it.
    const inScope = (rowOperatorId: string | null) =>
      scope.kind === 'all'
        ? operatorId === undefined || rowOperatorId === operatorId
        : rowOperatorId === scope.operatorId

    const owned = bookings.filter((b) => inScope(b.operatorId))
    return {
      totalBookings: owned.filter((b) => b.status !== 'CANCELLED').length,
      activeVehicles: vehiclePage.data.filter((v) => inScope(v.operatorId)).length,
      upcomingBookings: owned.filter(
        (b) =>
          (b.status === 'CONFIRMED' || b.status === 'ACTIVE') &&
          b.startAt.getTime() >= now.getTime(),
      ).length,
      today: this.buildTodayBuckets(owned, now),
    }
  }

  // Disjoint buckets so a row lives in exactly one place: an ACTIVE car due
  // earlier today but not returned is OVERDUE, not a "return due later today".
  private buildTodayBuckets(owned: Booking[], now: Date): TodayBuckets {
    const { startUtc, endUtc } = jstDayRangeUtc(now)
    const nowMs = now.getTime()
    const inToday = (d: Date) => d.getTime() >= startUtc.getTime() && d.getTime() < endUtc.getTime()

    const pickups = owned
      .filter((b) => b.status === 'CONFIRMED' && inToday(b.startAt))
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    const returns = owned
      .filter((b) => b.status === 'ACTIVE' && b.endAt.getTime() >= nowMs && inToday(b.endAt))
      .sort((a, b) => a.endAt.getTime() - b.endAt.getTime())
    const overdue = owned
      .filter((b) => b.status === 'ACTIVE' && b.endAt.getTime() < nowMs)
      .sort((a, b) => a.endAt.getTime() - b.endAt.getTime())

    return {
      pickups: pickups.slice(0, TODAY_BUCKET_CAP).map((b) => this.toRow(b)),
      returns: returns.slice(0, TODAY_BUCKET_CAP).map((b) => this.toRow(b)),
      overdue: overdue.slice(0, TODAY_BUCKET_CAP).map((b) => this.toRow(b)),
    }
  }

  private toRow(b: Booking): TodayBookingRow {
    return {
      id: b.id,
      bookingCode: b.bookingCode,
      status: b.status,
      startAt: b.startAt.toISOString(),
      endAt: b.endAt.toISOString(),
      vehicleId: b.assignedVehicleId,
      renterName: this.renterNameByUserId.get(b.renterId) ?? null,
    }
  }
}
