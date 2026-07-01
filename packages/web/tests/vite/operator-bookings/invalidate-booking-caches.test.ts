import { invalidateBookingCaches } from '@/vite/operator-bookings/api'
import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'

// #1099 hardening (Theme 4): a booking write from ANY surface must refresh both
// the operator-bookings prefix (calendar/list/detail/events/needs-assignment/
// blocks cascade) AND the dashboard overview (today-buckets + headline counts).
// Before this helper only TodayPanel invalidated the overview key, so a booking
// advanced/cancelled/created/assigned/substituted elsewhere left the dashboard
// stale. The helper is the single place every mutation calls.
describe('invalidateBookingCaches', () => {
  it('invalidates the operator-bookings prefix AND the operator-overview prefix', () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    invalidateBookingCaches(queryClient)

    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['operator-bookings'] })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['operator-overview'] })
    expect(invalidate).toHaveBeenCalledTimes(2)
  })
})
