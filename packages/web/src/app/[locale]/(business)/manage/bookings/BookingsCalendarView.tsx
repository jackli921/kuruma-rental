'use client'

import { BookingsCalendar, toCalendarEvents } from '@/components/calendar/BookingsCalendar'
import { ManualBookingDialog } from '@/components/calendar/ManualBookingDialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { fetchFleetOverviewAction } from '@/lib/vehicle-actions'
import type { FleetVehicleOverviewData } from '@/lib/vehicle-api'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { endOfMonth, startOfMonth } from 'date-fns'
import { useTranslations } from 'next-intl'
import { useCallback, useEffect, useState } from 'react'
import { fetchAllCalendarBookings } from './booking-actions'

export function BookingsCalendarView() {
  const t = useTranslations('business.bookings')
  const queryClient = useQueryClient()
  const [range, _setRange] = useState(() => ({
    from: startOfMonth(new Date()).toISOString(),
    to: endOfMonth(new Date()).toISOString(),
  }))
  const [showManualBooking, setShowManualBooking] = useState(false)
  const [vehicles, setVehicles] = useState<FleetVehicleOverviewData[]>([])

  useEffect(() => {
    fetchFleetOverviewAction().then((result) => {
      if (result.success) setVehicles(result.data)
    })
  }, [])

  const {
    data: bookings = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['bookings', 'calendar', range.from, range.to],
    queryFn: () => fetchAllCalendarBookings(range.from, range.to),
  })

  const events = toCalendarEvents(bookings)

  const handleInvalidate = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: ['bookings', 'calendar'],
    })
  }, [queryClient])

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
      <div className="flex justify-end mb-4">
        <Button onClick={() => setShowManualBooking(true)}>{t('newBooking')}</Button>
      </div>
      <BookingsCalendar
        events={events}
        defaultView="week"
        views={['week', 'month']}
        onBookingUpdate={handleInvalidate}
      />
      <ManualBookingDialog
        open={showManualBooking}
        onClose={() => setShowManualBooking(false)}
        onBookingCreated={handleInvalidate}
        vehicles={vehicles}
      />
    </div>
  )
}
