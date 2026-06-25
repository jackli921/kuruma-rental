import { bookings, paymentRefunds } from '@kuruma/shared/db/schema'
import { and, eq, isNull, ne, or } from 'drizzle-orm'
import type { Booking } from '../../stores'
import type { RefundReconcilerRepository } from '../types'
import { type Db, bookingColumns, toBooking } from './shared'

/**
 * Drizzle reconciler scan (#851 S4). A booking-driven LEFT JOIN so a REFUND_DUE
 * booking whose eager-fire never claimed a receipt (the primary self-heal case)
 * still surfaces. The FAILED-receipt exclusion lives in the WHERE — applied
 * before LIMIT — so a backlog of human-stuck FAILED rows can't starve retryable
 * work. System-scoped (a cron has no caller): intentionally no tenant filter.
 */
export class DrizzleRefundReconcilerRepository implements RefundReconcilerRepository {
  constructor(private readonly db: Db) {}

  async listRefundDueNeedingDrive(opts: { limit: number }): Promise<Booking[]> {
    const rows = await this.db
      .select(bookingColumns)
      .from(bookings)
      .leftJoin(paymentRefunds, eq(paymentRefunds.bookingId, bookings.id))
      .where(
        and(
          eq(bookings.cancellationFeeSettlement, 'REFUND_DUE'),
          // Drive anything not terminally FAILED: no receipt (lost eager-fire), a
          // PENDING one, OR a SUCCEEDED receipt whose booking is still REFUND_DUE —
          // the crash between confirmRefundSucceeded's two writes (a healthy refund
          // leaves the booking REFUNDED, filtered above, so SUCCEEDED here is ONLY
          // that orphan; its drive is a no-Stripe booking-side confirm). NULL status
          // (no receipt) fails `ne`, so the isNull branch admits it. payment_refunds
          // is UNIQUE(bookingId), so the join fans out at most 1:1 — no dedupe needed.
          or(isNull(paymentRefunds.id), ne(paymentRefunds.status, 'FAILED')),
        ),
      )
      .orderBy(bookings.cancelledAt)
      .limit(opts.limit)
    return rows.map(toBooking)
  }
}
