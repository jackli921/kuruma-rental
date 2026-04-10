'use client'

import { CalendarHeader } from '@/components/calendar/CalendarHeader'
import { WeeklyTimeline } from '@/components/calendar/WeeklyTimeline'
import { usePathname, useRouter } from '@/i18n/routing'
import type { CalendarBooking } from '@/lib/calendar'
import type { VehicleData } from '@/lib/vehicle-api'
import { format, startOfWeek } from 'date-fns'

interface BookingsCalendarViewProps {
  readonly weekStartIso: string
  readonly vehicles: VehicleData[]
  readonly bookings: CalendarBooking[]
}

export function BookingsCalendarView({
  weekStartIso,
  vehicles,
  bookings,
}: BookingsCalendarViewProps) {
  const router = useRouter()
  const pathname = usePathname()
  const weekStart = new Date(weekStartIso)

  const handleWeekChange = (newStart: Date) => {
    const normalized = startOfWeek(newStart, { weekStartsOn: 1 })
    router.push(`${pathname}?week=${format(normalized, 'yyyy-MM-dd')}`)
  }

  return (
    <div className="space-y-4">
      <CalendarHeader weekStart={weekStart} onWeekChange={handleWeekChange} />
      <WeeklyTimeline weekStart={weekStart} vehicles={vehicles} bookings={bookings} />
    </div>
  )
}
