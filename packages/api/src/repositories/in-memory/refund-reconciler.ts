import type { Booking, PaymentRefund } from '../../stores'
import type { RefundReconcilerRepository } from '../types'

/**
 * In-memory reconciler scan (#851 S4), the Drizzle LEFT JOIN's twin. Reads the
 * SAME booking + refund maps the concrete repos write, so a REFUND_DUE booking's
 * receipt state is visible here exactly as a SQL join would see it. The FAILED
 * filter runs BEFORE the limit (parity with the WHERE-before-LIMIT) so a backlog
 * of human-stuck FAILED rows can never crowd out retryable work.
 */
export class InMemoryRefundReconcilerRepository implements RefundReconcilerRepository {
  constructor(
    private readonly bookings: Map<string, Booking>,
    private readonly refunds: Map<string, PaymentRefund>,
  ) {}

  async listRefundDueNeedingDrive(opts: { limit: number }): Promise<Booking[]> {
    const needsDrive = [...this.bookings.values()].filter((b) => {
      if (b.cancellationFeeSettlement !== 'REFUND_DUE') return false
      const receipt = this.refunds.get(b.id)
      // Drive anything not terminally FAILED: no receipt (lost eager-fire), a PENDING
      // one, OR a SUCCEEDED receipt whose booking is still REFUND_DUE — the crash
      // between confirmRefundSucceeded's two writes. A healthy refund leaves the
      // booking REFUNDED (filtered above), so SUCCEEDED here is ONLY that orphan, and
      // the SUCCEEDED branch of initiateCancellationRefund finishes it (no Stripe call).
      // FAILED is the lone exclusion — it needs a human — and is dropped before the limit.
      return !receipt || receipt.status !== 'FAILED'
    })
    return needsDrive
      .sort((a, b) => (a.cancelledAt?.getTime() ?? 0) - (b.cancelledAt?.getTime() ?? 0))
      .slice(0, opts.limit)
  }
}
