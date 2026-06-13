import { type CallerContext, requirePlatformRead } from '../middleware/auth'
import type { PaymentAnomalyRepository } from '../repositories/types'
import type { PaymentAnomaly } from '../stores'

/**
 * Platform-admin view of payment anomalies needing review (#508 P2). Imperative
 * shell: it gates the caller (only STAFF/ADMIN/PLATFORM_ADMIN — never OPERATOR_*)
 * then reads the unscoped repo. `requirePlatformRead` lives here (not only at the
 * route) so the gate travels with the business logic — the repo's `listUnresolved`
 * is cross-operator, so this service is the authz chokepoint (mirrors #462 revenue).
 */
export class PaymentAnomalyService {
  constructor(private readonly anomalies: PaymentAnomalyRepository) {}

  async listUnresolved(ctx: CallerContext): Promise<PaymentAnomaly[]> {
    requirePlatformRead(ctx)
    return this.anomalies.listUnresolved()
  }
}
