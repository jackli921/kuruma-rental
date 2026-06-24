import type { PaymentRefundStatus } from '@kuruma/shared/enums'
import { paymentRefunds } from '@kuruma/shared/db/schema'
import { and, eq, notInArray } from 'drizzle-orm'
import type { PaymentRefund } from '../../stores'
import type { ClaimPaymentRefund, PaymentRefundRepository } from '../types'
import { type Db, paymentRefundColumns, toPaymentRefund } from './shared'

// Forward-only: once a receipt is terminal it is immutable. The status-advance
// WHERE excludes these so a SUCCEEDED/FAILED row can never regress to PENDING.
const TERMINAL_STATUSES: readonly PaymentRefundStatus[] = ['SUCCEEDED', 'FAILED']

/**
 * Drizzle payment_refunds (#851). Two invariants the InMemory twin mirrors:
 * an idempotent, FORWARD-ONLY status machine, and the partial UNIQUE(stripeRefundId)
 * (a 23505 here is an adoption bug, surfaced — never swallowed).
 */
export class DrizzlePaymentRefundRepository implements PaymentRefundRepository {
  constructor(private readonly db: Db) {}

  async claim(input: ClaimPaymentRefund): Promise<PaymentRefund> {
    // INSERT ... ON CONFLICT (bookingId) DO NOTHING — idempotent and forward-only:
    // a re-claim never resets an existing SUCCEEDED/FAILED receipt to PENDING. The
    // conflict path returns no row, so re-read to hand back the existing one.
    const [inserted] = await this.db
      .insert(paymentRefunds)
      .values({
        bookingId: input.bookingId,
        operatorId: input.operatorId,
        stripePaymentIntentId: input.stripePaymentIntentId,
        amountJpy: input.amountJpy,
      })
      .onConflictDoNothing({ target: paymentRefunds.bookingId })
      .returning(paymentRefundColumns)
    if (inserted) return toPaymentRefund(inserted)
    const existing = await this.findByBookingId(input.bookingId)
    if (!existing) throw new Error('payment_refunds claim found no row after conflict')
    return existing
  }

  async attachStripeRefund(
    bookingId: string,
    stripeRefundId: string,
  ): Promise<PaymentRefund | undefined> {
    // The partial UNIQUE(stripeRefundId) seal raises a 23505 if this re_ is already
    // bound to a different booking — an adoption bug the service does NOT swallow.
    const [row] = await this.db
      .update(paymentRefunds)
      .set({ stripeRefundId, updatedAt: new Date() })
      .where(eq(paymentRefunds.bookingId, bookingId))
      .returning(paymentRefundColumns)
    return row ? toPaymentRefund(row) : undefined
  }

  async markStatus(
    bookingId: string,
    status: PaymentRefundStatus,
  ): Promise<PaymentRefund | undefined> {
    const [row] = await this.db
      .update(paymentRefunds)
      .set({ status, updatedAt: new Date() })
      .where(
        and(
          eq(paymentRefunds.bookingId, bookingId),
          // Spread: drizzle's notInArray wants a mutable array, the SSoT const is readonly.
          notInArray(paymentRefunds.status, [...TERMINAL_STATUSES]),
        ),
      )
      .returning(paymentRefundColumns)
    if (row) return toPaymentRefund(row)
    // No row moved: either the receipt is terminal (return it unchanged) or absent
    // (undefined). Re-read so the contract matches InMemory exactly (#939 parity).
    return (await this.findByBookingId(bookingId)) ?? undefined
  }

  async findByBookingId(bookingId: string): Promise<PaymentRefund | null> {
    const [row] = await this.db
      .select(paymentRefundColumns)
      .from(paymentRefunds)
      .where(eq(paymentRefunds.bookingId, bookingId))
      .limit(1)
    return row ? toPaymentRefund(row) : null
  }
}
