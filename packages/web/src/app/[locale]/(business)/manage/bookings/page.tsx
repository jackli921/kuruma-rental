import { fetchCalendarBookings } from '@/lib/calendar'
import { fetchVehicles } from '@/lib/vehicle-api'
import { addDays, startOfWeek } from 'date-fns'
import { getTranslations } from 'next-intl/server'
import { BookingsCalendarView } from './BookingsCalendarView'

interface ManageBookingsPageProps {
  searchParams: Promise<{ week?: string }>
}

export default async function ManageBookingsPage({ searchParams }: ManageBookingsPageProps) {
  const [t, params] = await Promise.all([getTranslations('business.bookings'), searchParams])

  const parsedDate = params.week ? new Date(params.week) : null
  const baseDate = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : new Date()
  const weekStart = startOfWeek(baseDate, { weekStartsOn: 1 })
  const weekEnd = addDays(weekStart, 7)

  const [vehicles, bookings] = await Promise.all([
    fetchVehicles(),
    fetchCalendarBookings(weekStart.toISOString(), weekEnd.toISOString()),
  ])

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <h1 className="text-3xl font-semibold tracking-tight">{t('title')}</h1>
      <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
      <div className="mt-6">
        <BookingsCalendarView
          weekStartIso={weekStart.toISOString()}
          vehicles={vehicles}
          bookings={bookings}
        />
      </div>
    </div>
  )
}
