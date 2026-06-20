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

/** One document is expiring-soon or already expired as of `todayIso`. A missing
 *  (UNKNOWN) date is excluded — see `isNonCompliant`. */
function needsAttention(expiryDate: string | null, todayIso: string): boolean {
  const status = computeExpiryStatus(expiryDate, todayIso)
  return status === 'EXPIRING_SOON' || status === 'EXPIRED'
}

/**
 * Whether a vehicle needs the operator's compliance attention: its shaken OR
 * insurance certificate is expiring within `EXPIRY_SOON_DAYS` or already expired.
 * The named rule behind the dashboard banner, the fleet `expiringSoon` facet, and
 * the fleet filter, so all three count the same set. A MISSING (null) date is NOT
 * counted — whether legacy null-doc cars should surface here is the open #998
 * item-2 product call; this is the single place to change it.
 */
export function isNonCompliant(
  vehicle: { shakenExpiryDate: string | null; insuranceExpiryDate: string | null },
  todayIso: string,
): boolean {
  return (
    needsAttention(vehicle.shakenExpiryDate, todayIso) ||
    needsAttention(vehicle.insuranceExpiryDate, todayIso)
  )
}
