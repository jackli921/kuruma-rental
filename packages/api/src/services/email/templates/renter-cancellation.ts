import { formatDateTime, formatJpy } from './format'
import { type RenderedEmail, renderRowsEmail } from './layout'
import { emailStrings } from './messages'

/**
 * #664 cancellation notice: booking code + the cancelled window. The
 * cancellation fee row appears ONLY when a fee was actually charged (> 0) — a
 * free cancellation never shows a "¥0 fee" line.
 */
export interface RenterCancellationData {
  bookingCode: string
  startAt: Date
  endAt: Date
  cancellationFeeJpy: number | null
}

export function renderRenterCancellation(
  data: RenterCancellationData,
  locale: string,
): RenderedEmail {
  const m = emailStrings(locale)
  const rows: Array<[string, string]> = [
    [m.bookingCodeLabel, data.bookingCode],
    [m.pickupLabel, formatDateTime(data.startAt)],
    [m.dropoffLabel, formatDateTime(data.endAt)],
  ]
  if (data.cancellationFeeJpy != null && data.cancellationFeeJpy > 0) {
    rows.push([m.cancellationFeeLabel, formatJpy(data.cancellationFeeJpy)])
  }
  return {
    subject: `${m.cancellationSubject} ${data.bookingCode}`,
    ...renderRowsEmail(m.cancellationHeading, rows),
  }
}
