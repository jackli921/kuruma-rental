import { STATUS_CLASS } from '@/lib/event-colors'
import { localizer } from '@/lib/rbc-localizer'
import { CalendarToolbar } from '@/vite/operator-bookings/CalendarToolbar'
import type {
  CalendarEvent,
  CalendarResource,
  CalendarView,
} from '@/vite/operator-bookings/calendar-events'
import { endOfWeek, startOfWeek } from 'date-fns'
import { useCallback, useMemo } from 'react'
import { Calendar } from 'react-big-calendar'
import { useTranslations } from 'use-intl'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import './calendar-theme.css'

const VIEWS: CalendarView[] = ['day', 'week', 'month']
const SCROLL_TO_TIME = new Date(1970, 0, 1, 8, 0, 0)
// rbc's built-in toolbar is suppressed — we render CalendarToolbar ourselves so
// navigation drives the URL (search params) rather than rbc's internal state.
const CALENDAR_COMPONENTS = { toolbar: () => null } as const

interface BookingsCalendarProps {
  readonly events: readonly CalendarEvent[]
  // Vehicle columns shown in day view; ignored by week/month.
  readonly resources: readonly CalendarResource[]
  readonly view: CalendarView
  readonly date: Date
  readonly locale: string
  readonly onViewChange: (view: CalendarView) => void
  readonly onDateChange: (date: Date) => void
  // Slice D wires this to the existing trip-detail page; Slice B just surfaces the
  // clicked booking id. (Slot-selection / manual booking is the deferred Slice E.)
  readonly onSelectEvent: (bookingId: string) => void
}

// Presentational calendar over the operator's bookings. State (view/date) is owned
// by the route via the URL, so this stays a pure function of its props — no fetch,
// no embedded dialog (FC/IS: the shell does I/O, this renders).
export function BookingsCalendar({
  events,
  resources,
  view,
  date,
  locale,
  onViewChange,
  onDateChange,
  onSelectEvent,
}: BookingsCalendarProps) {
  const t = useTranslations('business.bookings.calendar')
  const culture = locale === 'zh' ? 'zh-CN' : locale

  const toolbarLabel = useMemo(() => {
    const fmt = (opts: Intl.DateTimeFormatOptions) =>
      new Intl.DateTimeFormat(culture, opts).format(date)

    if (view === 'month') return fmt({ year: 'numeric', month: 'long' })
    if (view === 'day') return fmt({ weekday: 'long', month: 'short', day: 'numeric' })

    // week: Monday-start range, matching rbc's localizer.
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

  const handleSelectEvent = useCallback(
    (event: CalendarEvent) => onSelectEvent(event.id),
    [onSelectEvent],
  )

  const eventPropGetter = useCallback(
    (event: CalendarEvent) => ({ className: STATUS_CLASS[event.status] ?? '' }),
    [],
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

  return (
    <div>
      <CalendarToolbar
        label={toolbarLabel}
        view={view}
        onNavigate={handleToolbarNavigate}
        onView={onViewChange}
        views={VIEWS}
      />
      <Calendar
        localizer={localizer}
        culture={culture}
        events={[...events]}
        resources={view === 'day' ? [...resources] : undefined}
        resourceIdAccessor="resourceId"
        resourceTitleAccessor="resourceTitle"
        view={view}
        date={date}
        onView={(v) => onViewChange(v as CalendarView)}
        onNavigate={onDateChange}
        onSelectEvent={handleSelectEvent}
        eventPropGetter={eventPropGetter}
        views={VIEWS}
        step={60}
        timeslots={1}
        scrollToTime={SCROLL_TO_TIME}
        style={calendarStyle}
        messages={messages}
        components={CALENDAR_COMPONENTS}
        popup
      />
    </div>
  )
}
