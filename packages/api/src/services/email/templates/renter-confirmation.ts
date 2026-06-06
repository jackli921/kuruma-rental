import type { FeeSnapshotItem } from '@kuruma/shared/db/schema'
import { escapeHtml, formatDateTime, formatJpy } from './format'
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

export interface RenderedEmail {
  subject: string
  html: string
  text: string
}

function vehicleLabel(v: RenterConfirmationData['vehicle']): string {
  return v.licensePlate ? `${v.name} (${v.licensePlate})` : v.name
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

  const htmlRows = rows
    .map(([l, v]) => `<tr><td><strong>${escapeHtml(l)}</strong></td><td>${escapeHtml(v)}</td></tr>`)
    .join('')
  const htmlFees = feeLines.length
    ? `<h3>${escapeHtml(m.potentialChargesTitle)}</h3><ul>${feeLines.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`
    : ''
  const htmlPreAuth = data.preAuthHandoffUrl
    ? `<h3>${escapeHtml(m.preAuthTitle)}</h3><p>${escapeHtml(m.preAuthExplain)}</p><p><a href="${escapeHtml(data.preAuthHandoffUrl)}">${escapeHtml(m.preAuthCta)}</a></p>`
    : ''
  const html = `<p>${escapeHtml(m.renterGreeting)}</p><table>${htmlRows}</table>${htmlPreAuth}${htmlFees}<p>${escapeHtml(m.cancellationContact)}</p>`

  const textRows = rows.map(([l, v]) => `${l}: ${v}`).join('\n')
  const textFees = feeLines.length ? `\n\n${m.potentialChargesTitle}\n${feeLines.join('\n')}` : ''
  const textPreAuth = data.preAuthHandoffUrl
    ? `\n\n${m.preAuthTitle}\n${m.preAuthExplain}\n${m.preAuthCta}: ${data.preAuthHandoffUrl}`
    : ''
  const text = `${m.renterGreeting}\n\n${textRows}${textPreAuth}${textFees}\n\n${m.cancellationContact}`

  return { subject, html, text }
}
