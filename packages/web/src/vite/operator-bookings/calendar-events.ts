import { BLOCK_KIND_CLASS, STATUS_CLASS } from '@/lib/event-colors'
import type { CalendarBookingRow, OperatorBookingStatus } from '@/vite/operator-bookings/api'
import type { CalendarBlockRow } from '@/vite/operator-bookings/schema'
import type { VehicleBlockKind } from '@kuruma/shared/enums'

// #525 Slice B: pure transforms feeding the operator booking calendar. Kept free
// of React/rbc so they stay unit-testable (FC/IS — the BookingsCalendar shell
// renders; these decide the data shape). The component is framework code we don't
// unit-test; these functions carry the logic that can actually break. The
// view/range/param plumbing lives in calendar-view.ts (#1245).

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
