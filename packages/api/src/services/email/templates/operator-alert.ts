import { formatDateTime, formatJpy } from './format'
import { type RenderedEmail, renderRowsEmail, vehicleLabel } from './layout'
import { emailStrings } from './messages'

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
  return { subject, ...renderRowsEmail(m.operatorHeading, rows) }
}
