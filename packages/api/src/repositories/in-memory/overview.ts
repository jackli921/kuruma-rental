import type { OperatorOverview } from '@kuruma/shared/types/overview'
import { type CallerContext, SYSTEM_CONTEXT, requireManagementRead } from '../../middleware/auth'
import { bookingReadScope } from '../../tenancy'
import type { BookingRepository, OverviewRepository, VehicleRepository } from '../types'

const ZERO: OperatorOverview = { totalBookings: 0, activeVehicles: 0, upcomingBookings: 0 }

/**
 * In-memory operator overview (#524). Reads every vehicle/booking via
 * SYSTEM_CONTEXT, then applies one {@link bookingReadScope} decision uniformly
 * to both — so the Drizzle impl's `WHERE operatorId = $1` and this filter stay
 * behaviourally identical. Backs route-level tests; the Drizzle repo backs prod.
 */
export class InMemoryOverviewRepository implements OverviewRepository {
  constructor(
    private readonly vehicleRepo: VehicleRepository,
    private readonly bookingRepo: BookingRepository,
  ) {}

  async getOperatorOverview(ctx: CallerContext, now: Date): Promise<OperatorOverview> {
    // Defence-in-depth (mirrors insurance/fees repos): reject RENTER/PARTNER
    // here too — without this seal a non-operator bypassing the route would read
    // operator counts. Only the admin tier (`all`) and OPERATOR_* (`operator`)
    // own an operator overview.
    requireManagementRead(ctx)
    const scope = bookingReadScope(ctx)
    // `none` (operator without operatorId), `renter`, and `partner` (a channel,
    // not an operator) never see operator data.
    if (scope.kind === 'none' || scope.kind === 'renter' || scope.kind === 'partner') {
      return { ...ZERO }
    }

    const [vehiclePage, bookings] = await Promise.all([
      this.vehicleRepo.findAll(SYSTEM_CONTEXT, { status: 'AVAILABLE' }),
      this.bookingRepo.findAll(SYSTEM_CONTEXT),
    ])

    const inScope = (operatorId: string | null) =>
      scope.kind === 'all' || operatorId === scope.operatorId

    const owned = bookings.filter((b) => inScope(b.operatorId))
    return {
      totalBookings: owned.filter((b) => b.status !== 'CANCELLED').length,
      activeVehicles: vehiclePage.data.filter((v) => inScope(v.operatorId)).length,
      upcomingBookings: owned.filter(
        (b) =>
          (b.status === 'CONFIRMED' || b.status === 'ACTIVE') &&
          b.startAt.getTime() >= now.getTime(),
      ).length,
    }
  }
}
