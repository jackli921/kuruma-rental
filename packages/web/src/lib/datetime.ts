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
