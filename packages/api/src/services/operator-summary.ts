import type { OperatorComplianceSummary } from '@kuruma/shared/types/operator-summary'
import { type CallerContext, NotFoundError, requirePlatformAdmin } from '../middleware/auth'
import type {
  BookingRepository,
  ComplianceAlertLogRepository,
  OperatorRepository,
  VehicleRepository,
} from '../repositories/types'

/**
 * Per-operator metrics & compliance roll-up (#1120) for the platform-owner
 * operators page. Imperative shell mirroring {@link AdminOverviewService}: it
 * gates the caller (PLATFORM_ADMIN only) then fans out three single-operator
 * reads — vehicle compliance, booking counts, last compliance alert — and
 * composes them with the operator's name into the {@link OperatorComplianceSummary}.
 * `requirePlatformAdmin` lives HERE (not only at the route) so the gate travels
 * with the business logic: every repo read is cross-tenant and unscoped, so this
 * service is the authz chokepoint. The route's `requireAuth` alone is insufficient
 * — `bypassScope` also admits PARTNER (Trip.com), who must never read an
 * operator's private fleet/compliance health.
 *
 * The `now` clock is injected so compliance classification (JST date) and the
 * "upcoming bookings" cutoff are deterministic in tests.
 */
export class OperatorSummaryService {
  constructor(
    private readonly operators: OperatorRepository,
    private readonly vehicles: VehicleRepository,
    private readonly bookings: BookingRepository,
    private readonly complianceAlerts: ComplianceAlertLogRepository,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async getSummary(ctx: CallerContext, operatorId: string): Promise<OperatorComplianceSummary> {
    requirePlatformAdmin(ctx)

    const operator = await this.operators.findById(operatorId)
    if (!operator) throw new NotFoundError('Operator not found')

    const asOf = this.now()
    const [compliance, bookings, lastAlertAt] = await Promise.all([
      this.vehicles.countComplianceForOperator(operatorId, asOf),
      this.bookings.countBookingsForOperator(operatorId, asOf),
      this.complianceAlerts.latestSentAtForOperator(operatorId),
    ])

    return {
      operatorId,
      name: operator.name,
      vehicleCount: compliance.total,
      vehiclesNeedingDocs: compliance.needingDocs,
      vehiclesExpiringSoon: compliance.expiringSoon,
      totalBookings: bookings.total,
      upcomingBookings: bookings.upcoming,
      lastComplianceAlertAt: lastAlertAt ? lastAlertAt.toISOString() : null,
    }
  }
}
