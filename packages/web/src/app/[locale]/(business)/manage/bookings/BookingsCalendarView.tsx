'use client'

import {
  BookingsCalendar,
  type CalendarResource,
  toCalendarEvents,
} from '@/components/calendar/BookingsCalendar'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchFleetOverviewAction } from '@/lib/vehicle-actions'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { endOfDay, endOfMonth, endOfWeek, startOfDay, startOfMonth, startOfWeek } from 'date-fns'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import type { View } from 'react-big-calendar'
import { fetchAllCalendarBookings } from './booking-actions'

function computeRange(view: View, date: Date): { from: string; to: string } {
  switch (view) {
    case 'day':
      return { from: startOfDay(date).toISOString(), to: endOfDay(date).toISOString() }
    case 'week':
      return {
        from: startOfWeek(date, { weekStartsOn: 1 }).toISOString(),
        to: endOfWeek(date, { weekStartsOn: 1 }).toISOString(),
      }
    default:
      return { from: startOfMonth(date).toISOString(), to: endOfMonth(date).toISOString() }
  }
}

function parseInitialDate(param: string | null): Date {
  if (!param) return new Date()
  const d = new Date(param)
  return Number.isNaN(d.getTime()) ? new Date() : d
}

function parseInitialView(param: string | null): View {
  if (param === 'day' || param === 'week' || param === 'month') return param
  return 'week'
}

export function BookingsCalendarView() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const searchParams = useSearchParams()

  const [view, setView] = useState<View>(() => parseInitialView(searchParams.get('view')))
  const [date, setDate] = useState<Date>(() => parseInitialDate(searchParams.get('date')))

  const range = useMemo(() => computeRange(view, date), [view, date])

  const updateUrl = useCallback(
    (nextView: View, nextDate: Date) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('view', nextView)
      params.set('date', nextDate.toISOString().slice(0, 10))
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  const handleViewChange = useCallback(
    (nextView: View) => {
      setView(nextView)
      updateUrl(nextView, date)
    },
    [date, updateUrl],
  )

  const handleDateChange = useCallback(
    (nextDate: Date) => {
      setDate(nextDate)
      updateUrl(view, nextDate)
    },
    [view, updateUrl],
  )

  const {
    data: bookings = [],
    isLoading: bookingsLoading,
    error: bookingsError,
  } = useQuery({
    queryKey: ['bookings', 'calendar', view, range.from, range.to],
    queryFn: () => fetchAllCalendarBookings(range.from, range.to),
  })

  const { data: fleetOverviews = [] } = useQuery({
    queryKey: ['vehicles', 'fleet-overview'],
    queryFn: async () => {
      const result = await fetchFleetOverviewAction()
      if (!result.success) throw new Error(result.error)
      return result.data
    },
  })

  const resources: CalendarResource[] = useMemo(
    () => fleetOverviews.map((v) => ({ resourceId: v.id, resourceTitle: v.name })),
    [fleetOverviews],
  )

  const events = useMemo(() => toCalendarEvents(bookings), [bookings])

  if (bookingsLoading) {
    return (
      <div className="mt-6 space-y-2">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[600px] w-full" />
      </div>
    )
  }

  if (bookingsError) {
    return <p className="mt-6 text-sm text-destructive">Failed to load bookings</p>
  }

  return (
    <div className="mt-6">
      <BookingsCalendar
        events={events}
        resources={resources}
        defaultView={view}
        defaultDate={date}
        views={['day', 'week', 'month']}
        onViewChange={handleViewChange}
        onDateChange={handleDateChange}
        onBookingUpdate={() => {
          queryClient.invalidateQueries({
            queryKey: ['bookings', 'calendar'],
          })
        }}
      />
    </div>
  )
}
