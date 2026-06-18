import { formatJstDateTimeLocal } from '@/lib/datetime'
import type { BookingDto } from '@/vite/bookings/api'

/**
 * The `from`/`to` search params for a link back to a booking's storefront (#964).
 *
 * The booking carries ISO instants, but the storefront route's parser
 * (`parseJstDateTimeLocal`) only accepts wall-clock JST `datetime-local`
 * strings — a raw ISO string fails and the loader redirects to `/search`. So
 * convert through the documented inverse first. Uses `endAt` (the renter's
 * return), never `effectiveEndAt` (which adds the operator's turnaround buffer).
 */
export function buildStorefrontSearch(booking: Pick<BookingDto, 'startAt' | 'endAt'>): {
  from: string
  to: string
} {
  return {
    from: formatJstDateTimeLocal(new Date(booking.startAt)),
    to: formatJstDateTimeLocal(new Date(booking.endAt)),
  }
}
