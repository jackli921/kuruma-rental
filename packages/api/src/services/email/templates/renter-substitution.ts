import { formatDateTime } from './format'
import { type RenderedEmail, renderRowsEmail, vehicleLabel } from './layout'
import { emailStrings } from './messages'

/**
 * #664 substitution notice. Renders ONLY the renter-facing facts — the NEW
 * assigned vehicle, the booking code, and the (unchanged) pickup/dropoff window.
 * The operator's substitution reason and the acting staff id are internal and
 * are deliberately NOT passed in, so they can never leak into the email.
 */
export interface RenterSubstitutionData {
  bookingCode: string
  vehicle: { name: string; licensePlate: string | null }
  pickupLocationName: string
  dropoffLocationName: string
  startAt: Date
  endAt: Date
}

export function renderRenterSubstitution(
  data: RenterSubstitutionData,
  locale: string,
): RenderedEmail {
  const m = emailStrings(locale)
  const rows: Array<[string, string]> = [
    [m.bookingCodeLabel, data.bookingCode],
    [m.newVehicleLabel, vehicleLabel(data.vehicle)],
    [m.pickupLabel, `${data.pickupLocationName} — ${formatDateTime(data.startAt)}`],
    [m.dropoffLabel, `${data.dropoffLocationName} — ${formatDateTime(data.endAt)}`],
  ]
  return {
    subject: `${m.substitutionSubject} ${data.bookingCode}`,
    ...renderRowsEmail(m.substitutionHeading, rows),
  }
}
