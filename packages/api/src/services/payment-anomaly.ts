import type {
  PaymentAnomalyResolution,
  PaymentAnomalyView,
} from '@kuruma/shared/types/payment-anomaly'
import {
  type CallerContext,
  NotFoundError,
  requirePlatformAdmin,
  requirePlatformRead,
} from '../middleware/auth'
import type { PaymentAnomalyRepository } from '../repositories/types'
import type { PaymentAnomaly } from '../stores'

// Project a persisted anomaly onto the admin wire view (@kuruma/shared): drop the
// internal checkout-session id (refunds are issued against the paymentIntent) and
// `resolvedBy` (no user-join in v1), and serialize the timestamps as ISO. The
// resolution audit fields are null exactly while the anomaly is unresolved. Lives
// in the service (not the route) so the entity→wire boundary stays out of the
// transport layer (#1164).
function toView(a: PaymentAnomaly): PaymentAnomalyView {
  return {
    id: a.id,
    kind: a.kind,
    operatorId: a.operatorId,
    bookingId: a.bookingId,
    receivedAmountJpy: a.receivedAmountJpy,
    expectedAmountJpy: a.expectedAmountJpy,
    currency: a.currency,
    stripeEventId: a.stripeEventId,
    stripePaymentIntentId: a.stripePaymentIntentId,
    createdAt: a.createdAt.toISOString(),
    resolvedAt: a.resolvedAt ? a.resolvedAt.toISOString() : null,
    resolution: a.resolution,
    note: a.note,
  }
}

/**
 * Platform-admin view of payment anomalies needing review (#508 P2). Imperative
 * shell: it gates the caller (only STAFF/ADMIN/PLATFORM_ADMIN — never OPERATOR_*)
 * then reads the unscoped repo. `requirePlatformRead` lives here (not only at the
 * route) so the gate travels with the business logic — the repo's `listUnresolved`
 * is cross-operator, so this service is the authz chokepoint (mirrors #462 revenue).
 */
export class PaymentAnomalyService {
  constructor(private readonly anomalies: PaymentAnomalyRepository) {}

  async listUnresolved(ctx: CallerContext): Promise<PaymentAnomalyView[]> {
    requirePlatformRead(ctx)
    return (await this.anomalies.listUnresolved()).map(toView)
  }

  async listResolved(ctx: CallerContext): Promise<PaymentAnomalyView[]> {
    requirePlatformRead(ctx)
    return (await this.anomalies.listResolved()).map(toView)
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
  ): Promise<PaymentAnomalyView> {
    requirePlatformAdmin(ctx)
    const resolved = await this.anomalies.resolve(id, {
      resolution,
      resolvedBy: ctx.userId,
      note,
    })
    if (!resolved) throw new NotFoundError('payment anomaly not found or already resolved')
    return toView(resolved)
  }
}
