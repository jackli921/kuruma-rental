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
  resourceId: string
  raw: CalendarBooking
}

export interface CalendarResource {
  resourceId: string
  resourceTitle: string
}

interface BookingsCalendarProps {
  readonly events: CalendarEvent[]
  readonly resources?: CalendarResource[]
  readonly defaultView?: View
  readonly defaultDate?: Date
  readonly views?: View[]
  readonly onBookingUpdate?: (updated: CalendarBooking) => void
  readonly onViewChange?: (view: View) => void
  readonly onDateChange?: (date: Date) => void
}

export function toCalendarEvents(bookings: CalendarBooking[]): CalendarEvent[] {
  return bookings.map((b) => ({
    id: b.id,
    title: b.renterName ?? b.renterEmail ?? b.source,
    start: new Date(b.startAt),
    end: new Date(b.effectiveEndAt),
    resourceId: b.vehicleId,
    raw: b,
  }))
}

const SCROLL_TO_TIME = new Date(1970, 0, 1, 8, 0, 0)
const CALENDAR_COMPONENTS = { toolbar: () => null } as const

export function BookingsCalendar({
  events,
  resources,
  defaultView = 'week',
  defaultDate,
  views = ['day', 'week', 'month'],
  onBookingUpdate,
  onViewChange,
  onDateChange,
}: BookingsCalendarProps) {
  const locale = useLocale()
  const t = useTranslations('business.bookings.calendar')
  const [currentView, setCurrentView] = useState<View>(defaultView)
  const [currentDate, setCurrentDate] = useState(() => defaultDate ?? new Date())
  const [selectedBooking, setSelectedBooking] = useState<CalendarBooking | null>(null)

  const handleSelectEvent = useCallback((event: CalendarEvent) => {
    setSelectedBooking(event.raw)
  }, [])

  const handleViewChange = useCallback(
    (view: View) => {
      setCurrentView(view)
      onViewChange?.(view)
    },
    [onViewChange],
  )

  const handleNavigate = useCallback(
    (date: Date) => {
      setCurrentDate(date)
      onDateChange?.(date)
    },
    [onDateChange],
  )

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

  const handleToolbarNavigate = useCallback(
    (action: 'PREV' | 'NEXT' | 'TODAY') => {
      if (action === 'TODAY') {
        handleNavigate(new Date())
        return
      }
      const offset = action === 'PREV' ? -1 : 1
      const d = new Date(currentDate)
      if (currentView === 'month') d.setMonth(d.getMonth() + offset)
      else if (currentView === 'week') d.setDate(d.getDate() + offset * 7)
      else d.setDate(d.getDate() + offset)
      handleNavigate(d)
    },
    [currentView, currentDate, handleNavigate],
  )

  const messages = useMemo(
    () => ({
      today: t('today'),
      previous: t('previous'),
      next: t('next'),
      day: t('views.day'),
      week: t('views.week'),
      month: t('views.month'),
      noEventsInRange: t('noEventsInRange'),
      showMore: (total: number) => t('showMore', { count: total }),
    }),
    [t],
  )

  const calendarStyle = useMemo(
    () => ({ height: currentView === 'month' ? 600 : 700 }),
    [currentView],
  )

  const handleClose = useCallback(() => setSelectedBooking(null), [])

  const handleBookingUpdate = useCallback(
    (updated: CalendarBooking) => {
      setSelectedBooking(null)
      onBookingUpdate?.(updated)
    },
    [onBookingUpdate],
  )

  return (
    <div>
      <CalendarToolbar
        label={toolbarLabel}
        view={currentView}
        onNavigate={handleToolbarNavigate}
        onView={handleViewChange}
        views={views}
      />
      <Calendar
        localizer={localizer}
        culture={culture}
        events={events}
        resources={currentView === 'day' ? resources : undefined}
        resourceIdAccessor="resourceId"
        resourceTitleAccessor="resourceTitle"
        view={currentView}
        date={currentDate}
        onView={handleViewChange}
        onNavigate={handleNavigate}
        onSelectEvent={handleSelectEvent}
        eventPropGetter={eventPropGetter}
        views={views}
        step={60}
        timeslots={1}
        scrollToTime={SCROLL_TO_TIME}
        style={calendarStyle}
        messages={messages}
        components={CALENDAR_COMPONENTS}
        popup
      />

      <BookingDetailDialog
        booking={selectedBooking}
        onClose={handleClose}
        onBookingUpdate={handleBookingUpdate}
      />
    </div>
  )
}
