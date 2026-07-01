const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * The UTC bounds of the JST calendar day that `now` falls in, half-open
 * [startUtc, endUtc). All operators are Japan/JST (fixed +9h, no DST), so
 * "today" for a dispatch board is the JST day — a booking at 23:30 JST belongs
 * to that JST day even though it is already tomorrow in UTC. Single source for
 * the #1102 pickup/return buckets so the Drizzle range predicate and the
 * in-memory filter agree to the millisecond.
 */
export function jstDayRangeUtc(now: Date): { startUtc: Date; endUtc: Date } {
  const jstDate = new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10)
  const startUtc = new Date(Date.parse(`${jstDate}T00:00:00.000Z`) - JST_OFFSET_MS)
  return { startUtc, endUtc: new Date(startUtc.getTime() + MS_PER_DAY) }
}
