import type { AdminOverview } from '@kuruma/shared/types/admin-overview'
import { type CallerContext, requirePlatformAdmin } from '../middleware/auth'
import type {
  BookingRepository,
  OperatorRepository,
  PaymentAnomalyRepository,
  PaymentEventRepository,
  RenterDocumentRepository,
  VehicleRepository,
} from '../repositories/types'

/**
 * Platform-owner home overview (#1087, epic #1075 slice 1). Imperative shell: it
 * gates the caller (PLATFORM_ADMIN only) then fans out six single-table COUNT/SUM
 * reads — one per existing repo — and composes them into the {@link AdminOverview}
 * aggregate. `requirePlatformAdmin` lives HERE (not only at the route) so the gate
 * travels with the business logic: every repo read is cross-tenant and unscoped,
 * so this service is the authz chokepoint (mirrors #462 revenue / #508 anomalies).
 * The route's `requireAuth` alone is insufficient — `bypassScope` also admits
 * PARTNER (Trip.com), who must never read platform-wide health.
 */
export class AdminOverviewService {
  constructor(
    private readonly bookings: BookingRepository,
    private readonly paymentEvents: PaymentEventRepository,
    private readonly vehicles: VehicleRepository,
    private readonly operators: OperatorRepository,
    private readonly anomalies: PaymentAnomalyRepository,
    private readonly renterDocuments: RenterDocumentRepository,
  ) {}

  async getOverview(ctx: CallerContext): Promise<AdminOverview> {
    requirePlatformAdmin(ctx)
    const [bookings, gmvJpy, fleet, operators, unresolvedAnomalies, pendingDocs] =
      await Promise.all([
        this.bookings.count(),
        this.paymentEvents.sumSucceededGrossJpy(),
        this.vehicles.countActive(),
        this.operators.count(),
        this.anomalies.countUnresolved(),
        this.renterDocuments.countPending(),
      ])
    return { bookings, gmvJpy, fleet, operators, unresolvedAnomalies, pendingDocs }
  }
}
