'use client'

import type { CalendarBooking } from '@/lib/calendar'
import { cn } from '@/lib/utils'
import { addDays, format, isToday, startOfWeek } from 'date-fns'
import { useMemo } from 'react'
import { BookingBlock } from './BookingBlock'
import {
  PIXELS_PER_HOUR,
  bookingToWeekPosition,
  getHourSlots,
  splitMultiDayBooking,
} from './calendar-utils'

interface CalendarWeekViewProps {
  readonly bookings: readonly CalendarBooking[]
  readonly weekStart: Date
  readonly onBookingClick: (booking: CalendarBooking) => void
}

function getDayColumns(weekStart: Date): Date[] {
  const monday = startOfWeek(weekStart, { weekStartsOn: 1 })
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

const HOUR_SLOTS = getHourSlots()

interface PositionedBooking {
  booking: CalendarBooking
  top: number
  height: number
}

export function CalendarWeekView({ bookings, weekStart, onBookingClick }: CalendarWeekViewProps) {
  const days = useMemo(() => getDayColumns(weekStart), [weekStart])

  const rangeStart = days[0]!
  const rangeEnd = addDays(days[6]!, 1)

  const bookingsByDay = useMemo(() => {
    const map = new Map<number, PositionedBooking[]>()

    for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
      map.set(dayIdx, [])
    }

    for (const booking of bookings) {
      const segments = splitMultiDayBooking(booking, rangeStart, rangeEnd)
      for (const segment of segments) {
        const dayIdx = days.findIndex((d) => d.toDateString() === segment.date.toDateString())
        if (dayIdx < 0) continue

        const day = days[dayIdx]!
        const { top, height } = bookingToWeekPosition(booking.startAt, booking.endAt, day)
        if (height <= 0) continue

        map.set(dayIdx, [...(map.get(dayIdx) ?? []), { booking, top, height }])
      }
    }

    return map
  }, [bookings, days, rangeStart, rangeEnd])

  const totalHeight = 24 * PIXELS_PER_HOUR

  // Current time indicator
  const now = new Date()
  const isCurrentWeek = days.some((d) => isToday(d))
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const nowTop = (nowMinutes / 60) * PIXELS_PER_HOUR

  return (
    <div className="overflow-x-auto rounded-lg border">
      <div className="min-w-[700px]">
        {/* Day header */}
        <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b">
          <div className="p-2" />
          {days.map((day) => (
            <div
              key={day.toISOString()}
              className={cn(
                'p-2 text-center text-xs font-medium border-l',
                isToday(day) && 'bg-primary/10',
              )}
            >
              <div className="text-muted-foreground">{format(day, 'EEE')}</div>
              <div className={cn('text-sm', isToday(day) && 'text-primary font-semibold')}>
                {format(day, 'd')}
              </div>
            </div>
          ))}
        </div>

        <div className="overflow-y-auto max-h-[600px]">
          <div className="grid grid-cols-[60px_repeat(7,1fr)]" style={{ height: totalHeight }}>
            {/* Hour labels */}
            <div className="relative">
              {HOUR_SLOTS.map((hour, idx) => (
                <div
                  key={hour}
                  className="absolute right-2 text-[10px] text-muted-foreground -translate-y-1/2"
                  style={{ top: idx * PIXELS_PER_HOUR }}
                >
                  {hour}
                </div>
              ))}
            </div>

            {/* Day columns */}
            {days.map((day, dayIdx) => (
              <div key={day.toISOString()} className="relative border-l">
                {/* Hour grid lines */}
                {HOUR_SLOTS.map((hour, hourIdx) => (
                  <div
                    key={hour}
                    className="absolute inset-x-0 border-t border-border/50"
                    style={{ top: hourIdx * PIXELS_PER_HOUR }}
                  />
                ))}

                {/* Now line */}
                {isCurrentWeek && isToday(day) && (
                  <div
                    className="absolute inset-x-0 z-10 border-t-2 border-destructive"
                    style={{ top: nowTop }}
                  />
                )}

                {/* Booking blocks */}
                {bookingsByDay.get(dayIdx)?.map(({ booking, top, height }) => (
                  <div
                    key={`${booking.id}-${dayIdx}`}
                    className="absolute inset-x-0 px-0.5"
                    style={{ top, height }}
                  >
                    <BookingBlock
                      booking={booking}
                      variant="bar"
                      onClick={() => onBookingClick(booking)}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
