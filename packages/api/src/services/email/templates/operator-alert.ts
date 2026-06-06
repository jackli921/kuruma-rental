import { escapeHtml, formatDateTime, formatJpy } from './format'
import { emailStrings } from './messages'
import type { RenderedEmail } from './renter-confirmation'

export interface OperatorAlertData {
  bookingCode: string
  vehicle: { name: string; make: string | null; model: string | null; licensePlate: string | null }
  pickupLocationName: string
  dropoffLocationName: string
  startAt: Date
  endAt: Date
  renterName: string | null
  totalPriceJpy: number | null
}

function vehicleLabel(v: OperatorAlertData['vehicle']): string {
  return v.licensePlate ? `${v.name} (${v.licensePlate})` : v.name
}

/**
 * Pure renderer (FC/IS core): operator new-booking alert. Defaults to ja (the
 * operator's working language, §12.2) with en available; zh optional.
 */
export function renderOperatorAlert(data: OperatorAlertData, locale: string): RenderedEmail {
  const m = emailStrings(locale)
  const rows: Array<[string, string]> = [
    [m.bookingCodeLabel, data.bookingCode],
    [m.renterLabel, data.renterName ?? '—'],
    [m.vehicleLabel, vehicleLabel(data.vehicle)],
    [m.pickupLabel, `${data.pickupLocationName} — ${formatDateTime(data.startAt)}`],
    [m.dropoffLabel, `${data.dropoffLocationName} — ${formatDateTime(data.endAt)}`],
  ]
  if (data.totalPriceJpy != null) rows.push([m.totalLabel, formatJpy(data.totalPriceJpy)])

  const subject = `${m.operatorSubject} ${data.bookingCode}`
  const htmlRows = rows
    .map(([l, v]) => `<tr><td><strong>${escapeHtml(l)}</strong></td><td>${escapeHtml(v)}</td></tr>`)
    .join('')
  const html = `<p>${escapeHtml(m.operatorHeading)}</p><table>${htmlRows}</table>`
  const text = `${m.operatorHeading}\n\n${rows.map(([l, v]) => `${l}: ${v}`).join('\n')}`

  return { subject, html, text }
}
