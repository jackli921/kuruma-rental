import type { CalendarBookingRow, OperatorBookingStatus } from '@/vite/operator-bookings/api'
import {
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

// #525 Slice B: pure transforms feeding the operator booking calendar. Kept free
// of React/rbc so they stay unit-testable (FC/IS — the BookingsCalendar shell
// renders; these decide the data shape). The component is framework code we don't
// unit-test; these functions carry the logic that can actually break.

/** The three calendar views the operator gets. A subset of rbc's `View`. */
export type CalendarView = 'day' | 'week' | 'month'

/** One booking as react-big-calendar consumes it (events bind to columns by id). */
export interface CalendarEvent {
  id: string
  title: string
  start: Date
  end: Date
  // The fulfilling vehicle's id — the day-view resource column key. Empty string
  // for a class-only booking with no assigned car: it has no column to live in.
  resourceId: string
  status: OperatorBookingStatus
}

/** One vehicle column in day view. */
export interface CalendarResource {
  resourceId: string
  resourceTitle: string
}

export function toCalendarEvents(rows: readonly CalendarBookingRow[]): CalendarEvent[] {
  return rows.map((r) => ({
    id: r.id,
    title: r.renterName ?? r.renterEmail ?? r.bookingCode,
    start: new Date(r.startAt),
    end: new Date(r.effectiveEndAt),
    resourceId: r.vehicleId ?? '',
    status: r.status,
  }))
}

export function fleetToResources(
  vehicles: readonly { id: string; name: string }[],
): CalendarResource[] {
  return vehicles.map((v) => ({ resourceId: v.id, resourceTitle: v.name }))
}

// rbc's localizer starts weeks on Monday (see lib/rbc-localizer); match it so the
// fetched range lines up exactly with the grid the user sees.
const WEEK_OPTS = { weekStartsOn: 1 } as const

/**
 * The [from, to] window (ISO) to fetch for a given view + anchor date. Month view
 * covers the full visible grid (the weeks overlapping the month), so events in the
 * leading/trailing days of adjacent months still render.
 */
export function calendarRange(view: CalendarView, date: Date): { from: string; to: string } {
  if (view === 'day') return iso(startOfDay(date), endOfDay(date))
  if (view === 'week') return iso(startOfWeek(date, WEEK_OPTS), endOfWeek(date, WEEK_OPTS))
  return iso(startOfWeek(startOfMonth(date), WEEK_OPTS), endOfWeek(endOfMonth(date), WEEK_OPTS))
}

function iso(from: Date, to: Date): { from: string; to: string } {
  return { from: from.toISOString(), to: to.toISOString() }
}

// --- URL <-> calendar state (the route stores view/date as search params) ------

const VIEW_SET = new Set<CalendarView>(['day', 'week', 'month'])

/** Narrow an untrusted `?view=` param to one of our views, defaulting to week. */
export function parseCalendarView(value?: string | undefined): CalendarView {
  return value && VIEW_SET.has(value as CalendarView) ? (value as CalendarView) : 'week'
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
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date()
  const parsed = parse(value, DATE_FMT, new Date())
  return isValid(parsed) && format(parsed, DATE_FMT) === value ? parsed : new Date()
}
