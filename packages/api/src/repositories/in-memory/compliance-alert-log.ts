import type { ComplianceAlertLog } from '../../stores'
import {
  type ComplianceAlertLogRepository,
  type RecordComplianceAlert,
  complianceAlertKey,
} from '../types'

/**
 * In-memory ComplianceAlertLogRepository (#916 §5.4/§7). `recordMany` is idempotent
 * on (vehicleId, documentType, thresholdBand) — a duplicate band is a no-op,
 * mirroring the DB unique seal. The `now` clock is injectable for deterministic
 * `sentAt` in tests.
 */
export class InMemoryComplianceAlertLogRepository implements ComplianceAlertLogRepository {
  private readonly store: Map<string, ComplianceAlertLog>
  private readonly byKey = new Set<string>()

  constructor(
    store?: Map<string, ComplianceAlertLog>,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.store = store ?? new Map()
    for (const row of this.store.values()) {
      this.byKey.add(complianceAlertKey(row.vehicleId, row.documentType, row.thresholdBand))
    }
  }

  async findAlertedKeys(vehicleIds: string[]): Promise<Set<string>> {
    const wanted = new Set(vehicleIds)
    const keys = new Set<string>()
    for (const row of this.store.values()) {
      if (wanted.has(row.vehicleId)) {
        keys.add(complianceAlertKey(row.vehicleId, row.documentType, row.thresholdBand))
      }
    }
    return keys
  }

  async recordMany(alerts: RecordComplianceAlert[]): Promise<void> {
    for (const data of alerts) {
      const key = complianceAlertKey(data.vehicleId, data.documentType, data.thresholdBand)
      if (this.byKey.has(key)) continue // unique seal — same-band re-run is a no-op
      this.byKey.add(key)
      const id = crypto.randomUUID()
      this.store.set(id, { id, ...data, sentAt: this.now() })
    }
  }
}
