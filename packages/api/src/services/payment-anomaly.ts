import type { PaymentAnomalyResolution } from '@kuruma/shared/types/payment-anomaly'
import {
  type CallerContext,
  NotFoundError,
  requirePlatformAdmin,
  requirePlatformRead,
} from '../middleware/auth'
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

  async listResolved(ctx: CallerContext): Promise<PaymentAnomaly[]> {
    requirePlatformRead(ctx)
    return this.anomalies.listResolved()
  }

  /**
   * Close an anomaly's review-queue item (#1075 slice 3). A WRITE, so it gates on
   * the stricter `requirePlatformAdmin` (only PLATFORM_ADMIN — never legacy
   * STAFF/ADMIN or any OPERATOR_*), distinct from the `requirePlatformRead` on the
   * list reads above; the split is intentional even though both resolve to
   * {PLATFORM_ADMIN} today. `resolvedBy` comes from the verified caller, never the
   * request body. A null result (unknown or already-resolved id — the guarded
   * write-once UPDATE matched nothing) surfaces as a 404. NO money moves here.
   */
  async resolve(
    ctx: CallerContext,
    id: string,
    resolution: PaymentAnomalyResolution,
    note: string | null,
  ): Promise<PaymentAnomaly> {
    requirePlatformAdmin(ctx)
    const resolved = await this.anomalies.resolve(id, {
      resolution,
      resolvedBy: ctx.userId,
      note,
    })
    if (!resolved) throw new NotFoundError('payment anomaly not found or already resolved')
    return resolved
  }
}
