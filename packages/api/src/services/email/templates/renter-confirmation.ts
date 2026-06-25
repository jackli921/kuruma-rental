import type { FeeSnapshotItem } from '@kuruma/shared/db/schema'
import { escapeHtml, formatDateTime, formatJpy } from './format'
import {
  type RenderedEmail,
  renderCtaSection,
  renderListSection,
  renderRowsTable,
  vehicleLabel,
} from './layout'
import { emailStrings } from './messages'

export interface RenterConfirmationData {
  bookingCode: string
  operatorName: string
  vehicle: { name: string; make: string | null; model: string | null; licensePlate: string | null }
  pickupLocationName: string
  dropoffLocationName: string
  startAt: Date
  endAt: Date
  insurance: { name: string; dailyPriceJpy: number } | null
  fees: FeeSnapshotItem[]
  preAuthHandoffUrl: string | null
  totalPriceJpy: number | null
}

/**
 * Pure renderer (FC/IS core): renter booking-confirmation email in the renter's
 * locale. Includes the booking code, resolved location NAMES, insurance, the fee
 * snapshot, and — only when present — the operator's pre-auth CTA.
 */
export function renderRenterConfirmation(
  data: RenterConfirmationData,
  locale: string,
): RenderedEmail {
  const m = emailStrings(locale)
  const rows: Array<[string, string]> = [
    [m.bookingCodeLabel, data.bookingCode],
    [m.operatorLabel, data.operatorName],
    [m.vehicleLabel, vehicleLabel(data.vehicle)],
    [m.pickupLabel, `${data.pickupLocationName} — ${formatDateTime(data.startAt)}`],
    [m.dropoffLabel, `${data.dropoffLocationName} — ${formatDateTime(data.endAt)}`],
    [
      m.insuranceLabel,
      data.insurance
        ? `${data.insurance.name} (${formatJpy(data.insurance.dailyPriceJpy)})`
        : m.insuranceDeclined,
    ],
  ]
  if (data.totalPriceJpy != null) rows.push([m.totalLabel, formatJpy(data.totalPriceJpy)])

  const feeLines = data.fees.map(
    (f: FeeSnapshotItem) => `${m.feeLabels[f.feeType]}: ${formatJpy(f.amountJpy)}`,
  )

  const subject = `${m.renterSubject} ${data.bookingCode}`

  // Order: greeting, details table, pre-auth CTA, fee list, cancellation footer.
  const table = renderRowsTable(rows)
  const preAuth = data.preAuthHandoffUrl
    ? renderCtaSection(m.preAuthTitle, data.preAuthHandoffUrl, m.preAuthCta, m.preAuthExplain)
    : { html: '', text: '' }
  const fees = renderListSection(m.potentialChargesTitle, feeLines)

  const html = `<p>${escapeHtml(m.renterGreeting)}</p>${table.html}${preAuth.html}${fees.html}<p>${escapeHtml(m.cancellationContact)}</p>`
  const text = `${m.renterGreeting}\n\n${table.text}${preAuth.text}${fees.text}\n\n${m.cancellationContact}`

  return { subject, html, text }
}
