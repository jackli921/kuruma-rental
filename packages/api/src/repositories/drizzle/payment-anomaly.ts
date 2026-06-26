import { paymentAnomalies } from '@kuruma/shared/db/schema'
import { and, count, eq, isNotNull, isNull } from 'drizzle-orm'
import type { PaymentAnomaly } from '../../stores'
import type {
  NewPaymentAnomaly,
  PaymentAnomalyRepository,
  ResolvePaymentAnomalyInput,
} from '../types'
import { type Db, paymentAnomalyColumns, toPaymentAnomaly } from './shared'

export class DrizzlePaymentAnomalyRepository implements PaymentAnomalyRepository {
  constructor(private readonly db: Db) {}

  // Idempotent on stripeEventId: a redelivered webhook re-derives the same anomaly,
  // and the unique index + ON CONFLICT DO NOTHING make the second write a no-op.
  async record(data: NewPaymentAnomaly): Promise<void> {
    await this.db
      .insert(paymentAnomalies)
      .values(data)
      .onConflictDoNothing({ target: paymentAnomalies.stripeEventId })
  }

  // Unresolved anomalies across all operators for the platform-admin surface.
  // Cross-operator by design; the service gates the caller before this runs.
  async listUnresolved(): Promise<PaymentAnomaly[]> {
    const rows = await this.db
      .select(paymentAnomalyColumns)
      .from(paymentAnomalies)
      .where(isNull(paymentAnomalies.resolvedAt))
    return rows.map(toPaymentAnomaly)
  }

  // #1087 platform overview: open-anomaly count. COUNT at the DB, never load-then-count.
  async countUnresolved(): Promise<number> {
    const [row] = await this.db
      .select({ value: count() })
      .from(paymentAnomalies)
      .where(isNull(paymentAnomalies.resolvedAt))
    return row?.value ?? 0
  }

  async listResolved(): Promise<PaymentAnomaly[]> {
    const rows = await this.db
      .select(paymentAnomalyColumns)
      .from(paymentAnomalies)
      .where(isNotNull(paymentAnomalies.resolvedAt))
    return rows.map(toPaymentAnomaly)
  }

  // Write-once close: the `isNull(resolvedAt)` predicate makes the UPDATE match zero
  // rows for an unknown OR already-resolved id, so `.returning()` is empty and we
  // return null (=> 404) instead of silently overwriting who first closed it.
  async resolve(id: string, input: ResolvePaymentAnomalyInput): Promise<PaymentAnomaly | null> {
    const rows = await this.db
      .update(paymentAnomalies)
      .set({
        resolvedAt: new Date(),
        resolution: input.resolution,
        resolvedBy: input.resolvedBy,
        note: input.note,
      })
      .where(and(eq(paymentAnomalies.id, id), isNull(paymentAnomalies.resolvedAt)))
      .returning(paymentAnomalyColumns)
    const row = rows[0]
    return row ? toPaymentAnomaly(row) : null
  }
}
