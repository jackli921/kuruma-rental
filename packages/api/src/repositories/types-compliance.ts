// §5.4/§7 (#916) compliance-digest idempotency ledger. The digest reads which
// (vehicle, document, band) triples have already alerted, then records the new
// ones AFTER a successful send — record-after-send so a failed send retries next
// day rather than silently sealing an alert that never went out.
import type { ComplianceAlertBand, ComplianceDocumentType } from '@kuruma/shared/lib/compliance'

export interface RecordComplianceAlert {
  operatorId: string
  vehicleId: string
  documentType: ComplianceDocumentType
  thresholdBand: ComplianceAlertBand
  recipient: string
}

/** Canonical key format shared by the ledger and the digest so the "already
 *  alerted?" comparison can never drift between writer and reader. */
export function complianceAlertKey(
  vehicleId: string,
  documentType: ComplianceDocumentType,
  thresholdBand: ComplianceAlertBand,
): string {
  return `${vehicleId}|${documentType}|${thresholdBand}`
}

export interface ComplianceAlertLogRepository {
  // The set of already-sent `complianceAlertKey(...)` values among these vehicles,
  // so the digest knows which bands are new before composing a mail.
  findAlertedKeys(vehicleIds: string[]): Promise<Set<string>>
  // Idempotent BATCH insert — one operator's freshly-sent bands sealed in a single
  // atomic statement. A duplicate (vehicleId, documentType, band) is a no-op (the
  // unique seal), so a same-band re-run never double-records. Batched (not one call
  // per band) so a sent digest is sealed all-or-nothing, and a single write blip
  // can't cascade past the operator it hit (#1043).
  recordMany(alerts: RecordComplianceAlert[]): Promise<void>
  // #1120 operator summary: the most recent `sentAt` among this operator's alerts,
  // or null when the operator has never been alerted. MAX at the DB layer — never
  // load-then-scan. Powers the "last compliance alert" field on the admin summary.
  latestSentAtForOperator(operatorId: string): Promise<Date | null>
}
