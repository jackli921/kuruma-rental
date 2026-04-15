'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { endOfMonth, startOfMonth } from 'date-fns'
import { Calendar } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { BookingsCalendar, toCalendarEvents } from './BookingsCalendar'
import { fetchVehicleCalendarBookings } from './calendar-actions'

interface VehicleBookingCalendarProps {
  readonly vehicleId: string
}

export function VehicleBookingCalendar({ vehicleId }: VehicleBookingCalendarProps) {
  const t = useTranslations('business.bookings.calendar')
  const queryClient = useQueryClient()
  const [range] = useState(() => ({
    from: startOfMonth(new Date()).toISOString(),
    to: endOfMonth(new Date()).toISOString(),
  }))

  const {
    data: bookings = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['bookings', 'calendar', vehicleId, range.from, range.to],
    queryFn: () => fetchVehicleCalendarBookings(vehicleId, range.from, range.to),
  })

  const events = toCalendarEvents(bookings)

  return (
    <Card>
      <CardContent className="pt-4">
        <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
          <Calendar className="size-4" />
          {t('bookingCalendar')}
        </h2>

        {isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-[500px] w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Failed to load bookings</p>
        ) : (
          <BookingsCalendar
            events={events}
            defaultView="week"
            views={['week', 'month']}
            onBookingUpdate={() => {
              queryClient.invalidateQueries({
                queryKey: ['bookings', 'calendar', vehicleId],
              })
            }}
          />
        )}
      </CardContent>
    </Card>
  )
}
