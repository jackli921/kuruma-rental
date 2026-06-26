import type { PaymentRefundStatus } from '@kuruma/shared/enums'
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
  // #1087 platform overview: total GMV = `COALESCE(SUM(grossJpy), 0)` over
  // SUCCEEDED payments, in whole JPY. A DB SUM (mirrors vehicle-detail revenue),
  // never load-then-sum. Unscoped — authz lives in AdminOverviewService.
  sumSucceededGrossJpy(): Promise<number>
}

/** A payment anomaly to persist. id/createdAt/resolvedAt are store-assigned (#508 P2). */
export type NewPaymentAnomaly = Omit<PaymentAnomaly, 'id' | 'createdAt' | 'resolvedAt'>

/** payment_anomalies data access (#508 P2). The webhook is the only writer. */
export interface PaymentAnomalyRepository {
  // Persist an anomaly for operator review. IDEMPOTENT on stripeEventId: a
  // redelivered webhook (which re-derives the same anomaly) must not stack rows.
  record(anomaly: NewPaymentAnomaly): Promise<void>
  // Unresolved anomalies across all operators for the platform-admin surface.
  // Unscoped by design — authz lives in the service (mirrors listSucceeded).
  listUnresolved(): Promise<PaymentAnomaly[]>
  // #1087 platform overview: `COUNT(* WHERE resolvedAt IS NULL)` for the
  // open-anomalies KPI. COUNT at the DB layer, never load-then-count.
  countUnresolved(): Promise<number>
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
