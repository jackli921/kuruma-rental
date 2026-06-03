/**
 * Operating-hours wire shape — locked for MVP (proposal §9, issue #387 amendment
 * item 5). A single open/close pair applied to all weekdays. Stored verbatim in
 * `locations.operatingHours` JSONB and validated by `validators/location.ts`.
 *
 * Future per-weekday schedules ship as a separate migration + validator change;
 * do NOT widen this shape opportunistically — slice 5 will revisit it.
 */
export type LocationOperatingHours = {
  /** "HH:mm" 24-hour, local to the location's timezone */
  openTime: string
  /** "HH:mm" 24-hour, local to the location's timezone */
  closeTime: string
} | null
