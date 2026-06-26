// Fixture: legitimate cross-feature use via the per-feature barrel.
import { useBookings } from '@/vite/bookings'

export function GoodBarrelConsumer() {
  return useBookings()
}
