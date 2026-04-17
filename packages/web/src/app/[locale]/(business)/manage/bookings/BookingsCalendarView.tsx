'use client'

import { BookingsCalendar, toCalendarEvents } from '@/components/calendar/BookingsCalendar'
import { Skeleton } from '@/components/ui/skeleton'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { endOfMonth, startOfMonth } from 'date-fns'
import { useState } from 'react'
import { fetchAllCalendarBookings } from './booking-actions'

export function BookingsCalendarView() {
  const queryClient = useQueryClient()
  const [range, _setRange] = useState(() => ({
    from: startOfMonth(new Date()).toISOString(),
    to: endOfMonth(new Date()).toISOString(),
  }))

  const {
    data: bookings = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['bookings', 'calendar', range.from, range.to],
    queryFn: () => fetchAllCalendarBookings(range.from, range.to),
  })

  const events = toCalendarEvents(bookings)

  if (isLoading) {
    return (
      <div className="mt-6 space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    )
  }

  if (error) {
    return <p className="mt-6 text-sm text-destructive">Failed to load bookings</p>
  }

  return (
    <div className="mt-6">
      <BookingsCalendar
        events={events}
        defaultView="week"
        views={['week', 'month']}
        onBookingUpdate={() => {
          queryClient.invalidateQueries({
            queryKey: ['bookings', 'calendar'],
          })
        }}
      />
    </div>
  )
}
