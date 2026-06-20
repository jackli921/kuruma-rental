import { formatJstDateTimeLocal, parseJstDateTimeLocal } from '@/lib/datetime'

/**
 * Pure helpers for the renter pickup/return picker (#965).
 *
 * The picker's wire contract is unchanged from the old native inputs: a JST
 * wall-clock `datetime-local` string ("YYYY-MM-DDTHH:mm"). A calendar day
 * (read via local fields) concatenated with an "HH:mm" slot IS that string, so
 * no timezone math is needed except to compute "now" in JST for past-gating.
 */

export interface DateTimeRange {
  /** JST wall-clock "YYYY-MM-DDTHH:mm". */
  from: string
  to: string
}

export interface DateTimePart {
  /** "YYYY-MM-DD". */
  date: string
  /** "HH:mm". */
  time: string
}

const PART_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/
const MINUTES_PER_DAY = 24 * 60
const DAY_MS = MINUTES_PER_DAY * 60 * 1000
const DEFAULT_STEP_MINUTES = 30

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Split a wall-clock string into date + time parts, or null if malformed. */
export function splitDateTime(value: string): DateTimePart | null {
  const match = PART_RE.exec(value)
  if (!match) return null
  return { date: match[1] as string, time: match[2] as string }
}

/** Rebuild the wall-clock `datetime-local` string from its parts. */
export function combineDateTime(date: string, time: string): string {
  return `${date}T${time}`
}

/** Every "HH:mm" slot in a day, stepped by `stepMinutes` (e.g. 48 at 30-min). */
export function generateTimeSlots(stepMinutes: number = DEFAULT_STEP_MINUTES): string[] {
  const slots: string[] = []
  for (let m = 0; m < MINUTES_PER_DAY; m += stepMinutes) {
    slots.push(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`)
  }
  return slots
}

/** "Now" as Tokyo wall-clock parts — the basis for all past-gating. */
export function jstNowParts(now: Date = new Date()): DateTimePart {
  // formatJstDateTimeLocal always yields a well-formed string, so the split is non-null.
  return splitDateTime(formatJstDateTimeLocal(now)) as DateTimePart
}

/** True when a calendar date falls before today in JST. */
export function isPastDate(date: string, now: Date = new Date()): boolean {
  return date < jstNowParts(now).date
}

/**
 * Selectable time slots for a given calendar date: all slots for a future date,
 * only slots at/after now for today, none for a past date. String comparison is
 * safe because zero-padded "HH:mm" sorts chronologically.
 */
export function slotsForDate(
  date: string,
  now: Date = new Date(),
  stepMinutes: number = DEFAULT_STEP_MINUTES,
): string[] {
  const today = jstNowParts(now)
  if (date < today.date) return []
  const all = generateTimeSlots(stepMinutes)
  if (date > today.date) return all
  return all.filter((slot) => slot >= today.time)
}

/**
 * Pick a valid "HH:mm" for a calendar date: keep `prevTime` if it is still
 * selectable on that date, else fall back to the date's first selectable slot
 * (or "00:00" if the date is fully past — defensive; the calendar disables it).
 * This is the past-clamp the picker applies when the day changes under a chosen
 * time, so a range can never resolve to an already-past pickup/return slot.
 */
export function resolveSlot(
  date: string,
  prevTime: string | null,
  now: Date = new Date(),
  stepMinutes: number = DEFAULT_STEP_MINUTES,
): string {
  const slots = slotsForDate(date, now, stepMinutes)
  if (prevTime && slots.includes(prevTime)) return prevTime
  return slots[0] ?? '00:00'
}

/**
 * Map a "YYYY-MM-DD" string to a local-midnight Date and back. react-day-picker
 * works in local-time Date objects, so we read/write its days via local fields
 * (never UTC) — the day the user clicked is the day we store.
 */
export function toLocalDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y as number, (m as number) - 1, d as number)
}

export function fromLocalDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * Selectable RETURN slots for a date, given the chosen pickup. Identical to
 * slotsForDate, except a same-day return must be strictly later than pickup —
 * so the dropdown never offers an earlier return time on the pickup day.
 */
export function returnSlotsForDate(
  toDate: string,
  from: DateTimePart,
  now: Date = new Date(),
  stepMinutes: number = DEFAULT_STEP_MINUTES,
): string[] {
  const base = slotsForDate(toDate, now, stepMinutes)
  return toDate === from.date ? base.filter((slot) => slot > from.time) : base
}

/** The calendar day after `date` ("YYYY-MM-DD"), via local fields (handles rollover). */
function nextDate(date: string): string {
  const d = toLocalDate(date)
  d.setDate(d.getDate() + 1)
  return fromLocalDate(d)
}

/**
 * Guarantee `to` is strictly after `from` — the picker's load-bearing invariant.
 * parseSearchRange rejects `to <= from`, which would silently render zero results
 * even though the renter actively picked dates. When the return falls at/before
 * pickup (single-day selection, or an earlier same-day return), bump it to the
 * next selectable slot, rolling to the next day's first slot when the pickup day
 * has none later. Both parts required; callers guard that.
 */
export function ensureEndAfterStart(
  from: DateTimePart,
  to: DateTimePart,
  now: Date = new Date(),
  stepMinutes: number = DEFAULT_STEP_MINUTES,
): DateTimePart {
  if (combineDateTime(to.date, to.time) > combineDateTime(from.date, from.time)) return to
  const laterSameDay = returnSlotsForDate(from.date, from, now, stepMinutes)
  if (laterSameDay.length > 0) return { date: from.date, time: laterSameDay[0] as string }
  const next = nextDate(from.date)
  return { date: next, time: slotsForDate(next, now, stepMinutes)[0] ?? '00:00' }
}

/** Whole rental days in a range, rounding partial days up; 0 if non-positive/invalid. */
export function rentalDays(range: DateTimeRange): number {
  try {
    const ms =
      parseJstDateTimeLocal(range.to).getTime() - parseJstDateTimeLocal(range.from).getTime()
    return ms <= 0 ? 0 : Math.ceil(ms / DAY_MS)
  } catch {
    return 0
  }
}
