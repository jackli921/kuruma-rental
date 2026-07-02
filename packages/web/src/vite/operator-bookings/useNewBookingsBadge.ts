import {
  countNewBookings,
  lastSeenQueryOptions,
  newOrderBookingsQueryOptions,
} from '@/vite/operator-bookings/new-bookings'
import { useOptionalPickedOperatorId } from '@/vite/operator-context'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

// #611: the count behind the operator's "new order" nav badge. Derived from two
// cache entries so it stays reactive: the CONFIRMED-orders scan (refetched on
// focus / slow poll) and `lastSeenAt` (advanced when the operator opens the
// orders list — see markBookingsSeen). `enabled` is false in renter view-mode so
// a renter never fires the operator-scoped scan.
//
// #1230 slice 5a: a picker admin's count narrows to the picked operator. The read
// is route-safe (undefined outside `_business`), so both nav surfaces (Navbar app-wide,
// BusinessSidebar) get the narrowed count with no caller changes.
export function useNewBookingsBadge({ enabled }: { enabled: boolean }): { count: number } {
  const pickedOperatorId = useOptionalPickedOperatorId()
  const { data: lastSeenAt } = useQuery(lastSeenQueryOptions(pickedOperatorId))
  const { data: bookings } = useQuery(newOrderBookingsQueryOptions(enabled, pickedOperatorId))

  const count = useMemo(
    () => (enabled && lastSeenAt ? countNewBookings(bookings ?? [], lastSeenAt) : 0),
    [enabled, bookings, lastSeenAt],
  )

  return { count }
}
