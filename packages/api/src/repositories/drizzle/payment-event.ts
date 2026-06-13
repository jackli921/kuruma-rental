import { paymentEvents } from '@kuruma/shared/db/schema'
import { and, eq } from 'drizzle-orm'
import type { PaymentEvent } from '../../stores'
import type { NewPaymentEvent, PaymentEventRepository } from '../types'
import { type Db, paymentEventColumns, toPaymentEvent } from './shared'

export class DrizzlePaymentEventRepository implements PaymentEventRepository {
  constructor(private readonly db: Db) {}

  // The DB enforces all three unique seals; a violation bubbles up as a
  // PostgresError whose constraint_name the PaymentService reads to tell a
  // redelivered webhook (no-op) apart from a double-pay anomaly. We do NOT
  // swallow it here — that policy decision belongs to the service.
  async insert(data: NewPaymentEvent): Promise<PaymentEvent> {
    const [row] = await this.db.insert(paymentEvents).values(data).returning(paymentEventColumns)
    // .returning always yields the inserted row on success; the non-null branch
    // is unreachable but keeps the type honest without a non-null assertion.
    if (!row) throw new Error('payment_events insert returned no row')
    return toPaymentEvent(row)
  }

  async findSucceededByBookingId(bookingId: string): Promise<PaymentEvent | null> {
    const [row] = await this.db
      .select(paymentEventColumns)
      .from(paymentEvents)
      .where(and(eq(paymentEvents.bookingId, bookingId), eq(paymentEvents.status, 'SUCCEEDED')))
      .limit(1)
    return row ? toPaymentEvent(row) : null
  }

  // Platform-admin revenue report (#462). Cross-operator by design; the
  // AdminRevenueService gates the caller before this runs.
  async listSucceeded(): Promise<PaymentEvent[]> {
    const rows = await this.db
      .select(paymentEventColumns)
      .from(paymentEvents)
      .where(eq(paymentEvents.status, 'SUCCEEDED'))
    return rows.map(toPaymentEvent)
  }
}
