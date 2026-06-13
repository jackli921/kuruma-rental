import { paymentEvents } from '@kuruma/shared/db/schema'
import { type SQL, and, eq, sql } from 'drizzle-orm'
import type { PaymentEvent } from '../../stores'
import type { NewPaymentEvent, PaymentEventRepository } from '../types'
import { type Db, paymentEventColumns, toPaymentEvent } from './shared'

// The JST (`Asia/Tokyo`) payout month of a row, as `YYYY-MM`. Japan observes no
// DST, so `AT TIME ZONE` is a constant +9 shift — byte-identical to the pure
// `jstYearMonth` (UTC+9 then slice) the report aggregation uses (#462/#717).
const jstMonthExpr = sql<string>`to_char(${paymentEvents.createdAt} AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM')`

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
  // AdminRevenueService gates the caller before this runs. `month` (`YYYY-MM`,
  // JST) bounds the scan to one payout month so the Worker never materializes the
  // whole monotonically growing table (#717). The bind is parameterized.
  async listSucceeded(month?: string): Promise<PaymentEvent[]> {
    const status = eq(paymentEvents.status, 'SUCCEEDED')
    const where: SQL | undefined =
      month === undefined ? status : and(status, sql`${jstMonthExpr} = ${month}`)
    const rows = await this.db.select(paymentEventColumns).from(paymentEvents).where(where)
    return rows.map(toPaymentEvent)
  }

  // Distinct JST payout months with >=1 SUCCEEDED payment, newest first — a cheap
  // DISTINCT instead of pulling every row to derive the picker options (#717).
  async listSucceededMonths(): Promise<string[]> {
    const rows = await this.db
      .selectDistinct({ month: jstMonthExpr })
      .from(paymentEvents)
      .where(eq(paymentEvents.status, 'SUCCEEDED'))
      .orderBy(sql`${jstMonthExpr} desc`)
    return rows.map((r) => r.month)
  }
}
