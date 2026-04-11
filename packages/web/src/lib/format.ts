export function formatDateTime(date: Date | string, locale: string): string {
  const dateObj = typeof date === 'string' ? new Date(date) : date
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Tokyo',
  }).format(dateObj)
}

/**
 * Format a whole-yen integer as a Japanese currency string. `¥8,000`, not
 * `¥8,000.00` — JPY has no minor unit.
 */
export function formatJpy(amount: number): string {
  return new Intl.NumberFormat('ja-JP', {
    style: 'currency',
    currency: 'JPY',
    maximumFractionDigits: 0,
  }).format(amount)
}

/**
 * Render vehicle pricing for display. Either or both of daily / hourly may
 * be set; at least one is guaranteed by the DB CHECK constraint. Returns
 * `null` for the degenerate case where both are null (pre-#48 seed rows).
 *
 * Examples:
 *   (8000, null)  -> "¥8,000/day"
 *   (null, 1200)  -> "¥1,200/hr"
 *   (8000, 1200)  -> "¥8,000/day · ¥1,200/hr"
 */
export function formatVehicleRate(
  dailyRateJpy: number | null,
  hourlyRateJpy: number | null,
  labels: { perDay: string; perHour: string },
): string | null {
  const parts: string[] = []
  if (dailyRateJpy != null) parts.push(`${formatJpy(dailyRateJpy)}${labels.perDay}`)
  if (hourlyRateJpy != null) parts.push(`${formatJpy(hourlyRateJpy)}${labels.perHour}`)
  return parts.length > 0 ? parts.join(' · ') : null
}
