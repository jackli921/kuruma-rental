'use client'

import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { endOfMonth, startOfMonth } from 'date-fns'
import { Calendar, ChevronDown, ChevronRight } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import type { View } from 'react-big-calendar'
import { BookingsCalendar, toCalendarEvents } from './BookingsCalendar'
import { fetchVehicleCalendarBookings } from './calendar-actions'

interface VehicleBookingCalendarProps {
  readonly vehicleId: string
}

export function VehicleBookingCalendar({ vehicleId }: VehicleBookingCalendarProps) {
  const t = useTranslations('business.bookings.calendar')
  const queryClient = useQueryClient()
  const [expanded, setExpanded] = useState(true)
  const [view, setView] = useState<View>('week')
  const [date, setDate] = useState(() => new Date())
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
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 px-0 text-lg font-medium hover:bg-transparent"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          <Calendar className="size-4" />
          {t('bookingCalendar')}
        </Button>

        {!expanded ? null : isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-[500px] w-full" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive">Failed to load bookings</p>
        ) : (
          <BookingsCalendar
            events={events}
            view={view}
            date={date}
            onViewChange={setView}
            onDateChange={setDate}
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
