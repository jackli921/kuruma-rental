// Pure formatting helpers shared by the email renderers (FC/IS: pure core).

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/** Escape user/operator-supplied strings before interpolating into email HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch)
}

/** Whole-yen amount with thousands separators, e.g. 2000 -> "¥2,000". */
export function formatJpy(amountJpy: number): string {
  return `¥${new Intl.NumberFormat('en-US').format(amountJpy)}`
}

// Every operator is Japan-based, so booking datetimes render in Japan Standard Time
// (Asia/Tokyo — a fixed UTC+9; Japan observes no DST). A pickup/return is a
// location-anchored event the renter acts on while standing in Japan, and email can't
// detect the recipient's own timezone, so we anchor to the pickup location and always
// label it — never a bare or UTC time (#680). If operators outside Japan are ever
// added, source the zone from the pickup/dropoff location instead of this constant (#818).
const BOOKING_TIME_ZONE = 'Asia/Tokyo'
const BOOKING_TIME_ZONE_LABEL = 'JST'

/** Booking datetime in the pickup location's wall-clock time, labelled — e.g.
 *  "2026-07-01 19:00 JST". Deterministic regardless of the host's own timezone. */
export function formatDateTime(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BOOKING_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')} ${BOOKING_TIME_ZONE_LABEL}`
}
