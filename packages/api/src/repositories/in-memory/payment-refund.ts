import { PAYMENT_REFUND_STRIPE_REFUND_CONSTRAINT, PG_ERROR } from '../../pg-errors'
import type { PaymentRefund } from '../../stores'
import type { ClaimPaymentRefund, PaymentRefundRepository } from '../types'

// Mirror postgres-js's PostgresError so the partial-UNIQUE(stripeRefundId) seal
// surfaces identically here and on Drizzle (faithful `constraint_name`).
function uniqueViolation(
  constraintName: string,
): Error & { code: string; constraint_name: string } {
  return Object.assign(new Error(`duplicate key violates unique constraint "${constraintName}"`), {
    code: PG_ERROR.UNIQUE_VIOLATION,
    constraint_name: constraintName,
  })
}

/**
 * In-memory payment_refunds (#851), keyed by bookingId (the UNIQUE seal). Mirrors
 * the Drizzle repo's two invariants: an idempotent, FORWARD-ONLY status machine and
 * the partial UNIQUE(stripeRefundId) so InMemory↔Drizzle parity holds in unit tests.
 */
export class InMemoryPaymentRefundRepository implements PaymentRefundRepository {
  private readonly store: Map<string, PaymentRefund>

  constructor(store?: Map<string, PaymentRefund>) {
    this.store = store ?? new Map()
  }

  async claim(input: ClaimPaymentRefund): Promise<PaymentRefund> {
    // ON CONFLICT (bookingId) DO NOTHING → return the existing row unchanged.
    // Forward-only: re-claiming a SUCCEEDED/FAILED receipt never resets it to PENDING.
    const existing = this.store.get(input.bookingId)
    if (existing) return existing
    const now = new Date()
    const row: PaymentRefund = {
      id: crypto.randomUUID(),
      bookingId: input.bookingId,
      operatorId: input.operatorId,
      stripePaymentIntentId: input.stripePaymentIntentId,
      amountJpy: input.amountJpy,
      stripeRefundId: null,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    }
    this.store.set(row.bookingId, row)
    return row
  }

  async attachStripeRefund(
    bookingId: string,
    stripeRefundId: string,
  ): Promise<PaymentRefund | undefined> {
    const row = this.store.get(bookingId)
    if (!row) return undefined
    // Partial UNIQUE(stripeRefundId): the same re_ can't bind to a second booking.
    const clash = [...this.store.values()].some(
      (r) => r.bookingId !== bookingId && r.stripeRefundId === stripeRefundId,
    )
    if (clash) throw uniqueViolation(PAYMENT_REFUND_STRIPE_REFUND_CONSTRAINT)
    const next: PaymentRefund = { ...row, stripeRefundId, updatedAt: new Date() }
    this.store.set(bookingId, next)
    return next
  }

  async markStatus(
    bookingId: string,
    status: PaymentRefund['status'],
  ): Promise<PaymentRefund | undefined> {
    const row = this.store.get(bookingId)
    if (!row) return undefined
    // Forward-only: a terminal receipt is immutable (mirrors the Drizzle guard).
    if (row.status === 'SUCCEEDED' || row.status === 'FAILED') return row
    const next: PaymentRefund = { ...row, status, updatedAt: new Date() }
    this.store.set(bookingId, next)
    return next
  }

  async findByBookingId(bookingId: string): Promise<PaymentRefund | null> {
    return this.store.get(bookingId) ?? null
  }
}
