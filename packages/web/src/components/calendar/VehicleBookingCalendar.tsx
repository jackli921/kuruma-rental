'use client'

import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { CalendarBooking } from '@/lib/calendar'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { startOfWeek } from 'date-fns'
import { Calendar } from 'lucide-react'
import { useState } from 'react'
import { BookingDetailDialog } from './BookingDetailDialog'
import { CalendarMonthView } from './CalendarMonthView'
import { CalendarNavigation } from './CalendarNavigation'
import { CalendarWeekView } from './CalendarWeekView'
import { fetchVehicleCalendarBookings } from './calendar-actions'
import { SOURCE_COLORS, SOURCE_LABELS, getMonthRange, getWeekRange } from './calendar-utils'

interface VehicleBookingCalendarProps {
  readonly vehicleId: string
}

export function VehicleBookingCalendar({ vehicleId }: VehicleBookingCalendarProps) {
  const queryClient = useQueryClient()
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week')
  const [selectedBooking, setSelectedBooking] = useState<CalendarBooking | null>(null)

  const { from, to } = viewMode === 'week' ? getWeekRange(currentDate) : getMonthRange(currentDate)

  const {
    data: bookings = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ['bookings', 'calendar', vehicleId, from, to],
    queryFn: () => fetchVehicleCalendarBookings(vehicleId, from, to),
  })

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })

  return (
    <Card>
      <CardContent className="pt-4">
        <h2 className="text-lg font-medium mb-4 flex items-center gap-2">
          <Calendar className="size-4" />
          Booking Calendar
        </h2>

        <div className="space-y-4">
          <CalendarNavigation
            currentDate={currentDate}
            viewMode={viewMode}
            onDateChange={setCurrentDate}
            onViewModeChange={setViewMode}
          />

          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-[400px] w-full" />
            </div>
          ) : error ? (
            <Card>
              <CardContent className="pt-4">
                <p className="text-sm text-destructive">Failed to load bookings</p>
              </CardContent>
            </Card>
          ) : viewMode === 'week' ? (
            <CalendarWeekView
              bookings={bookings}
              weekStart={weekStart}
              onBookingClick={setSelectedBooking}
            />
          ) : (
            <CalendarMonthView
              bookings={bookings}
              month={currentDate.getMonth()}
              year={currentDate.getFullYear()}
              onBookingClick={setSelectedBooking}
            />
          )}

          {/* Source legend */}
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground pt-2">
            {Object.entries(SOURCE_COLORS).map(([source, colors]) => (
              <div key={source} className="flex items-center gap-1.5">
                <span className={`inline-block size-3 rounded-sm ${colors.bg}`} />
                <span>{SOURCE_LABELS[source] ?? source}</span>
              </div>
            ))}
          </div>
        </div>

        <BookingDetailDialog
          booking={selectedBooking}
          onClose={() => setSelectedBooking(null)}
          onBookingUpdate={() => {
            setSelectedBooking(null)
            queryClient.invalidateQueries({ queryKey: ['bookings', 'calendar', vehicleId] })
          }}
        />
      </CardContent>
    </Card>
  )
}
