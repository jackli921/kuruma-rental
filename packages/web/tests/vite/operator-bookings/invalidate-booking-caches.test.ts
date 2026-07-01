import { OPERATOR_BOOKINGS_KEY, invalidateBookingCaches } from '@/vite/operator-bookings/api'
// Import the CANONICAL overview key from operator-dashboard (its source of truth).
// operator-bookings/api restates it as a local literal to avoid a cross-feature
// runtime module edge (reach-in ratchet), so nothing pins the two copies together
// at runtime — this test does, from the test tree (excluded from the ratchet).
import { OPERATOR_OVERVIEW_QUERY_KEY } from '@/vite/operator-dashboard/api'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

// #1099 hardening (Theme 4): a booking write from ANY surface must refresh both
// the operator-bookings prefix (calendar/list/detail/events/needs-assignment/
// blocks cascade) AND the dashboard overview (today-buckets + headline counts).
// Before this helper only TodayPanel invalidated the overview key, so a booking
// advanced/cancelled/created/assigned/substituted elsewhere left the dashboard
// stale. The helper is the single place every mutation calls.
describe('invalidateBookingCaches', () => {
  it('invalidates the operator-bookings prefix AND the canonical operator-overview prefix', () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateBookingCaches(queryClient)

    // Assert against the IMPORTED keys, not literals — so a rename of either
    // canonical key fails this test instead of silently letting the dashboard go
    // stale again (the exact bug this helper fixes). This is the drift guard for
    // the local-literal copy in operator-bookings/api.
    expect(invalidate).toHaveBeenCalledWith({ queryKey: OPERATOR_BOOKINGS_KEY })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: OPERATOR_OVERVIEW_QUERY_KEY })
    expect(invalidate).toHaveBeenCalledTimes(2)
  })
})
