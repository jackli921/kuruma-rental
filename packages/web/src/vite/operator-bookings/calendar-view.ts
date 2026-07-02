import { jstWallClockToInstant, todayInJst } from '@/lib/datetime'
import {
  addDays,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  isValid,
  parse,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'

// #1245: the operator calendar's view/range/param plumbing, split out of
// calendar-events.ts so the booking/block transform module stays focused on the
// data shape. Pure and React/rbc-free (FC/IS — the shells render; this decides which
// view is offered and which instant window to fetch).

/** The operator calendar views. `timeline` is the fleet planning board (#1100),
 *  its own component; the other three are rbc views (a subset of rbc's `View`). */
export type CalendarView = 'timeline' | 'day' | 'week' | 'month'

/** The full view-switcher order. `timeline` leads — the operator default when the
 *  fleet-timeline feature is enabled (#1100). */
export const OPERATOR_VIEWS = ['timeline', 'day', 'week', 'month'] as const

/** The view set when the fleet timeline is gated off (#1100): the plain rbc grids. */
const CALENDAR_VIEWS_NO_TIMELINE = ['day', 'week', 'month'] as const

/** The views offered in the switcher, gated by the fleet-timeline flag. Off → the
 *  timeline view drops out and only the day/week/month grids remain. Pure in the
 *  flag: the caller (a component via useFeatureFlag, the loader via the runtime
 *  overrides map) supplies the effective value so a dashboard toggle takes effect
 *  live (#1322). */
export function operatorViews(timelineEnabled: boolean): readonly CalendarView[] {
  return timelineEnabled ? OPERATOR_VIEWS : CALENDAR_VIEWS_NO_TIMELINE
}

/** The landing view: the fleet timeline board when enabled (#1100), else the week
 *  grid — the natural default once the planning board is gated off. */
export function defaultCalendarView(timelineEnabled: boolean): CalendarView {
  return timelineEnabled ? 'timeline' : 'week'
}

/** How many days the fleet timeline spans from its anchor day (#1100 AC: 14). */
export const TIMELINE_SPAN_DAYS = 14

// rbc's localizer starts weeks on Monday (see lib/rbc-localizer); match it so the
// fetched range lines up exactly with the grid the user sees.
const WEEK_OPTS = { weekStartsOn: 1 } as const

/**
 * The [from, to] window (ISO) to fetch for a given view + anchor date. Month view
 * covers the full visible grid (the weeks overlapping the month), so events in the
 * leading/trailing days of adjacent months still render.
 */
export function calendarRange(view: CalendarView, date: Date): { from: string; to: string } {
  // The timeline shows a fixed multi-day span from the anchor day (a planning
  // board, not a calendar grid): [startOfDay(date), startOfDay(date)+14d).
  if (view === 'timeline')
    return iso(startOfDay(date), startOfDay(addDays(date, TIMELINE_SPAN_DAYS)))
  if (view === 'day') return iso(startOfDay(date), endOfDay(date))
  if (view === 'week') return iso(startOfWeek(date, WEEK_OPTS), endOfWeek(date, WEEK_OPTS))
  return iso(startOfWeek(startOfMonth(date), WEEK_OPTS), endOfWeek(endOfMonth(date), WEEK_OPTS))
}

/** Shift the anchor day one view-span back (`-1`) or forward (`+1`) — the unit is
 *  the view's natural step (a day, a week, a month, or the timeline's 14 days). */
export function shiftCalendarDate(view: CalendarView, date: Date, dir: -1 | 1): Date {
  const next = new Date(date)
  if (view === 'month') next.setMonth(next.getMonth() + dir)
  else if (view === 'week') next.setDate(next.getDate() + dir * 7)
  else if (view === 'timeline') next.setDate(next.getDate() + dir * TIMELINE_SPAN_DAYS)
  else next.setDate(next.getDate() + dir)
  return next
}

function iso(from: Date, to: Date): { from: string; to: string } {
  // #1250: the date-fns boundaries above are computed on the anchor's LOCAL calendar
  // day; reinterpret that wall clock as JST so the fetched window is the Tokyo day/
  // week/month, not the browser-local one. Off-JST the two diverge, and a browser-local
  // window straddles two JST days — dropping bookings near JST-midnight from the query.
  return {
    from: jstWallClockToInstant(from).toISOString(),
    to: jstWallClockToInstant(to).toISOString(),
  }
}

// --- URL <-> calendar state (the route stores view/date as search params) ------

/** Narrow an untrusted `?view=` param to a KNOWN view string (or undefined),
 *  without applying the feature flag. The flag-blind pass runs in the route's
 *  `validateSearch`, which has no access to the runtime overrides; the flag-aware
 *  resolution below decides whether `timeline` is actually offered (#1322). */
export function normalizeViewParam(value: unknown): CalendarView | undefined {
  return typeof value === 'string' && (OPERATOR_VIEWS as readonly string[]).includes(value)
    ? (value as CalendarView)
    : undefined
}

/** Resolve a `?view=` value to a currently-offered view, defaulting to the landing
 *  view. Validates against the flag-gated set, so a hand-typed `?view=timeline`
 *  falls back to the week grid while the timeline is gated off (#1322: the caller
 *  passes the effective flag). */
export function parseCalendarView(
  value: string | undefined,
  timelineEnabled: boolean,
): CalendarView {
  const views = operatorViews(timelineEnabled)
  return value && (views as readonly string[]).includes(value)
    ? (value as CalendarView)
    : defaultCalendarView(timelineEnabled)
}

const DATE_FMT = 'yyyy-MM-dd'

/** The `?date=` param value — a local calendar day, time-of-day discarded. */
export function formatCalendarDate(date: Date): string {
  return format(date, DATE_FMT)
}

/**
 * Parse a `?date=` param to a *local* day. Anything missing, malformed, or
 * overflowed (`2026-13-99`) falls back to today. The round-trip check rejects
 * values date-fns would silently normalize into a different day.
 */
export function parseCalendarDate(value?: string | undefined): Date {
  // #1250: an absent/malformed param falls back to the JST calendar day, not the
  // browser-local one — off-JST near midnight they differ, and TODAY must land on the
  // Tokyo day the operator works in. An explicit valid day is used as given.
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return todayInJst()
  const parsed = parse(value, DATE_FMT, new Date())
  return isValid(parsed) && format(parsed, DATE_FMT) === value ? parsed : todayInJst()
}
