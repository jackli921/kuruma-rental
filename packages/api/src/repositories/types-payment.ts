import type { PaymentRefundStatus } from '@kuruma/shared/enums'
import type { PaymentAnomalyResolution } from '@kuruma/shared/types/payment-anomaly'
import type { Booking, PaymentAnomaly, PaymentEvent, PaymentRefund } from '../stores'

/** A verified successful payment to persist. id + createdAt are assigned by the
 *  store (DB defaults / in-memory), so the service never invents them (#461). */
export type NewPaymentEvent = Omit<PaymentEvent, 'id' | 'createdAt'>

/** payment_events data access (#461). The webhook is the only writer. */
export interface PaymentEventRepository {
  // Persist a verified successful payment. Throws a PG-shaped UNIQUE_VIOLATION
  // (with `constraint_name`) when any of the three seals is hit, so the
  // PaymentService can tell a redelivered webhook (idempotent no-op) apart from
  // a second Session paying the same booking (double-pay anomaly). See pg-errors.
  insert(event: NewPaymentEvent): Promise<PaymentEvent>
  // The recorded SUCCEEDED payment for a booking, or null. Powers both the
  // already-paid guard at checkout and the derived "is this booking paid?" read.
  findSucceededByBookingId(bookingId: string): Promise<PaymentEvent | null>
  // SUCCEEDED payments across all operators, for the platform-admin revenue
  // report (#462). Unscoped by design — authz lives in AdminRevenueService.
  // `month` (`YYYY-MM`, JST) bounds the scan to one payout month so the Worker
  // never materializes the whole monotonically growing table (#717); omit it for
  // the full set.
  listSucceeded(month?: string): Promise<PaymentEvent[]>
  // The distinct JST (`Asia/Tokyo`) payout months that have >=1 SUCCEEDED
  // payment, newest first. Powers the month picker without materializing every
  // row (#717).
  listSucceededMonths(): Promise<string[]>
}

/** A payment anomaly to persist. id/createdAt are store-assigned; the resolution
 *  audit fields (resolvedAt/resolution/resolvedBy/note) start NULL and are set only
 *  by `resolve()` — the webhook writer never supplies them (#508 P2, #1075 slice 3). */
export type NewPaymentAnomaly = Omit<
  PaymentAnomaly,
  'id' | 'createdAt' | 'resolvedAt' | 'resolution' | 'resolvedBy' | 'note'
>

/** The audit an admin writes to close an anomaly's review-queue item (#1075 slice 3).
 *  `resolvedBy` is the actioning admin's id (from the caller ctx, never the body);
 *  `note` is optional free-text. Carries NO money — v1 only clears the queue. */
export interface ResolvePaymentAnomalyInput {
  resolution: PaymentAnomalyResolution
  resolvedBy: string
  note: string | null
}

/** payment_anomalies data access (#508 P2). The webhook is the only writer of new
 *  rows; an admin resolution (#1075 slice 3) is the only other mutation. */
export interface PaymentAnomalyRepository {
  // Persist an anomaly for operator review. IDEMPOTENT on stripeEventId: a
  // redelivered webhook (which re-derives the same anomaly) must not stack rows.
  record(anomaly: NewPaymentAnomaly): Promise<void>
  // Unresolved anomalies across all operators for the platform-admin surface.
  // Unscoped by design — authz lives in the service (mirrors listSucceeded).
  listUnresolved(): Promise<PaymentAnomaly[]>
  // Resolved anomalies across all operators (the "resolved" filter tab). Also
  // unscoped; the service is the authz chokepoint.
  listResolved(): Promise<PaymentAnomaly[]>
  // Close an anomaly: set resolvedAt=now plus the audit fields in ONE guarded
  // UPDATE (WHERE id AND resolvedAt IS NULL). Returns the updated row, or null when
  // the id is unknown OR already resolved — the resolution audit is write-once, so a
  // double-resolve is a no-op (=> 404), never a silent overwrite of who closed it.
  resolve(id: string, input: ResolvePaymentAnomalyInput): Promise<PaymentAnomaly | null>
}

/** A refund attempt to claim. id/createdAt/updatedAt are store-assigned; stripeRefundId
 *  starts null (attached after create/adopt); status starts PENDING (#851). */
export type ClaimPaymentRefund = Pick<
  PaymentRefund,
  'bookingId' | 'operatorId' | 'stripePaymentIntentId' | 'amountJpy'
>

/** payment_refunds data access (#851) — the durable refund receipt + create-dedup
 *  ledger. One row per booking; status is FORWARD-ONLY (terminal never regresses). */
export interface PaymentRefundRepository {
  // Idempotent upsert: insert a PENDING receipt for the booking, or return the
  // EXISTING row unchanged — never regressing a SUCCEEDED/FAILED receipt to PENDING.
  // The durable "refund started" claim, written before any Stripe call.
  claim(input: ClaimPaymentRefund): Promise<PaymentRefund>
  // Bind the Stripe refund id (re_…) to the booking's receipt. Throws a PG-shaped
  // UNIQUE_VIOLATION (PAYMENT_REFUND_STRIPE_REFUND_CONSTRAINT) if that re_ is already
  // bound to a different booking — an adoption bug, never a silent no-op.
  attachStripeRefund(bookingId: string, stripeRefundId: string): Promise<PaymentRefund | undefined>
  // Advance the receipt status. Forward-only: a terminal SUCCEEDED/FAILED is immutable.
  markStatus(bookingId: string, status: PaymentRefundStatus): Promise<PaymentRefund | undefined>
  findByBookingId(bookingId: string): Promise<PaymentRefund | null>
}

/** The reconciler backstop's bounded scan (#851 S4). Separate port (not a
 *  BookingRepository method) because it spans two aggregates — bookings LEFT JOIN
 *  payment_refunds — and keeps the central booking repo (+ its 800-line types home)
 *  unbloated. System-scoped: a cron has no caller, so there is no tenant ctx. */
export interface RefundReconcilerRepository {
  // Up to `limit` bookings durably owed a refund (`cancellationFeeSettlement =
  // 'REFUND_DUE'`) whose receipt is absent (a lost eager-fire — the primary
  // self-heal case) OR still PENDING. Terminal receipts (SUCCEEDED already-done,
  // FAILED needs-a-human) are excluded IN-QUERY, before the limit, so they can
  // never starve retryable work. Oldest cancellation first (fair drain order).
  listRefundDueNeedingDrive(opts: { limit: number }): Promise<Booking[]>
}
