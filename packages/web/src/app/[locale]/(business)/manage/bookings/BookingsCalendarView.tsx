'use client'

import {
  BookingsCalendar,
  type CalendarResource,
  type SlotSelectInfo,
  toCalendarEvents,
} from '@/components/calendar/BookingsCalendar'
import { CalendarSidebar } from '@/components/calendar/CalendarSidebar'
import { ManualBookingDialog } from '@/components/calendar/ManualBookingDialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCalendarFilters } from '@/hooks/useCalendarFilters'
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
import { useTranslations } from 'next-intl'
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

// Format a Date for <input type="datetime-local"> — needs local-time wall clock,
// not a UTC ISO string (which would shift by the browser's timezone offset).
function toLocalDatetime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function BookingsCalendarView() {
  const t = useTranslations('business.bookings')
  const queryClient = useQueryClient()
  const router = useRouter()
  const searchParams = useSearchParams()

  // Derive state directly from the URL — single source of truth.
  const view = parseViewParam(searchParams.get('view'))
  const date = useMemo(() => parseDateParam(searchParams.get('date')), [searchParams])
  const range = useMemo(() => computeRange(view, date), [view, date])

  const [showManualBooking, setShowManualBooking] = useState(false)
  const [slotDefaults, setSlotDefaults] = useState<{
    startAt?: string
    vehicleId?: string
  }>({})

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

  const activeVehicles = useMemo(
    () => fleetOverviews.filter((v) => v.status !== 'RETIRED'),
    [fleetOverviews],
  )

  const resources: CalendarResource[] = useMemo(
    () => activeVehicles.map((v) => ({ resourceId: v.id, resourceTitle: v.name })),
    [activeVehicles],
  )

  const knownVehicleIds = useMemo(() => activeVehicles.map((v) => v.id), [activeVehicles])
  const filters = useCalendarFilters(knownVehicleIds)

  const allEvents = useMemo(() => toCalendarEvents(bookings), [bookings])
  const events = useMemo(() => filters.filterEvents(allEvents), [allEvents, filters])
  const visibleResources = useMemo(() => filters.filterResources(resources), [resources, filters])

  const sidebarVehicles = useMemo(
    () => activeVehicles.map((v) => ({ id: v.id, name: v.name })),
    [activeVehicles],
  )

  const handleInvalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['bookings', 'calendar'] })
  }, [queryClient])

  const handleSelectSlot = useCallback((slotInfo: SlotSelectInfo) => {
    const next: { startAt?: string; vehicleId?: string } = {
      startAt: toLocalDatetime(slotInfo.start),
    }
    if (slotInfo.resourceId) next.vehicleId = slotInfo.resourceId
    setSlotDefaults(next)
    setShowManualBooking(true)
  }, [])

  const handleOpenDialog = useCallback(() => {
    setSlotDefaults({})
    setShowManualBooking(true)
  }, [])

  const handleCloseDialog = useCallback(() => {
    setShowManualBooking(false)
    setSlotDefaults({})
  }, [])

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
    <div className="mt-6 flex gap-4">
      <CalendarSidebar vehicles={sidebarVehicles} filters={filters} />
      <div className="flex-1 min-w-0">
        <div className="flex justify-end mb-4">
          <Button onClick={handleOpenDialog}>{t('newBooking')}</Button>
        </div>
        <BookingsCalendar
          events={events}
          resources={visibleResources}
          view={view}
          date={date}
          views={['day', 'week', 'month']}
          onViewChange={handleViewChange}
          onDateChange={handleDateChange}
          onBookingUpdate={handleInvalidate}
          onSelectSlot={handleSelectSlot}
        />
        <ManualBookingDialog
          open={showManualBooking}
          onClose={handleCloseDialog}
          onBookingCreated={handleInvalidate}
          vehicles={fleetOverviews}
          defaultStartAt={slotDefaults.startAt}
          defaultVehicleId={slotDefaults.vehicleId}
        />
      </div>
    </div>
  )
}
