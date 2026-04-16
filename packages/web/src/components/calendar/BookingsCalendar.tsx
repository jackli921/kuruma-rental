'use client'

import type { CalendarBooking } from '@/lib/calendar'
import { STATUS_CLASS } from '@/lib/event-colors'
import { localizer } from '@/lib/rbc-localizer'
import { useLocale, useTranslations } from 'next-intl'
import { useCallback, useMemo, useState } from 'react'
import { Calendar, type View } from 'react-big-calendar'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import { BookingDetailDialog } from './BookingDetailDialog'
import { CalendarToolbar } from './CalendarToolbar'
import './calendar-theme.css'

export interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  raw: CalendarBooking
}

interface BookingsCalendarProps {
  readonly events: CalendarEvent[]
  readonly defaultView?: View
  readonly views?: View[]
  readonly onBookingUpdate?: (updated: CalendarBooking) => void
}

export function toCalendarEvents(bookings: CalendarBooking[]): CalendarEvent[] {
  return bookings.map((b) => ({
    id: b.id,
    title: b.renterName ?? b.renterEmail ?? b.source,
    start: new Date(b.startAt),
    end: new Date(b.effectiveEndAt),
    raw: b,
  }))
}

export function BookingsCalendar({
  events,
  defaultView = 'week',
  views = ['week', 'month'],
  onBookingUpdate,
}: BookingsCalendarProps) {
  const locale = useLocale()
  const t = useTranslations('business.bookings.calendar')
  const [currentView, setCurrentView] = useState<View>(defaultView)
  const [currentDate, setCurrentDate] = useState(() => new Date())
  const [selectedBooking, setSelectedBooking] = useState<CalendarBooking | null>(null)

  const handleSelectEvent = useCallback((event: CalendarEvent) => {
    setSelectedBooking(event.raw)
  }, [])

  const handleNavigate = useCallback((date: Date) => {
    setCurrentDate(date)
  }, [])

  const eventPropGetter = useCallback((event: CalendarEvent) => {
    return {
      className: STATUS_CLASS[event.raw.status] ?? '',
    }
  }, [])

  const culture = locale === 'zh' ? 'zh-CN' : locale

  const toolbarLabel = useMemo(() => {
    const fmt = (opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(culture, opts).format(currentDate)

    if (currentView === 'month') return fmt({ year: 'numeric', month: 'long' })
    if (currentView === 'day') return fmt({ weekday: 'long', month: 'short', day: 'numeric' })

    // week: show range "Apr 13 - 19, 2026"
    const start = new Date(currentDate)
    start.setDate(start.getDate() - start.getDay())
    const end = new Date(start)
    end.setDate(end.getDate() + 6)
    const s = new Intl.DateTimeFormat(culture, { month: 'short', day: 'numeric' }).format(start)
    const e = new Intl.DateTimeFormat(culture, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(end)
    return `${s} - ${e}`
  }, [currentDate, currentView, culture])

  return (
    <div>
      <CalendarToolbar
        label={toolbarLabel}
        view={currentView}
        onNavigate={(action) => {
          const offset = action === 'PREV' ? -1 : action === 'NEXT' ? 1 : 0
          if (action === 'TODAY') {
            setCurrentDate(new Date())
          } else {
            const d = new Date(currentDate)
            if (currentView === 'month') {
              d.setMonth(d.getMonth() + offset)
            } else if (currentView === 'week') {
              d.setDate(d.getDate() + offset * 7)
            } else {
              d.setDate(d.getDate() + offset)
            }
            setCurrentDate(d)
          }
        }}
        onView={setCurrentView}
        views={views}
      />
      <Calendar
        localizer={localizer}
        culture={culture}
        events={events}
        view={currentView}
        date={currentDate}
        onView={setCurrentView}
        onNavigate={handleNavigate}
        onSelectEvent={handleSelectEvent}
        eventPropGetter={eventPropGetter}
        views={views}
        step={60}
        timeslots={1}
        scrollToTime={new Date(1970, 0, 1, 8, 0, 0)}
        style={{ height: currentView === 'month' ? 600 : 700 }}
        messages={{
          today: t('today'),
          previous: t('previous'),
          next: t('next'),
          day: t('views.day'),
          week: t('views.week'),
          month: t('views.month'),
          noEventsInRange: t('noEventsInRange'),
          showMore: (total: number) => t('showMore', { count: total }),
        }}
        components={{
          toolbar: () => null,
        }}
        popup
      />

      <BookingDetailDialog
        booking={selectedBooking}
        onClose={() => setSelectedBooking(null)}
        onBookingUpdate={(updated) => {
          setSelectedBooking(null)
          onBookingUpdate?.(updated)
        }}
      />
    </div>
  )
}
