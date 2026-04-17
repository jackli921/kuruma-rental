'use client'

import type { CalendarBooking } from '@/lib/calendar'
import { STATUS_CLASS } from '@/lib/event-colors'
import { localizer } from '@/lib/rbc-localizer'
import { endOfWeek, startOfWeek } from 'date-fns'
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

export interface SlotSelectInfo {
  start: Date
  end: Date
  // Present in day view where the calendar has vehicle resource columns.
  // The owner clicking column X means "book vehicle X at this time".
  resourceId?: string
}

interface BookingsCalendarProps {
  readonly events: CalendarEvent[]
  readonly resources?: CalendarResource[]
  readonly view: View
  readonly date: Date
  readonly onViewChange: (view: View) => void
  readonly onDateChange: (date: Date) => void
  readonly views?: View[]
  readonly onBookingUpdate?: (updated: CalendarBooking) => void
  readonly onSelectSlot?: (slotInfo: SlotSelectInfo) => void
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
  view,
  date,
  onViewChange,
  onDateChange,
  views = ['day', 'week', 'month'],
  onBookingUpdate,
  onSelectSlot,
}: BookingsCalendarProps) {
  const locale = useLocale()
  const t = useTranslations('business.bookings.calendar')
  const [selectedBooking, setSelectedBooking] = useState<CalendarBooking | null>(null)

  const handleSelectEvent = useCallback((event: CalendarEvent) => {
    setSelectedBooking(event.raw)
  }, [])

  const eventPropGetter = useCallback((event: CalendarEvent) => {
    return {
      className: STATUS_CLASS[event.raw.status] ?? '',
    }
  }, [])

  const culture = locale === 'zh' ? 'zh-CN' : locale

  const toolbarLabel = useMemo(() => {
    const fmt = (opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(culture, opts).format(date)

    if (view === 'month') return fmt({ year: 'numeric', month: 'long' })
    if (view === 'day') return fmt({ weekday: 'long', month: 'short', day: 'numeric' })

    // week: show range using Monday-start to match rbc's localizer
    const start = startOfWeek(date, { weekStartsOn: 1 })
    const end = endOfWeek(date, { weekStartsOn: 1 })
    const s = new Intl.DateTimeFormat(culture, { month: 'short', day: 'numeric' }).format(start)
    const e = new Intl.DateTimeFormat(culture, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(end)
    return `${s} - ${e}`
  }, [date, view, culture])

  const handleToolbarNavigate = useCallback(
    (action: 'PREV' | 'NEXT' | 'TODAY') => {
      if (action === 'TODAY') {
        onDateChange(new Date())
        return
      }
      const offset = action === 'PREV' ? -1 : 1
      const d = new Date(date)
      if (view === 'month') d.setMonth(d.getMonth() + offset)
      else if (view === 'week') d.setDate(d.getDate() + offset * 7)
      else d.setDate(d.getDate() + offset)
      onDateChange(d)
    },
    [view, date, onDateChange],
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

  const calendarStyle = useMemo(() => ({ height: view === 'month' ? 600 : 700 }), [view])

  const handleSlotSelect = useCallback(
    (slotInfo: { start: Date; end: Date; resourceId?: string | number | undefined }) => {
      if (!onSelectSlot) return
      const payload: SlotSelectInfo = { start: slotInfo.start, end: slotInfo.end }
      if (typeof slotInfo.resourceId === 'string') payload.resourceId = slotInfo.resourceId
      onSelectSlot(payload)
    },
    [onSelectSlot],
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
        view={view}
        onNavigate={handleToolbarNavigate}
        onView={onViewChange}
        views={views}
      />
      <Calendar
        localizer={localizer}
        culture={culture}
        events={events}
        resources={view === 'day' ? resources : undefined}
        resourceIdAccessor="resourceId"
        resourceTitleAccessor="resourceTitle"
        view={view}
        date={date}
        onView={onViewChange}
        onNavigate={onDateChange}
        onSelectEvent={handleSelectEvent}
        selectable={onSelectSlot ? true : undefined}
        onSelectSlot={onSelectSlot ? handleSlotSelect : undefined}
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
