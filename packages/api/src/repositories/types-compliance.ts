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
  // Idempotent insert — a duplicate (vehicleId, documentType, band) is a no-op
  // (the unique seal), so a same-band re-run never double-records.
  record(data: RecordComplianceAlert): Promise<void>
}
