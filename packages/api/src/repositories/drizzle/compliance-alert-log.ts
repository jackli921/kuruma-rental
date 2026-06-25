import { complianceAlertLog } from '@kuruma/shared/db/schema'
import { inArray } from 'drizzle-orm'
import {
  type ComplianceAlertLogRepository,
  complianceAlertKey,
  type RecordComplianceAlert,
} from '../types'
import type { Db } from './shared'

/**
 * Drizzle ComplianceAlertLogRepository (#916 §5.4/§7). `recordMany` is one
 * idempotent bulk insert — `onConflictDoNothing` on the (vehicleId, documentType,
 * thresholdBand) unique seal makes any already-sealed band a no-op, so the digest
 * can record after a successful send without ever double-writing. A single
 * statement = one operator's bands seal atomically (#1043).
 */
export class DrizzleComplianceAlertLogRepository implements ComplianceAlertLogRepository {
  constructor(private readonly db: Db) {}

  async findAlertedKeys(vehicleIds: string[]): Promise<Set<string>> {
    if (vehicleIds.length === 0) return new Set()
    const rows = await this.db
      .select({
        vehicleId: complianceAlertLog.vehicleId,
        documentType: complianceAlertLog.documentType,
        thresholdBand: complianceAlertLog.thresholdBand,
      })
      .from(complianceAlertLog)
      .where(inArray(complianceAlertLog.vehicleId, vehicleIds))
    return new Set(rows.map((r) => complianceAlertKey(r.vehicleId, r.documentType, r.thresholdBand)))
  }

  async recordMany(alerts: RecordComplianceAlert[]): Promise<void> {
    if (alerts.length === 0) return
    await this.db.insert(complianceAlertLog).values(alerts).onConflictDoNothing()
  }
}
