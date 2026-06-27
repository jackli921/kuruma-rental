import { aggregateRevenueByPartner } from '@kuruma/shared/lib/admin-revenue'
import type { AdminRevenueResponse } from '@kuruma/shared/types/admin-revenue'
import { type CallerContext, requirePlatformRead } from '../middleware/auth'
import type { OperatorRepository, PaymentEventRepository } from '../repositories/types'

/**
 * Platform-admin partner revenue report (#462). Imperative shell: it gates the
 * caller (only PLATFORM_ADMIN — never OPERATOR_*; legacy STAFF/ADMIN lost
 * platform access in #487), fetches the
 * successful payments and operators, and hands them to the pure
 * {@link aggregateRevenueByPartner} core. `requirePlatformRead` lives here (not
 * only at the route) so the gate travels with the business logic — the payment
 * repo's reads are unscoped, so this service is the authz chokepoint.
 *
 * The month filter and `availableMonths` are pushed into the data layer (#717): a
 * month request scans only that JST payout month and the picker options come from
 * a DISTINCT query, so the Worker never materializes the whole growing table.
 */
export class AdminRevenueService {
  constructor(
    private readonly paymentEvents: PaymentEventRepository,
    private readonly operators: OperatorRepository,
  ) {}

  /**
   * @param month optional `YYYY-MM` (JST) — scopes the report to that payout
   *   month. `availableMonths` is always the full set (so the picker can offer
   *   every month regardless of the current filter).
   */
  async getReport(ctx: CallerContext, month?: string): Promise<AdminRevenueResponse> {
    requirePlatformRead(ctx)
    const [events, availableMonths, operators] = await Promise.all([
      this.paymentEvents.listSucceeded(month),
      this.paymentEvents.listSucceededMonths(),
      this.operators.list(),
    ])
    return {
      ...aggregateRevenueByPartner(events, operators),
      availableMonths,
      selectedMonth: month ?? null,
    }
  }
}
