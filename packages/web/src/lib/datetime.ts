/**
 * Parse a `<input type="datetime-local">` string as wall-clock JST.
 *
 * `<input type="datetime-local">` yields "YYYY-MM-DDTHH:mm" (or with seconds)
 * with **no timezone** attached. The native `new Date(value)` then interprets
 * that wall clock in the **browser's** timezone. That's wrong for Kuruma:
 * the bookings UI always means "Tokyo wall clock" — the cars live in Osaka
 * and the owner schedules in JST — while the primary users are inbound
 * tourists booking from LA/HKG/SYD.
 *
 * This helper appends `+09:00` so the parser anchors to JST regardless of
 * where the browser lives. Tokyo is UTC+9 year-round (no DST), so the fixed
 * offset is correct.
 */
export function parseJstDateTimeLocal(value: string): Date {
  if (!value) throw new Error(`parseJstDateTimeLocal: invalid value: ${JSON.stringify(value)}`)
  // Append seconds if caller passed the minute-granularity form, then pin to JST.
  const withSeconds = /T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value
  const d = new Date(`${withSeconds}+09:00`)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`parseJstDateTimeLocal: invalid value: ${JSON.stringify(value)}`)
  }
  return d
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/**
 * Format an instant as a wall-clock JST `datetime-local` string
 * ("YYYY-MM-DDTHH:mm") — the inverse of parseJstDateTimeLocal. Shifts the epoch
 * by the fixed +09:00 offset (Tokyo has no DST) and reads the UTC fields, so the
 * output is the Tokyo wall clock regardless of where the browser lives.
 */
export function formatJstDateTimeLocal(date: Date): string {
  const jst = new Date(date.getTime() + JST_OFFSET_MS)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return (
    `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())}` +
    `T${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}`
  )
}

/**
 * The single IANA timezone every Kuruma display formatter pins to. The cars live
 * in Osaka and the owner schedules in JST, while renters browse from other zones,
 * so every user-facing date/time is shown at the Tokyo wall clock regardless of
 * the browser's locale. Centralised here so the pin is defined once — a copy-pasted
 * `timeZone: 'Asia/Tokyo'` that a new formatter forgot is what caused #1308.
 */
export const JST_TIME_ZONE = 'Asia/Tokyo'

/**
 * Format an instant (ISO string) as a time-of-day at the JST wall clock in the
 * given locale — 24-hour for ja/zh, 12-hour (AM/PM) for en, matching the rest of
 * the UI rather than the viewer's browser default. The JST pin means an off-Tokyo
 * viewer still sees the time that agrees with the JST-day bucket the row sits in.
 */
export function formatJstTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: JST_TIME_ZONE,
  })
}

/**
 * Read a Date's *local* wall-clock fields and re-interpret them as JST, returning
 * the true instant. The inverse of `instantToJstFauxLocal`.
 *
 * #1250: the operator calendar's fetch window and its react-big-calendar /
 * react-calendar-timeline surfaces are anchored to the browser's local wall clock
 * (that's how those libs position bands and derive day/week/month bounds). To make
 * them mean JST regardless of where the browser lives, we compute in "faux-local"
 * space — a local wall clock that reads as the Tokyo wall clock — then map back to a
 * real instant with this. Used to serialize JST-anchored range bounds and to
 * un-shift a clicked calendar slot before it prefills a JST-anchored dialog.
 */
export function jstWallClockToInstant(wall: Date): Date {
  return new Date(
    Date.UTC(
      wall.getFullYear(),
      wall.getMonth(),
      wall.getDate(),
      wall.getHours(),
      wall.getMinutes(),
      wall.getSeconds(),
      wall.getMilliseconds(),
    ) - JST_OFFSET_MS,
  )
}

/**
 * Build a browser-local Date whose *local* wall clock equals the JST wall clock of
 * `instant`. The inverse of `jstWallClockToInstant`.
 *
 * #1250: rbc/timeline read a band's local hours to place it on the axis. Feeding
 * them this faux-local Date makes a booking render at its Tokyo hour on any browser
 * (a 10:00 JST pickup shows at 10:00, not the viewer's local offset). The shift is
 * confined to the rbc/timeline edge; the CalendarItem model stays true-instant, so
 * every text formatter still pins JST via `timeZone` (no double shift).
 */
export function instantToJstFauxLocal(instant: Date): Date {
  const jst = new Date(instant.getTime() + JST_OFFSET_MS)
  return new Date(
    jst.getUTCFullYear(),
    jst.getUTCMonth(),
    jst.getUTCDate(),
    jst.getUTCHours(),
    jst.getUTCMinutes(),
    jst.getUTCSeconds(),
    jst.getUTCMilliseconds(),
  )
}

/**
 * The JST calendar day of "now" as a browser-local Date at local midnight — the
 * anchor the operator calendar's TODAY button and its `?date=` fallback resolve to.
 * On an off-JST browser near midnight, `new Date()`'s local day can differ from the
 * Tokyo day the operator works in; this pins it to JST (#1250).
 */
export function todayInJst(): Date {
  const jstNow = instantToJstFauxLocal(new Date())
  return new Date(jstNow.getFullYear(), jstNow.getMonth(), jstNow.getDate())
}
