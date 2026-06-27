// Fixture: same-feature deep import is allowed.
import { fetchBookings } from '@/vite/bookings/api'

export function BookingList() {
  return fetchBookings()
}
