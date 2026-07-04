import type { CalendarBookingRow, OperatorBookingStatus } from '@/vite/operator-bookings/api'
import type { BlockCalendarEvent } from '@/vite/operator-bookings/calendar-events'
import type { VehicleBlockKind } from '@kuruma/shared/enums'

// #1100 fleet timeline: pure transforms turning the operator's calendar rows into
// the groups (vehicle rows) + items (bars) react-calendar-timeline consumes. Kept
// free of React and the lib so the geometry that can actually break — window
// clamping, the two-band turnaround split, Unassigned bucketing — is unit-tested
// in isolation (FC/IS: the FleetTimeline shell renders; this decides the shape).

/** Synthetic row id for class-only floats (and orphaned assignments) — bookings
 *  with no fleet column to live in. */
export const UNASSIGNED_GROUP_ID = '__unassigned__'

/** A booking spans two adjacent bands: the booked window and the lighter
 *  turnaround tail (`endAt → effectiveEndAt`, the off-fleet cleaning gap). */
export type TimelineBand = 'booked' | 'turnaround'

/** The turnaround tail's bar id is `${bookingId}${TURNAROUND_SUFFIX}`. Both the
 *  encode (here) and the click-time decode (`bookingIdFromTimelineItem`) read this
 *  one constant — the lib hands the bar id back on click, not the bookingId, so the
 *  two halves of this contract must never drift. */
export const TURNAROUND_SUFFIX = '::turnaround'

/** The booking a clicked timeline bar belongs to — strips the turnaround tail's id
 *  suffix so clicking either band opens the same trip. Pure; lives with its encode
 *  sibling so the suffix contract has a single source of truth. */
export function bookingIdFromTimelineItem(itemId: string): string {
  return itemId.endsWith(TURNAROUND_SUFFIX) ? itemId.slice(0, -TURNAROUND_SUFFIX.length) : itemId
}

/** One vehicle row (or the Unassigned row). */
export interface TimelineGroup {
  id: string
  title: string
}

/** Fields every bar shares. Times are epoch ms already clamped to the window. */
interface TimelineItemCommon {
  id: string
  group: string
  title: string
  start: number
  end: number
  /** #1349 a11y: whether this bar is the keyboard/screen-reader stop for its subject.
   *  A booking is exactly ONE stop — the booked band when it renders, otherwise its
   *  lone-surviving turnaround tail. A suppressed tail (booked sibling present) is
   *  `false` so the shell can aria-hide it and drop it from the tab order. Blocks are
   *  always their own stop. */
  interactive: boolean
}

/** A booking bar — status-colored, click-decodes back to its booking. */
export type TimelineBookingItem = TimelineItemCommon & {
  type: 'booking'
  bookingId: string
  band: TimelineBand
  status: OperatorBookingStatus
}

/** A scheduled-block bar — kind-colored, opens the block detail dialog. Carries a
 *  `kind` (never a `status`), mirroring the calendar's `BlockCalendarEvent` (#1244). */
export type TimelineBlockItem = TimelineItemCommon & {
  type: 'block'
  blockId: string
  kind: VehicleBlockKind
}

/** One bar: a booking or a scheduled block. Consumers switch on `type` at the
 *  boundary (styling, click) so a block never reads as a booking (#1101 P1.2). */
export type TimelineItem = TimelineBookingItem | TimelineBlockItem

export interface TimelineLayout {
  groups: TimelineGroup[]
  items: TimelineItem[]
}

export interface BuildTimelineArgs {
  readonly rows: readonly CalendarBookingRow[]
  readonly vehicles: readonly { id: string; name: string }[]
  /** Scheduled maintenance/hold bands, keyed to a fleet vehicle by `resourceId`.
   *  A block on a vehicle absent from `vehicles` is dropped (never Unassigned —
   *  blocks are always car-specific, unlike class-only booking floats). */
  readonly blocks: readonly BlockCalendarEvent[]
  /** Visible window, epoch ms. Bars are clamped to `[from, to]`. */
  readonly from: number
  readonly to: number
  /** Translated label for the Unassigned row (FC/IS: i18n resolved by the shell). */
  readonly unassignedLabel: string
}

/** Intersect `[start, end]` with `[from, to]`; null when the result is empty so
 *  the caller drops a band that falls wholly outside the window. */
function clampBand(
  start: number,
  end: number,
  from: number,
  to: number,
): { start: number; end: number } | null {
  const s = Math.max(start, from)
  const e = Math.min(end, to)
  return e > s ? { start: s, end: e } : null
}

export function buildTimelineLayout({
  rows,
  vehicles,
  blocks,
  from,
  to,
  unassignedLabel,
}: BuildTimelineArgs): TimelineLayout {
  const fleetIds = new Set(vehicles.map((v) => v.id))
  const items: TimelineItem[] = []
  let hasUnassignedRow = false

  for (const r of rows) {
    // A row with no assigned car — or one whose assigned car is not in the fleet
    // list (deleted, or the list degraded to empty) — goes to Unassigned rather
    // than binding to a missing group, which the lib would silently drop (#1100 #4).
    const group = r.vehicleId && fleetIds.has(r.vehicleId) ? r.vehicleId : UNASSIGNED_GROUP_ID
    const title = r.renterName ?? r.renterEmail ?? r.bookingCode
    const startMs = Date.parse(r.startAt)
    const endMs = Date.parse(r.endAt)
    const effEndMs = Date.parse(r.effectiveEndAt)

    const booked = clampBand(startMs, endMs, from, to)
    if (booked) {
      items.push({
        type: 'booking',
        id: r.id,
        bookingId: r.id,
        group,
        title,
        start: booked.start,
        end: booked.end,
        band: 'booked',
        status: r.status,
        interactive: true,
      })
      if (group === UNASSIGNED_GROUP_ID) hasUnassignedRow = true
    }

    // The turnaround tail exists only when the off-fleet window extends past the
    // booked end; clamp it independently so a tail can survive even if the booked
    // band fell before `from`.
    if (effEndMs > endMs) {
      const tail = clampBand(endMs, effEndMs, from, to)
      if (tail) {
        items.push({
          type: 'booking',
          id: `${r.id}${TURNAROUND_SUFFIX}`,
          bookingId: r.id,
          group,
          title,
          start: tail.start,
          end: tail.end,
          band: 'turnaround',
          status: r.status,
          // #1349: the tail is a keyboard/SR stop ONLY when its booked band did not
          // render (clipped out before the window) — otherwise the booked band is the
          // single stop and this redundant tail is suppressed. `booked` is truthy iff
          // that band was pushed above.
          interactive: !booked,
        })
        if (group === UNASSIGNED_GROUP_ID) hasUnassignedRow = true
      }
    }
  }

  // Scheduled blocks are bound to a specific car. A block on a vehicle not in the
  // fleet list is dropped (not routed to Unassigned like a class-only booking float)
  // — a block has no meaning without its column. Its own window is clamped so a band
  // straddling the edge still shows its in-window slice.
  for (const b of blocks) {
    if (!fleetIds.has(b.resourceId)) continue
    const band = clampBand(b.start.getTime(), b.end.getTime(), from, to)
    if (!band) continue
    items.push({
      type: 'block',
      id: b.id,
      blockId: b.id,
      group: b.resourceId,
      title: b.title,
      start: band.start,
      end: band.end,
      kind: b.kind,
      interactive: true,
    })
  }

  const groups: TimelineGroup[] = vehicles.map((v) => ({ id: v.id, title: v.name }))
  if (hasUnassignedRow) groups.push({ id: UNASSIGNED_GROUP_ID, title: unassignedLabel })

  return { groups, items }
}
