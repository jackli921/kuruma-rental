import type { AddOnSnapshot, BookingSource } from '@kuruma/shared/db/schema'
import { escapeHtml, formatDateTime, formatDuration, formatJpy } from './format'
import {
  type RenderedEmail,
  renderCtaSection,
  renderListSection,
  renderRowsTable,
  vehicleLabel,
} from './layout'
import { emailStrings } from './messages'

export interface OperatorAlertData {
  bookingCode: string
  vehicle: { name: string; make: string | null; model: string | null; licensePlate: string | null }
  pickupLocationName: string
  dropoffLocationName: string
  startAt: Date
  endAt: Date
  renterName: string | null
  renterEmail: string | null
  renterPhone: string | null
  insurance: { name: string; dailyPriceJpy: number } | null
  addOns: AddOnSnapshot[]
  source: BookingSource | null
  totalPriceJpy: number | null
  // Deep link to the booking in the operator dashboard. Null when WEB_ORIGIN is
  // unset (the imperative shell can't build a URL), in which case the CTA is omitted.
  manageBookingUrl: string | null
}

/**
 * Pure renderer (FC/IS core): operator new-booking alert. Defaults to ja (the
 * operator's working language, §12.2) with en available; zh optional. Carries the
 * operational detail the operator acts on — renter contact, rental length,
 * insurance, paid add-ons, source — and a deep link straight to the booking (#960).
 */
export function renderOperatorAlert(data: OperatorAlertData, locale: string): RenderedEmail {
  const m = emailStrings(locale)

  // Whichever contact channels we have, joined; the row is dropped when neither exists.
  const contact = [data.renterEmail, data.renterPhone].filter(Boolean).join(' · ')

  const rows: Array<[string, string]> = [
    [m.bookingCodeLabel, data.bookingCode],
    [m.renterLabel, data.renterName ?? '—'],
    ...(contact ? [[m.contactLabel, contact] as [string, string]] : []),
    [m.vehicleLabel, vehicleLabel(data.vehicle)],
    [m.pickupLabel, `${data.pickupLocationName} — ${formatDateTime(data.startAt)}`],
    [m.dropoffLabel, `${data.dropoffLocationName} — ${formatDateTime(data.endAt)}`],
    [m.periodLabel, formatDuration(data.startAt, data.endAt, m)],
    [
      m.insuranceLabel,
      data.insurance
        ? `${data.insurance.name} (${formatJpy(data.insurance.dailyPriceJpy)})`
        : m.insuranceDeclined,
    ],
    ...(data.source ? [[m.sourceLabel, m.sourceNames[data.source]] as [string, string]] : []),
  ]
  if (data.totalPriceJpy != null) rows.push([m.totalLabel, formatJpy(data.totalPriceJpy)])

  const addOnLines = data.addOns.map((a) => `${a.name}: ${formatJpy(a.priceJpy)}`)

  const subject = `${m.operatorSubject} ${data.bookingCode}`

  // Order: heading, details table, add-on list, manage-booking CTA.
  const table = renderRowsTable(rows)
  const addOns = renderListSection(m.addOnsLabel, addOnLines)
  const cta = data.manageBookingUrl
    ? renderCtaSection(m.manageBookingTitle, data.manageBookingUrl, m.manageBookingCta)
    : { html: '', text: '' }

  const html = `<p>${escapeHtml(m.operatorHeading)}</p>${table.html}${addOns.html}${cta.html}`
  const text = `${m.operatorHeading}\n\n${table.text}${addOns.text}${cta.text}`

  return { subject, html, text }
}
