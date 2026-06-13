import { formatDateTime } from './format'
import { type RenderedEmail, renderRowsEmail, vehicleLabel } from './layout'
import { emailStrings } from './messages'

/**
 * #664 status-advance notice, parameterized over the two renter-visible
 * transitions: ACTIVE (trip started) and COMPLETED (trip completed). One
 * template, switched by `status`, so a future transition is a string addition
 * rather than a new file.
 */
export interface RenterStatusUpdateData {
  status: 'ACTIVE' | 'COMPLETED'
  bookingCode: string
  vehicle: { name: string; licensePlate: string | null }
  pickupLocationName: string
  dropoffLocationName: string
  startAt: Date
  endAt: Date
}

export function renderRenterStatusUpdate(
  data: RenterStatusUpdateData,
  locale: string,
): RenderedEmail {
  const m = emailStrings(locale)
  const started = data.status === 'ACTIVE'
  const rows: Array<[string, string]> = [
    [m.bookingCodeLabel, data.bookingCode],
    [m.vehicleLabel, vehicleLabel(data.vehicle)],
    [m.pickupLabel, `${data.pickupLocationName} — ${formatDateTime(data.startAt)}`],
    [m.dropoffLabel, `${data.dropoffLocationName} — ${formatDateTime(data.endAt)}`],
  ]
  return {
    subject: `${started ? m.tripStartedSubject : m.tripCompletedSubject} ${data.bookingCode}`,
    ...renderRowsEmail(started ? m.tripStartedHeading : m.tripCompletedHeading, rows),
  }
}
