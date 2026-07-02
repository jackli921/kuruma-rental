import { STATUS_CLASS } from '@/lib/event-colors'
import { useFeatureFlag } from '@/vite/config'
import { CalendarToolbar } from '@/vite/operator-bookings/CalendarToolbar'
import type { CalendarBookingRow } from '@/vite/operator-bookings/api'
import {
  type CalendarView,
  TIMELINE_SPAN_DAYS,
  calendarRange,
  operatorViews,
  shiftCalendarDate,
} from '@/vite/operator-bookings/calendar-events'
import {
  bookingIdFromTimelineItem,
  buildTimelineLayout,
} from '@/vite/operator-bookings/timeline-layout'
import { addDays, startOfDay } from 'date-fns'
import { useCallback, useMemo } from 'react'
import Timeline, {
  type Id,
  type TimelineGroupBase,
  type TimelineItemBase,
} from 'react-calendar-timeline'
import { useTranslations } from 'use-intl'
import 'react-calendar-timeline/style.css'
import './fleet-timeline-theme.css'

// #1100 fleet planning board: a thin react-calendar-timeline adapter. All geometry
// (rows, the two-band split, Unassigned bucketing, window clamping) lives in the
// pure buildTimelineLayout; this shell only maps that shape to the lib's props and
// owns its toolbar (FC/IS — the core decides, this renders). The booking-status
// palette is applied via STATUS_CLASS on each bar (themed in fleet-timeline-theme.css).
//
// react-calendar-timeline is pinned to 0.30.0-beta.18 ON PURPOSE (#1330): no stable release
// supports React 19 (0.28.0, the last stable, is React 16/17 era), so this pre-release is the
// newest version that exists. Do NOT widen the exact pin or "downgrade to stable". Known a11y
// gap: the bars are mouse-only (no keyboard/ARIA) — #1349 gates flipping VITE_FEATURE_FLEET_TIMELINE
// on for GA. Full rationale: docs/2026-07-02-fleet-timeline-lib-pin.md.

interface FleetTimelineProps {
  readonly rows: readonly CalendarBookingRow[]
  // The operator's fleet — each becomes a row; bookings bind to a row by vehicle id.
  readonly vehicles: readonly { id: string; name: string }[]
  readonly date: Date
  readonly locale: string
  readonly onViewChange: (view: CalendarView) => void
  readonly onDateChange: (date: Date) => void
  readonly onSelectEvent: (bookingId: string) => void
}

export function FleetTimeline({
  rows,
  vehicles,
  date,
  locale,
  onViewChange,
  onDateChange,
  onSelectEvent,
}: FleetTimelineProps) {
  const t = useTranslations('business.bookings.calendar')
  const culture = locale === 'zh' ? 'zh-CN' : locale
  // Shares the switcher with BookingsCalendar; the Timeline option follows the same
  // runtime-toggleable flag (#1322) so both views agree on the offered set.
  const timelineEnabled = useFeatureFlag('FLEET_TIMELINE')

  // The visible window is the SAME range the loader fetched (calendarRange), so the
  // board shows exactly the rows that were loaded — no off-by-one against the fetch.
  const { from, to } = useMemo(() => {
    const r = calendarRange('timeline', date)
    return { from: Date.parse(r.from), to: Date.parse(r.to) }
  }, [date])

  const toolbarLabel = useMemo(() => {
    const start = startOfDay(date)
    const end = addDays(start, TIMELINE_SPAN_DAYS - 1)
    const s = new Intl.DateTimeFormat(culture, { month: 'short', day: 'numeric' }).format(start)
    const e = new Intl.DateTimeFormat(culture, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(end)
    return `${s} - ${e}`
  }, [date, culture])

  const layout = useMemo(
    () => buildTimelineLayout({ rows, vehicles, from, to, unassignedLabel: t('unassigned') }),
    [rows, vehicles, from, to, t],
  )

  const groups = useMemo<TimelineGroupBase[]>(
    () => layout.groups.map((g) => ({ id: g.id, title: g.title })),
    [layout.groups],
  )

  const items = useMemo<TimelineItemBase<number>[]>(
    () =>
      layout.items.map((it) => ({
        id: it.id,
        group: it.group,
        title: it.title,
        start_time: it.start,
        end_time: it.end,
        canMove: false,
        canResize: false,
        className: `${STATUS_CLASS[it.status]}${
          it.band === 'turnaround' ? ' fleet-bar--turnaround' : ''
        }`,
      })),
    [layout.items],
  )

  const handleNavigate = useCallback(
    (action: 'PREV' | 'NEXT' | 'TODAY') => {
      if (action === 'TODAY') {
        onDateChange(new Date())
        return
      }
      onDateChange(shiftCalendarDate('timeline', date, action === 'PREV' ? -1 : 1))
    },
    [date, onDateChange],
  )

  // Both events fire on a bar click (select first, click on a re-click); wire both
  // so a single click always opens the trip, regardless of selection state.
  const handleItemSelect = useCallback(
    (itemId: Id) => onSelectEvent(bookingIdFromTimelineItem(String(itemId))),
    [onSelectEvent],
  )

  // Pin the canvas to the toolbar-driven window: the board is navigated by our
  // toolbar (a 14-day planning span), not free-panned. The lib calls this on any
  // internal pan/zoom; we snap it back so the view stays aligned with the fetch.
  const handleTimeChange = useCallback(
    (_start: number, _end: number, updateScrollCanvas: (start: number, end: number) => void) => {
      updateScrollCanvas(from, to)
    },
    [from, to],
  )

  return (
    <div>
      <CalendarToolbar
        label={toolbarLabel}
        view="timeline"
        onNavigate={handleNavigate}
        onView={onViewChange}
        views={operatorViews(timelineEnabled)}
      />
      <Timeline
        groups={groups}
        items={items}
        defaultTimeStart={from}
        defaultTimeEnd={to}
        visibleTimeStart={from}
        visibleTimeEnd={to}
        onTimeChange={handleTimeChange}
        onItemSelect={handleItemSelect}
        onItemClick={handleItemSelect}
        sidebarWidth={200}
        lineHeight={44}
        canMove={false}
        canResize={false}
      />
    </div>
  )
}
