import { BLOCK_KIND_CLASS, STATUS_CLASS } from '@/lib/event-colors'
import { isFleetTimelineEnabled } from '@/vite/config'
import type { CalendarBookingRow, OperatorBookingStatus } from '@/vite/operator-bookings/api'
import type { CalendarBlockRow } from '@/vite/operator-bookings/schema'
import type { VehicleBlockKind } from '@kuruma/shared/enums'
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

// #525 Slice B: pure transforms feeding the operator booking calendar. Kept free
// of React/rbc so they stay unit-testable (FC/IS — the BookingsCalendar shell
// renders; these decide the data shape). The component is framework code we don't
// unit-test; these functions carry the logic that can actually break.

/** The operator calendar views. `timeline` is the fleet planning board (#1100),
 *  its own component; the other three are rbc views (a subset of rbc's `View`). */
export type CalendarView = 'timeline' | 'day' | 'week' | 'month'

/** The full view-switcher order. `timeline` leads — the operator default when the
 *  fleet-timeline feature is enabled (#1100). */
export const OPERATOR_VIEWS = ['timeline', 'day', 'week', 'month'] as const

/** The view set when the fleet timeline is gated off (#1100): the plain rbc grids. */
const CALENDAR_VIEWS_NO_TIMELINE = ['day', 'week', 'month'] as const

/** The views offered in the switcher, gated by the fleet-timeline flag. Off → the
 *  timeline view drops out and only the day/week/month grids remain. */
export function operatorViews(): readonly CalendarView[] {
  return isFleetTimelineEnabled() ? OPERATOR_VIEWS : CALENDAR_VIEWS_NO_TIMELINE
}

/** The landing view: the fleet timeline board when enabled (#1100), else the week
 *  grid — the natural default once the planning board is gated off. */
export function defaultCalendarView(): CalendarView {
  return isFleetTimelineEnabled() ? 'timeline' : 'week'
}

/** How many days the fleet timeline spans from its anchor day (#1100 AC: 14). */
export const TIMELINE_SPAN_DAYS = 14

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
  // --- in-hand fields the quick-view card renders (self-describing event) ---
  bookingCode: string
  renterName: string | null
  renterEmail: string | null
  vehicleName: string | null
  totalPrice: number | null
}

/** One vehicle column in day view. */
export interface CalendarResource {
  resourceId: string
  resourceTitle: string
}

// #1101 Slice B: the calendar shows two kinds of band on the same vehicle axis —
// bookings (status-colored) and scheduled blocks (kind-colored). Rather than smuggle
// "is this a booking" through `status` (blocks have none), the item is a discriminated
// union on `type`; every consumer (styling, filter, click) switches on it at the
// boundary. (design P1.2.)
export type BookingCalendarEvent = CalendarEvent & { type: 'booking' }

/** A scheduled vehicle block as the calendar consumes it. Carries `kind` (never a
 *  `status`), plus `reason`/`notes` so the click handler hands the detail dialog the
 *  whole item. `resourceId` is the blocked vehicle's id — the same column axis. */
export interface BlockCalendarEvent {
  type: 'block'
  id: string
  title: string
  start: Date
  end: Date
  resourceId: string
  kind: VehicleBlockKind
  reason: string
  notes: string | null
}

/** A single band on the operator calendar: a booking or a scheduled block. */
export type CalendarItem = BookingCalendarEvent | BlockCalendarEvent

/** The rbc band class for an item — its status color for a booking, its kind band
 *  for a block. Pure switch on the discriminant, so the calendar shell's
 *  `eventPropGetter` stays a one-liner. */
export function calendarItemClassName(item: CalendarItem): string {
  return item.type === 'booking' ? (STATUS_CLASS[item.status] ?? '') : BLOCK_KIND_CLASS[item.kind]
}

export function toCalendarEvents(
  rows: readonly CalendarBookingRow[],
  vehicles: readonly { id: string; name: string }[],
): BookingCalendarEvent[] {
  const nameById = new Map(vehicles.map((v) => [v.id, v.name]))
  return rows.map((r) => ({
    type: 'booking',
    id: r.id,
    title: r.renterName ?? r.renterEmail ?? r.bookingCode,
    start: new Date(r.startAt),
    end: new Date(r.effectiveEndAt),
    resourceId: r.vehicleId ?? '',
    status: r.status,
    bookingCode: r.bookingCode,
    renterName: r.renterName,
    renterEmail: r.renterEmail,
    vehicleName: r.vehicleId ? (nameById.get(r.vehicleId) ?? null) : null,
    totalPrice: r.totalPrice,
  }))
}

/** Map fleet-wide blocks to calendar bands keyed by vehicle. `title` is the
 *  operator's own `reason` (the kind drives the band color + legend), so this stays
 *  a pure function of the row — no i18n dependency (the dialog/legend localize the
 *  kind). */
export function blocksToCalendarEvents(blocks: readonly CalendarBlockRow[]): BlockCalendarEvent[] {
  return blocks.map((b) => ({
    type: 'block',
    id: b.id,
    title: b.reason,
    start: new Date(b.startAt),
    end: new Date(b.endAt),
    resourceId: b.vehicleId,
    kind: b.kind,
    reason: b.reason,
    notes: b.notes,
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
  return { from: from.toISOString(), to: to.toISOString() }
}

// --- URL <-> calendar state (the route stores view/date as search params) ------

/** Narrow an untrusted `?view=` param to a currently-offered view, defaulting to
 *  the landing view. Validates against the flag-gated set, so a hand-typed
 *  `?view=timeline` falls back to the week grid while the timeline is gated off. */
export function parseCalendarView(value?: string | undefined): CalendarView {
  const views = operatorViews()
  return value && (views as readonly string[]).includes(value)
    ? (value as CalendarView)
    : defaultCalendarView()
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
