'use client'

import {
  BookingsCalendar,
  type CalendarResource,
  toCalendarEvents,
} from '@/components/calendar/BookingsCalendar'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchFleetOverviewAction } from '@/lib/vehicle-actions'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  parse,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import { useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useMemo } from 'react'
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

// Parse YYYY-MM-DD as a local date (not UTC) to avoid timezone drift
// where 2026-04-16 in JST serializes and parses back to a different day.
function parseDateParam(param: string | null): Date {
  if (!param) return new Date()
  const parsed = parse(param, 'yyyy-MM-dd', new Date())
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

function parseViewParam(param: string | null): View {
  if (param === 'day' || param === 'week' || param === 'month') return param
  return 'week'
}

export function BookingsCalendarView() {
  const queryClient = useQueryClient()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Derive state directly from the URL — single source of truth.
  // Back/forward buttons update searchParams, which triggers re-render
  // with the correct view/date automatically.
  const view = parseViewParam(searchParams.get('view'))
  const date = useMemo(() => parseDateParam(searchParams.get('date')), [searchParams])

  const range = useMemo(() => computeRange(view, date), [view, date])

  const updateUrl = useCallback(
    (nextView: View, nextDate: Date) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set('view', nextView)
      params.set('date', format(nextDate, 'yyyy-MM-dd'))
      router.replace(`?${params.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  const handleViewChange = useCallback(
    (nextView: View) => updateUrl(nextView, date),
    [date, updateUrl],
  )

  const handleDateChange = useCallback(
    (nextDate: Date) => updateUrl(view, nextDate),
    [view, updateUrl],
  )

  const {
    data: bookings = [],
    isPending: bookingsInitialLoading,
    error: bookingsError,
  } = useQuery({
    queryKey: ['bookings', 'calendar', range.from, range.to],
    queryFn: () => fetchAllCalendarBookings(range.from, range.to),
    placeholderData: keepPreviousData,
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
    () =>
      fleetOverviews
        .filter((v) => v.status !== 'RETIRED')
        .map((v) => ({ resourceId: v.id, resourceTitle: v.name })),
    [fleetOverviews],
  )

  const events = useMemo(() => toCalendarEvents(bookings), [bookings])

  if (bookingsInitialLoading) {
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
        view={view}
        date={date}
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
