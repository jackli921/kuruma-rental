import type { PaymentRefundRepository, RefundReconcilerRepository } from '../../repositories/types'
import type { Booking } from '../../stores'

/** Per-run tally, logged like `[cron:compliance-digest]` so a glance at the
 *  worker logs answers "did the backstop drive anything, and how did it land?". */
export interface CancellationRefundReconcilerSummary {
  attempted: number
  succeeded: number
  failed: number
  pending: number
}

/**
 * Pure alert policy (Functional Core): a non-zero `failed` count means Stripe REJECTED
 * one or more refunds, leaving those bookings stuck at REFUND_DUE and EXCLUDED from every
 * later sweep (`drizzle/refund-reconciler.ts` filters out FAILED receipts) — so this run's
 * summary is the ONLY signal the money is stranded. Returns the human-facing alert message,
 * or null when the sweep drove no failures. Kept pure so the worker's Sentry wiring stays a
 * one-liner (Imperative Shell) and the policy is unit-testable without the cron.
 */
export function refundReconcilerStrandedAlert(
  summary: CancellationRefundReconcilerSummary,
): string | null {
  if (summary.failed <= 0) return null
  return `${summary.failed} cancellation refund(s) FAILED at Stripe and are stranded at REFUND_DUE — manual reconciliation needed`
}

/** The one entry point the reconciler drives — the idempotent core shared with the
 *  eager fire (PaymentService satisfies this). Narrow by design (ISP): the backstop
 *  needs only to (re-)drive a refund, not the coordinator's `isBookingPaid` read. */
export interface RefundDriver {
  initiateCancellationRefund(booking: Booking, intendedAmountJpy: number): Promise<void>
}

export interface CancellationRefundReconcilerDeps {
  scanRepo: RefundReconcilerRepository
  driver: RefundDriver
  refundRepo: PaymentRefundRepository
}

const DEFAULT_LIMIT = 100

/**
 * The #851 reconciler backstop. A bounded, failure-isolated sweep over bookings
 * durably stuck at `REFUND_DUE` — the daily safety net behind the best-effort
 * eager fire. A lost eager-claim, a webhook that never arrived, or a Stripe
 * transient all self-heal here: each row re-enters the SAME idempotent core, so a
 * refund Stripe already completed is RETRIEVED (never re-issued) and confirmed.
 *
 * Intended amount is reconstructed from the persisted booking — `totalPrice -
 * cancellationFee` (the renter's policy `refundAmount`; operator-fault rows carry
 * fee 0 → full total) — so it is time-independent (no re-deriving the tier at sweep
 * time) and equals the eager receipt's `amountJpy` for already-claimed rows. The
 * core clamps to the captured gross; the reconciler never over-refunds.
 */
export class CancellationRefundReconciler {
  constructor(private readonly deps: CancellationRefundReconcilerDeps) {}

  async run(opts: { limit?: number } = {}): Promise<CancellationRefundReconcilerSummary> {
    const limit = opts.limit ?? DEFAULT_LIMIT
    const due = await this.deps.scanRepo.listRefundDueNeedingDrive({ limit })

    let succeeded = 0
    let failed = 0
    let pending = 0
    for (const booking of due) {
      const intendedAmountJpy = (booking.totalPrice ?? 0) - (booking.cancellationFee ?? 0)
      try {
        await this.deps.driver.initiateCancellationRefund(booking, intendedAmountJpy)
      } catch (err) {
        // One poison row must never abort the batch — log it and let the durable
        // receipt state below classify it (it stays REFUND_DUE for the next run).
        console.error('[cron:refund-reconciler] drive threw; left REFUND_DUE for next run', {
          bookingId: booking.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      // Classify by the DURABLE receipt, not the call's return — robust whether the
      // drive succeeded, errored, or left the row mid-flight. PENDING / no-receipt
      // are retryable next run; only a terminal receipt is counted done-or-stuck.
      const receipt = await this.deps.refundRepo.findByBookingId(booking.id)
      if (receipt?.status === 'SUCCEEDED') succeeded++
      else if (receipt?.status === 'FAILED') failed++
      else pending++
    }
    return { attempted: due.length, succeeded, failed, pending }
  }
}
