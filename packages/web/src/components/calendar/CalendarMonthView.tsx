'use client'

import type { CalendarBooking } from '@/lib/calendar'
import { cn } from '@/lib/utils'
import {
  eachDayOfInterval,
  endOfMonth,
  format,
  getDay,
  isSameMonth,
  isToday,
  startOfMonth,
} from 'date-fns'
import { useMemo } from 'react'
import { BookingBlock } from './BookingBlock'

interface CalendarMonthViewProps {
  readonly bookings: readonly CalendarBooking[]
  readonly month: number
  readonly year: number
  readonly onBookingClick: (booking: CalendarBooking) => void
}

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const
const MAX_VISIBLE_CHIPS = 3

function getMonthDays(year: number, month: number): Date[] {
  const monthStart = startOfMonth(new Date(year, month))
  const monthEnd = endOfMonth(monthStart)
  return eachDayOfInterval({ start: monthStart, end: monthEnd })
}

function getLeadingBlanks(year: number, month: number): number {
  const firstDay = getDay(startOfMonth(new Date(year, month)))
  // Convert Sunday=0 to Monday-start: Mon=0, Tue=1, ... Sun=6
  return firstDay === 0 ? 6 : firstDay - 1
}

function groupBookingsByDate(bookings: readonly CalendarBooking[]): Map<string, CalendarBooking[]> {
  const map = new Map<string, CalendarBooking[]>()

  for (const booking of bookings) {
    const start = new Date(booking.startAt)
    const end = new Date(booking.endAt)

    // Add booking to every day it spans
    let current = new Date(start.getFullYear(), start.getMonth(), start.getDate())
    const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())

    while (current <= endDay) {
      const key = format(current, 'yyyy-MM-dd')
      map.set(key, [...(map.get(key) ?? []), booking])
      current = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1)
    }
  }

  return map
}

export function CalendarMonthView({
  bookings,
  month,
  year,
  onBookingClick,
}: CalendarMonthViewProps) {
  const days = useMemo(() => getMonthDays(year, month), [year, month])
  const leadingBlanks = useMemo(() => getLeadingBlanks(year, month), [year, month])
  const bookingsByDate = useMemo(() => groupBookingsByDate(bookings), [bookings])

  const referenceDate = new Date(year, month, 1)

  return (
    <section className="overflow-x-auto rounded-lg border" aria-label="Month calendar">
      <div className="min-w-[500px]">
        {/* Day headers */}
        <div className="grid grid-cols-7 border-b">
          {DAY_HEADERS.map((day) => (
            <div key={day} className="p-2 text-center text-xs font-medium text-muted-foreground">
              {day}
            </div>
          ))}
        </div>

        {/* Day cells */}
        <div className="grid grid-cols-7">
          {/* Leading blank cells (static count per month, never reorder) */}
          {Array.from({ length: leadingBlanks }, (_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: blank spacer cells have no stable ID
              key={`blank-${i}`}
              className="min-h-[60px] sm:min-h-[80px] border-b border-r p-1.5 opacity-40"
            />
          ))}

          {/* Actual days */}
          {days.map((day) => {
            const key = format(day, 'yyyy-MM-dd')
            const dayBookings = bookingsByDate.get(key) ?? []
            const overflowCount = dayBookings.length - MAX_VISIBLE_CHIPS
            const inMonth = isSameMonth(day, referenceDate)

            return (
              <div
                key={key}
                className={cn(
                  'min-h-[60px] sm:min-h-[80px] border-b border-r p-1.5',
                  !inMonth && 'opacity-40',
                  isToday(day) && 'bg-primary/10',
                )}
              >
                <div className={cn('mb-1 text-xs', isToday(day) && 'font-semibold text-primary')}>
                  {format(day, 'd')}
                </div>
                <div className="flex flex-col gap-0.5">
                  {dayBookings.slice(0, MAX_VISIBLE_CHIPS).map((booking) => (
                    <BookingBlock
                      key={booking.id}
                      booking={booking}
                      variant="chip"
                      onClick={() => onBookingClick(booking)}
                    />
                  ))}
                  {overflowCount > 0 && (
                    <span className="text-[10px] text-muted-foreground pl-1.5">
                      +{overflowCount} more
                    </span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
