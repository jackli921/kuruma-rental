import type { PaymentAnomaly } from '../../stores'
import type {
  NewPaymentAnomaly,
  PaymentAnomalyRepository,
  ResolvePaymentAnomalyInput,
} from '../types'
import { PAYMENT_ANOMALY_LIST_LIMIT } from '../types-payment'

// Newest-first by createdAt, then cap — mirrors the Drizzle `ORDER BY createdAt
// DESC LIMIT n` so both stores return the same bounded, ordered browse.
function newestFirstCapped(rows: PaymentAnomaly[]): PaymentAnomaly[] {
  return [...rows]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, PAYMENT_ANOMALY_LIST_LIMIT)
}

export class InMemoryPaymentAnomalyRepository implements PaymentAnomalyRepository {
  private readonly store: Map<string, PaymentAnomaly>

  constructor(store?: Map<string, PaymentAnomaly>) {
    this.store = store ?? new Map()
  }

  // Idempotent on stripeEventId: the Drizzle table enforces this with a unique
  // index + ON CONFLICT DO NOTHING; here we mirror the no-op so a redelivered
  // webhook behaves identically against both stores.
  async record(data: NewPaymentAnomaly): Promise<void> {
    const exists = [...this.store.values()].some((r) => r.stripeEventId === data.stripeEventId)
    if (exists) return
    const anomaly: PaymentAnomaly = {
      ...data,
      id: crypto.randomUUID(),
      resolvedAt: null,
      resolution: null,
      resolvedBy: null,
      note: null,
      createdAt: new Date(),
    }
    this.store.set(anomaly.id, anomaly)
  }

  async listUnresolved(): Promise<PaymentAnomaly[]> {
    return newestFirstCapped([...this.store.values()].filter((r) => r.resolvedAt === null))
  }

  // #1087: platform-overview open-anomaly KPI. Mirrors the Drizzle COUNT(* WHERE
  // resolvedAt IS NULL).
  async countUnresolved(): Promise<number> {
    let n = 0
    for (const r of this.store.values()) {
      if (r.resolvedAt === null) n++
    }
    return n
  }

  async listResolved(): Promise<PaymentAnomaly[]> {
    return newestFirstCapped([...this.store.values()].filter((r) => r.resolvedAt !== null))
  }

  // Guarded, write-once: mirrors the Drizzle `WHERE id AND resolvedAt IS NULL` so an
  // already-resolved (or unknown) id is a no-op returning null, not a silent overwrite.
  async resolve(id: string, input: ResolvePaymentAnomalyInput): Promise<PaymentAnomaly | null> {
    const existing = this.store.get(id)
    if (!existing || existing.resolvedAt !== null) return null
    const resolved: PaymentAnomaly = {
      ...existing,
      resolvedAt: new Date(),
      resolution: input.resolution,
      resolvedBy: input.resolvedBy,
      note: input.note,
    }
    this.store.set(id, resolved)
    return resolved
  }
}
