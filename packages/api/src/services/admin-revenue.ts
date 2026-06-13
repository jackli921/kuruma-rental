import { aggregateRevenueByPartner } from '@kuruma/shared/lib/admin-revenue'
import type { AdminRevenueReport } from '@kuruma/shared/types/admin-revenue'
import { type CallerContext, requirePlatformRead } from '../middleware/auth'
import type { OperatorRepository, PaymentEventRepository } from '../repositories/types'

/**
 * Platform-admin partner revenue report (#462). Imperative shell: it gates the
 * caller (only STAFF/ADMIN/PLATFORM_ADMIN — never OPERATOR_*), fetches the
 * successful payments and operators, and hands them to the pure
 * {@link aggregateRevenueByPartner} core. `requirePlatformRead` lives here (not
 * only at the route) so the gate travels with the business logic — the payment
 * repo's `listSucceeded` is unscoped, so this service is the authz chokepoint.
 */
export class AdminRevenueService {
  constructor(
    private readonly paymentEvents: PaymentEventRepository,
    private readonly operators: OperatorRepository,
  ) {}

  async getReport(ctx: CallerContext): Promise<AdminRevenueReport> {
    requirePlatformRead(ctx)
    const [events, operators] = await Promise.all([
      this.paymentEvents.listSucceeded(),
      this.operators.list(),
    ])
    return aggregateRevenueByPartner(events, operators)
  }
}
