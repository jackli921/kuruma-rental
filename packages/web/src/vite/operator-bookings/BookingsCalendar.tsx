import { instantToJstFauxLocal, jstWallClockToInstant, todayInJst } from '@/lib/datetime'
import { localizer } from '@/lib/rbc-localizer'
import { isCalendarQuickViewEnabled, useFeatureFlag } from '@/vite/config'
import { CalendarEventChip } from '@/vite/operator-bookings/CalendarEventChip'
import { CalendarToolbar } from '@/vite/operator-bookings/CalendarToolbar'
import {
  type CalendarItem,
  type CalendarResource,
  type CalendarView,
  calendarItemClassName,
  operatorViews,
} from '@/vite/operator-bookings/calendar-events'
import { endOfWeek, startOfWeek } from 'date-fns'
import { useCallback, useMemo } from 'react'
import { Calendar, type EventProps, type SlotInfo, type View } from 'react-big-calendar'
import { useTranslations } from 'use-intl'
import 'react-big-calendar/lib/css/react-big-calendar.css'
import './calendar-theme.css'

// rbc's own views are a strict subset of our operator views (timeline is a separate
// component, not an rbc view) — typed as rbc's `View` so the Calendar prop checks.
const RBC_VIEWS: View[] = ['day', 'week', 'month']
const SCROLL_TO_TIME = new Date(1970, 0, 1, 8, 0, 0)

interface BookingsCalendarProps {
  // #1101: bookings AND scheduled blocks, on one vehicle axis (the discriminated union).
  readonly events: readonly CalendarItem[]
  // Vehicle columns shown in day view; ignored by week/month.
  readonly resources: readonly CalendarResource[]
  readonly view: CalendarView
  readonly date: Date
  readonly locale: string
  readonly onViewChange: (view: CalendarView) => void
  readonly onDateChange: (date: Date) => void
  // #1101: the clicked item (not a bare id) so the parent dispatches by `type` —
  // a booking navigates to its detail, a block opens the block-detail dialog.
  readonly onSelectEvent: (item: CalendarItem) => void
  // #589 1d / #1101: when provided, the calendar is selectable and a clicked slot
  // surfaces its range AND the resource-column vehicle (day view only — undefined in
  // week/month) so the route can prefill the manual-booking or schedule-block dialog.
  // Omitted for read-only viewers (non-operator sessions), keeping the calendar view-only.
  readonly onSelectSlot?:
    | ((range: { start: Date; end: Date; resourceId?: string }) => void)
    | undefined
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
  onSelectSlot,
}: BookingsCalendarProps) {
  const t = useTranslations('business.bookings.calendar')
  const culture = locale === 'zh' ? 'zh-CN' : locale
  // The Timeline option in the switcher follows the runtime-toggleable flag (#1322):
  // a dashboard override flips it live, falling back to the build-time default.
  const timelineEnabled = useFeatureFlag('FLEET_TIMELINE')
  // The booking quick-view chip (#1282) is gated OFF for the beta MVP (#1329);
  // when off, a booking renders as a plain band like a block. Build-time flag for
  // now (runtime migration tracked by #1322).
  const quickViewEnabled = isCalendarQuickViewEnabled()

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
        // #1250: the JST calendar day, so an off-JST viewer's TODAY lands on the Tokyo
        // day the operator works in (not the browser-local day, which differs near midnight).
        onDateChange(todayInJst())
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
    (item: CalendarItem) => onSelectEvent(item),
    [onSelectEvent],
  )

  const handleSelectSlot = useCallback(
    (slot: SlotInfo) =>
      onSelectSlot?.({
        // #1250: rbc reports the slot in the calendar's local coordinate space, which
        // startAccessor/endAccessor below pin to the JST wall clock. Read those local
        // fields back as JST to recover the true instant, so a slot-prefill matches the
        // Tokyo time the operator clicked (the dialogs re-anchor via formatJstDateTimeLocal).
        start: jstWallClockToInstant(slot.start),
        end: jstWallClockToInstant(slot.end),
        // rbc only sets resourceId in the resource (day) view; week/month omit it —
        // so omit the key entirely there (exactOptionalPropertyTypes rejects undefined).
        ...(slot.resourceId != null ? { resourceId: String(slot.resourceId) } : {}),
      }),
    [onSelectSlot],
  )

  const eventPropGetter = useCallback(
    (item: CalendarItem) => ({ className: calendarItemClassName(item) }),
    [],
  )

  // #1250: rbc positions a band by reading its start/end LOCAL wall clock. The
  // CalendarItem carries true instants, so feed rbc a faux-local Date whose local wall
  // clock equals the Tokyo wall clock — a 10:00 JST pickup then renders at 10:00 on any
  // browser. rbc keeps the original event for callbacks, so onSelectEvent (and the
  // block-detail dialog) still receive true instants — no double shift.
  const startAccessor = useCallback((item: CalendarItem) => instantToJstFauxLocal(item.start), [])
  const endAccessor = useCallback((item: CalendarItem) => instantToJstFauxLocal(item.end), [])

  // rbc renders each band through `components.event`. A booking becomes the
  // interactive quick-view chip (hover-peek / click-pin); a block stays a plain band
  // so its existing click -> block-detail-dialog path (onSelectEvent) is untouched.
  // The toolbar is suppressed here — the route renders CalendarToolbar itself.
  // Scale note: this mounts one base-ui Popover per booking band. Fine at this fleet
  // size (day/week are sparse; the default timeline view uses no chips). If a dense
  // month view ever regresses, hoist a single calendar-level Popover keyed to the
  // hovered/pinned event id instead of one-per-event.
  const components = useMemo(
    () => ({
      toolbar: () => null,
      event: (props: EventProps<CalendarItem>) =>
        props.event.type === 'booking' && quickViewEnabled ? (
          <CalendarEventChip event={props.event} locale={locale} />
        ) : (
          <span className="truncate">{props.event.title}</span>
        ),
    }),
    [locale, quickViewEnabled],
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

  // The route renders <FleetTimeline> for the timeline view, never this component —
  // the guard both proves that to the reader and narrows `view` to rbc's three views
  // for the <Calendar> props below (it cannot accept 'timeline').
  if (view === 'timeline') return null

  return (
    <div>
      <CalendarToolbar
        label={toolbarLabel}
        view={view}
        onNavigate={handleToolbarNavigate}
        onView={onViewChange}
        views={operatorViews(timelineEnabled)}
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
        startAccessor={startAccessor}
        endAccessor={endAccessor}
        onView={(v) => onViewChange(v as CalendarView)}
        onNavigate={onDateChange}
        onSelectEvent={handleSelectEvent}
        selectable={Boolean(onSelectSlot)}
        onSelectSlot={handleSelectSlot}
        eventPropGetter={eventPropGetter}
        views={RBC_VIEWS}
        step={60}
        timeslots={1}
        scrollToTime={SCROLL_TO_TIME}
        style={calendarStyle}
        messages={messages}
        components={components}
        popup
      />
    </div>
  )
}
