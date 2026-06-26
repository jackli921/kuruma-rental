// Fixture: reaches into another feature's internals (forbidden).
import { useBookings } from '@/vite/bookings/api'

export function ReservationWizard() {
  return useBookings()
}
