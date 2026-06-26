import type { PaymentAnomaly } from '../../stores'
import type { NewPaymentAnomaly, PaymentAnomalyRepository } from '../types'

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
      createdAt: new Date(),
    }
    this.store.set(anomaly.id, anomaly)
  }

  async listUnresolved(): Promise<PaymentAnomaly[]> {
    return [...this.store.values()].filter((r) => r.resolvedAt === null)
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
}
