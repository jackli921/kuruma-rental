import { instantToJstFauxLocal, todayInJst } from '@/lib/datetime'
import { BLOCK_KIND_CLASS, STATUS_CLASS } from '@/lib/event-colors'
import { useFeatureFlag } from '@/vite/config'
import { CalendarToolbar } from '@/vite/operator-bookings/CalendarToolbar'
import type { CalendarBookingRow } from '@/vite/operator-bookings/api'
import type { BlockCalendarEvent } from '@/vite/operator-bookings/calendar-events'
import {
  type CalendarView,
  TIMELINE_SPAN_DAYS,
  calendarRange,
  operatorViews,
  shiftCalendarDate,
} from '@/vite/operator-bookings/calendar-view'
import {
  bookingIdFromTimelineItem,
  buildTimelineLayout,
} from '@/vite/operator-bookings/timeline-layout'
import {
  type RovingDirection,
  buildRovingModel,
  nextBarId,
  resolveActiveBarId,
} from '@/vite/operator-bookings/timeline-roving'
import { addDays, startOfDay } from 'date-fns'
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
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
// newest version that exists. Do NOT widen the exact pin or "downgrade to stable". Full
// rationale: docs/2026-07-02-fleet-timeline-lib-pin.md.
//
// A11y (#1349): the lib ships no keyboard/ARIA on its bars, so this shell adds them via each
// item's `itemProps` — every interactive bar is a focusable role=button with a localized
// aria-label that opens its detail on Enter/Space (parity with click); the redundant
// turnaround tail is aria-hidden (one stop per booking, decided in buildTimelineLayout). This
// closes the GA gate for VITE_FEATURE_FLEET_TIMELINE.
//
// A11y (#1470): #1349's per-bar tab stops make a dense board (40-50 cars × a week) 100-200
// Tab presses. A roving tabindex collapses it to ONE stop — exactly one bar is tabIndex=0 —
// with arrow keys moving focus in a 2D grid (Left/Right along a row, Up/Down to the nearest-
// in-time bar in an adjacent row, Home/End to a row's ends). The grid geometry is the pure
// `timeline-roving` model; this shell only maps a key to a direction, focuses the returned
// bar, and roves the single stop to follow it (FC/IS: the core decides where focus goes).

// #1470: arrow/Home/End keys mapped to a board direction. A key not here (Enter/Space/Tab)
// falls through to activation or the browser's own focus handling.
const ARROW_DIRECTIONS: Record<string, RovingDirection> = {
  ArrowRight: 'right',
  ArrowLeft: 'left',
  ArrowDown: 'down',
  ArrowUp: 'up',
  Home: 'home',
  End: 'end',
}

interface FleetTimelineProps {
  readonly rows: readonly CalendarBookingRow[]
  // The operator's fleet — each becomes a row; bookings bind to a row by vehicle id.
  readonly vehicles: readonly { id: string; name: string }[]
  // Scheduled maintenance/hold bands (#1244) — kind-colored, bound to a fleet row.
  readonly blocks: readonly BlockCalendarEvent[]
  readonly date: Date
  readonly locale: string
  readonly onViewChange: (view: CalendarView) => void
  readonly onDateChange: (date: Date) => void
  readonly onSelectEvent: (bookingId: string) => void
  // A block band opens its detail dialog (day/week parity) rather than a trip.
  readonly onSelectBlock: (block: BlockCalendarEvent) => void
}

export function FleetTimeline({
  rows,
  vehicles,
  blocks,
  date,
  locale,
  onViewChange,
  onDateChange,
  onSelectEvent,
  onSelectBlock,
}: FleetTimelineProps) {
  const t = useTranslations('business.bookings.calendar')
  // Block kind labels live in a separate namespace (bookings.operator.blocks.kinds),
  // reused here so a bar's aria-label reads the same localized kind the legend shows.
  const tBlockKinds = useTranslations('bookings.operator.blocks.kinds')
  const culture = locale === 'zh' ? 'zh-CN' : locale
  // Shares the switcher with BookingsCalendar; the Timeline option follows the same
  // runtime-toggleable flag (#1322) so both views agree on the offered set.
  const timelineEnabled = useFeatureFlag('FLEET_TIMELINE')

  // #1471: a date-range nav rebuilds every bar. If keyboard/screen-reader focus sat on a
  // booking bar that the new window drops, React unmounts that node and the browser lets
  // focus fall to <body>, stranding a screen-reader user at the top of the page. When that
  // happens, return focus to the labelled board region — a stable anchor that always
  // exists. If focus is still on a live control (the toolbar's Next drove the nav, as in
  // Chromium where a click focuses the button first), it is left untouched so repeat
  // navigation keeps working.
  //
  // This covers the in-place re-render (the norm: the loader pre-warms the range so the
  // route never suspends and this same fiber re-renders with a new `date`). A slow, cold
  // nav that trips the route's pendingComponent unmounts this whole subtree and remounts a
  // fresh one — that focus loss is app-wide and belongs to a route/layout-level announcer,
  // not here (a component can't restore focus across its own unmount). See #1489.
  //
  // useLayoutEffect (not useEffect): restore synchronously post-commit/pre-paint so focus
  // never lands on <body> for a painted frame (which can bump an AT's virtual cursor to the
  // top). Client-only Vite SPA — no SSR to worry about.
  const regionRef = useRef<HTMLElement>(null)
  const prevDateMsRef = useRef(date.getTime())
  useLayoutEffect(() => {
    const ms = date.getTime()
    if (prevDateMsRef.current === ms) return
    prevDateMsRef.current = ms
    if (document.activeElement === document.body) regionRef.current?.focus()
  }, [date])

  // The visible window is the SAME range the loader fetched (calendarRange), so the
  // board shows exactly the rows that were loaded — no off-by-one against the fetch.
  // calendarRange is JST-anchored (#1250), so `*True` are the real instants used to
  // clamp bars below. react-calendar-timeline positions bars AND renders its axis
  // labels in the browser's local tz, so `from`/`to` (and each bar) are shifted to
  // faux-local — a local wall clock that reads as the Tokyo wall clock — for the lib.
  // The shift is uniform, preserving clamping + relative spacing while pinning the
  // axis to JST on any browser.
  const { fromTrue, toTrue, from, to } = useMemo(() => {
    const r = calendarRange('timeline', date)
    const fromTrue = Date.parse(r.from)
    const toTrue = Date.parse(r.to)
    return {
      fromTrue,
      toTrue,
      from: instantToJstFauxLocal(new Date(fromTrue)).getTime(),
      to: instantToJstFauxLocal(new Date(toTrue)).getTime(),
    }
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
    () =>
      buildTimelineLayout({
        rows,
        vehicles,
        blocks,
        from: fromTrue,
        to: toTrue,
        unassignedLabel: t('unassigned'),
      }),
    [rows, vehicles, blocks, fromTrue, toTrue, t],
  )

  // #1470: the interactive bars as a 2D grid (rows in board order × time). Rebuilt per layout
  // so arrow keys navigate the same bars the board renders.
  const rovingModel = useMemo(
    () =>
      buildRovingModel(
        layout.groups.map((g) => g.id),
        layout.items
          .filter((it) => it.interactive)
          .map((it) => ({ id: it.id, group: it.group, start: it.start })),
      ),
    [layout],
  )

  // The single tab stop — the one bar with tabIndex=0. Arrow keys rove it to follow focus.
  // Derived, not effect-synced (resolveActiveBarId is pure): when a date nav drops the active
  // bar from the window, it falls back to the first bar so Tab still enters the board — with
  // no stale-id churn and no render lag an effect would introduce. Null = no bars.
  const [activeBarId, setActiveBarId] = useState<string | null>(null)
  const resolvedActiveId = resolveActiveBarId(rovingModel, activeBarId)

  // Focus a bar by id. The lib owns the bar DOM, so we reach it through the `data-bar-id`
  // attribute injected via itemProps (the same channel #1349's role/aria use) rather than a
  // ref the lib would not forward. Scoped to the board region so ids can't collide elsewhere.
  // If the bar isn't in the DOM (impossible today — the lib renders every row — but a guard
  // against a future virtualizing bump), fall back to the region so focus never lands on
  // <body>, the same stable anchor #1471 restores to.
  const focusBar = useCallback((id: string) => {
    const node = regionRef.current?.querySelector<HTMLElement>(`[data-bar-id="${CSS.escape(id)}"]`)
    ;(node ?? regionRef.current)?.focus()
  }, [])

  const groups = useMemo<TimelineGroupBase[]>(
    () => layout.groups.map((g) => ({ id: g.id, title: g.title })),
    [layout.groups],
  )

  // Vehicle (row) title by group id — a bar's aria-label leads with the car, the
  // board's primary axis, since the sidebar row label is not linked to the bar.
  const groupTitleById = useMemo(
    () => new Map(layout.groups.map((g) => [g.id, g.title] as const)),
    [layout.groups],
  )

  // A bar's aria-label reads the Tokyo wall clock (#1250) straight off the true
  // instant, so a screen reader announces the same times the axis shows on any tz.
  const barRangeFmt = useMemo(
    () =>
      new Intl.DateTimeFormat(culture, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: 'Asia/Tokyo',
      }),
    [culture],
  )

  // The lib hands back only the clicked bar's id, not the item, so we recover the
  // bar's type by membership: block-bar ids are block-table UUIDs, disjoint from
  // booking ids and their `::turnaround` suffix, so "id is a known block" is an exact
  // discriminant. The map also carries the full block (reason/notes) for the dialog.
  const blockById = useMemo(() => new Map(blocks.map((b) => [b.id, b])), [blocks])

  // Both events fire on a bar click (select first, click on a re-click); wire both
  // so a single click always opens the trip (or block), regardless of selection state.
  const handleItemSelect = useCallback(
    (itemId: Id) => {
      const id = String(itemId)
      const block = blockById.get(id)
      if (block) {
        onSelectBlock(block)
        return
      }
      onSelectEvent(bookingIdFromTimelineItem(id))
    },
    [blockById, onSelectBlock, onSelectEvent],
  )

  // #1349 keyboard parity: Enter or Space opens the same detail a click opens. Space is
  // preventDefault'd so it never scrolls the page. #1470: arrow/Home/End rove focus across
  // the 2D grid — preventDefault so they move focus instead of scrolling the board canvas,
  // and rove the tabIndex=0 stop to the new bar (clamps at edges, so a no-op move is a
  // silent stay). Any other key (notably Tab) bubbles to the browser's own handling.
  const handleItemKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>, itemId: string) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        handleItemSelect(itemId)
        return
      }
      const dir = ARROW_DIRECTIONS[e.key]
      if (!dir) return
      e.preventDefault()
      const target = nextBarId(rovingModel, itemId, dir)
      if (target === itemId) return
      setActiveBarId(target)
      focusBar(target)
    },
    [handleItemSelect, rovingModel, focusBar],
  )

  const items = useMemo<TimelineItemBase<number>[]>(
    () =>
      layout.items.map((it) => {
        const vehicle = groupTitleById.get(it.group) ?? it.group
        const range = `${barRangeFmt.format(it.start)} - ${barRangeFmt.format(it.end)}`
        const label =
          it.type === 'block'
            ? t('board.blockBar', { vehicle, kind: tBlockKinds(it.kind), title: it.title, range })
            : t('board.bookingBar', {
                vehicle,
                renter: it.title,
                status: t(`sidebar.statuses.${it.status}`),
                range,
              })
        return {
          id: it.id,
          group: it.group,
          title: it.title,
          // #1250: faux-local so the bar lands at its Tokyo wall clock on the local axis.
          start_time: instantToJstFauxLocal(new Date(it.start)).getTime(),
          end_time: instantToJstFauxLocal(new Date(it.end)).getTime(),
          canMove: false,
          canResize: false,
          // #1244: a booking bar wears its status color (+ dashed turnaround tail); a
          // block bar wears its kind band so it never reads as a booking.
          className:
            it.type === 'block'
              ? BLOCK_KIND_CLASS[it.kind]
              : `${STATUS_CLASS[it.status]}${it.band === 'turnaround' ? ' fleet-bar--turnaround' : ''}`,
          // #1349: an interactive bar is a focusable, labelled button that opens its
          // detail on Enter/Space (parity with click). A suppressed turnaround tail is
          // taken out of the a11y tree (aria-hidden + non-focusable) so a keyboard user
          // never lands on two bars for one booking; a mouse click on it still works.
          // aria-haspopup only on block bars: they open BlockDetailDialog, whereas a
          // booking bar navigates to a full page — promising a dialog there would mislead AT.
          // #1470: only the active bar is tabIndex=0 (the board is one tab stop); the rest
          // are tabIndex=-1, reachable by arrow keys. `data-bar-id` lets focusBar find the
          // lib-owned node by id.
          itemProps: it.interactive
            ? {
                role: 'button',
                tabIndex: it.id === resolvedActiveId ? 0 : -1,
                'data-bar-id': it.id,
                ...(it.type === 'block' ? { 'aria-haspopup': 'dialog' as const } : {}),
                'aria-label': label,
                onKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>) => handleItemKeyDown(e, it.id),
              }
            : { 'aria-hidden': true },
        }
      }),
    [
      layout.items,
      groupTitleById,
      barRangeFmt,
      t,
      tBlockKinds,
      handleItemKeyDown,
      resolvedActiveId,
    ],
  )

  const handleNavigate = useCallback(
    (action: 'PREV' | 'NEXT' | 'TODAY') => {
      if (action === 'TODAY') {
        // #1250: the JST calendar day (see BookingsCalendar) — off-JST the browser-local
        // day can differ from the Tokyo day the operator plans in.
        onDateChange(todayInJst())
        return
      }
      onDateChange(shiftCalendarDate('timeline', date, action === 'PREV' ? -1 : 1))
    },
    [date, onDateChange],
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
      {/* #1349: name the whole board as a region so a screen-reader user gets a
          landmark to jump to and a label for the mouse-only canvas the lib renders. */}
      <section ref={regionRef} tabIndex={-1} aria-label={t('board.label', { range: toolbarLabel })}>
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
      </section>
    </div>
  )
}
