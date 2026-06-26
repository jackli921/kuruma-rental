import { availableRevenueMonths, jstYearMonth } from '@kuruma/shared/lib/admin-revenue'
import {
  PAYMENT_EVENT_ONE_SUCCESS_CONSTRAINT,
  PAYMENT_EVENT_SESSION_CONSTRAINT,
  PAYMENT_EVENT_STRIPE_EVENT_CONSTRAINT,
  PG_ERROR,
} from '../../pg-errors'
import type { PaymentEvent } from '../../stores'
import type { NewPaymentEvent, PaymentEventRepository } from '../types'

// Mirror postgres-js's PostgresError: the violated constraint is exposed as
// `constraint_name` (what pgConstraintName reads). Faithful mirroring lets the
// PaymentService's idempotency branch behave identically here and on Drizzle.
function uniqueViolation(
  constraintName: string,
): Error & { code: string; constraint_name: string } {
  return Object.assign(new Error(`duplicate key violates unique constraint "${constraintName}"`), {
    code: PG_ERROR.UNIQUE_VIOLATION,
    constraint_name: constraintName,
  })
}

export class InMemoryPaymentEventRepository implements PaymentEventRepository {
  private readonly store: Map<string, PaymentEvent>

  constructor(store?: Map<string, PaymentEvent>) {
    this.store = store ?? new Map()
  }

  // Enforce the three DB seals in the SAME precedence Postgres would surface
  // them, so a test asserting a specific constraint name is deterministic.
  private assertNoClash(data: NewPaymentEvent): void {
    const rows = [...this.store.values()]
    if (rows.some((r) => r.stripeEventId === data.stripeEventId)) {
      throw uniqueViolation(PAYMENT_EVENT_STRIPE_EVENT_CONSTRAINT)
    }
    if (rows.some((r) => r.stripeCheckoutSessionId === data.stripeCheckoutSessionId)) {
      throw uniqueViolation(PAYMENT_EVENT_SESSION_CONSTRAINT)
    }
    // Partial seal: only SUCCEEDED rows occupy the per-booking slot.
    if (
      data.status === 'SUCCEEDED' &&
      rows.some((r) => r.status === 'SUCCEEDED' && r.bookingId === data.bookingId)
    ) {
      throw uniqueViolation(PAYMENT_EVENT_ONE_SUCCESS_CONSTRAINT)
    }
  }

  async insert(data: NewPaymentEvent): Promise<PaymentEvent> {
    this.assertNoClash(data)
    const event: PaymentEvent = { ...data, id: crypto.randomUUID(), createdAt: new Date() }
    this.store.set(event.id, event)
    return event
  }

  async findSucceededByBookingId(bookingId: string): Promise<PaymentEvent | null> {
    return (
      [...this.store.values()].find((r) => r.bookingId === bookingId && r.status === 'SUCCEEDED') ??
      null
    )
  }

  // Mirrors the Drizzle date-bounded scan: `month` (JST `YYYY-MM`) narrows to one
  // payout month using the SAME jstYearMonth boundary the SQL uses (#717).
  async listSucceeded(month?: string): Promise<PaymentEvent[]> {
    return [...this.store.values()].filter(
      (r) =>
        r.status === 'SUCCEEDED' && (month === undefined || jstYearMonth(r.createdAt) === month),
    )
  }

  async listSucceededMonths(): Promise<string[]> {
    return availableRevenueMonths([...this.store.values()].filter((r) => r.status === 'SUCCEEDED'))
  }

  // #1087: platform-overview GMV. Mirrors the Drizzle COALESCE(SUM(grossJpy),0)
  // over SUCCEEDED rows; an empty store yields 0.
  async sumSucceededGrossJpy(): Promise<number> {
    let sum = 0
    for (const r of this.store.values()) {
      if (r.status === 'SUCCEEDED') sum += r.grossJpy
    }
    return sum
  }
}
