export const EXPIRY_SOON_DAYS = 30

export type ExpiryStatus = 'OK' | 'EXPIRING_SOON' | 'EXPIRED' | 'UNKNOWN'

/** Pure function — pass `todayIso` as YYYY-MM-DD to keep it testable. */
export function computeExpiryStatus(expiryDate: string | null, todayIso: string): ExpiryStatus {
  if (expiryDate == null) return 'UNKNOWN'
  if (expiryDate < todayIso) return 'EXPIRED'

  const threshold = new Date(todayIso)
  threshold.setUTCDate(threshold.getUTCDate() + EXPIRY_SOON_DAYS)
  const thresholdIso = threshold.toISOString().slice(0, 10)

  if (expiryDate <= thresholdIso) return 'EXPIRING_SOON'
  return 'OK'
}
