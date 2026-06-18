import type { ComplianceAlertBand, ComplianceDocumentType } from '@kuruma/shared/lib/compliance'
import { type RenderedEmail, renderRowsEmail, vehicleLabel } from './layout'
import { emailStrings } from './messages'

export interface ComplianceDigestItem {
  vehicle: { name: string; licensePlate: string | null }
  documentType: ComplianceDocumentType
  band: ComplianceAlertBand
}

export interface ComplianceDigestData {
  items: ComplianceDigestItem[]
}

/**
 * Pure renderer (FC/IS core): the operator fleet-compliance digest (#916 §5.4).
 * One mail per operator, one row per flagged (vehicle, document) — the row value
 * names the document and its alert band ("Shaken — expires in 7 days"). Defaults
 * to ja (the operator working language, §12.2); en/zh available.
 */
export function renderComplianceDigest(data: ComplianceDigestData, locale: string): RenderedEmail {
  const m = emailStrings(locale)
  const rows: Array<[string, string]> = data.items.map((item) => [
    vehicleLabel(item.vehicle),
    `${m.complianceDocLabels[item.documentType]} — ${m.complianceBandLabels[item.band]}`,
  ])
  const subject = `${m.complianceSubject} ${data.items.length}`
  return { subject, ...renderRowsEmail(m.complianceHeading, rows) }
}
