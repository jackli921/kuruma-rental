import { EXPIRY_SOON_DAYS, computeExpiryStatus } from './expiry'

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

/**
 * §4 "one clock". Project a rental instant (timestamptz) to its JST calendar
 * day (YYYY-MM-DD) — the `asOf` every gate compares against a `date`-typed
 * certificate. All operators are Japan/JST, so a single fixed +9h offset is
 * correct (no DST in Japan).
 */
export function jstDateString(instant: Date): string {
  return new Date(instant.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * §5.1 compliance predicate (pure). Whether a shaken/insurance certificate is
 * still valid as of `asOfIso` (a YYYY-MM-DD JST date). Built on
 * `computeExpiryStatus` so the legal expiry boundary lives in exactly one place:
 * a certificate is valid THROUGH its printed date (`expiry >= asOf`), expired
 * only the day after. A missing date (UNKNOWN, null) is NOT current — a
 * marketplace listing must be a valid, road-legal car (§11.1).
 */
export function isDocCurrent(expiryDate: string | null, asOfIso: string): boolean {
  const status = computeExpiryStatus(expiryDate, asOfIso)
  return status === 'OK' || status === 'EXPIRING_SOON'
}

/** A vehicle's documents (shaken AND insurance) are both current as of the
 *  given JST date. Docs only — `vehicle.status` (operator availability) is a
 *  separate, contextual concern handled at each gate. */
export function isRoadLegal(
  vehicle: { shakenExpiryDate: string | null; insuranceExpiryDate: string | null },
  asOfIso: string,
): boolean {
  return (
    isDocCurrent(vehicle.shakenExpiryDate, asOfIso) &&
    isDocCurrent(vehicle.insuranceExpiryDate, asOfIso)
  )
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

/**
 * §5.4 digest alert bands. MISSING (no recorded date) and EXPIRED (already past)
 * are the two terminal states; D30/D14/D7/D1 are the "days remaining" reminder
 * bands. Idempotency is keyed on the band so a vehicle is alerted at most once
 * per band as its date counts down.
 */
export const COMPLIANCE_ALERT_BANDS = ['MISSING', 'EXPIRED', 'D30', 'D14', 'D7', 'D1'] as const
export type ComplianceAlertBand = (typeof COMPLIANCE_ALERT_BANDS)[number]

/** The two documents the gate + digest treat identically (§D4). */
export const COMPLIANCE_DOCUMENT_TYPES = ['SHAKEN', 'INSURANCE'] as const
export type ComplianceDocumentType = (typeof COMPLIANCE_DOCUMENT_TYPES)[number]

// Ordered tightest-first: the first threshold the date falls within wins, so the
// bands stay mutually exclusive as the expiry nears. The outer band's threshold
// is the shared `EXPIRY_SOON_DAYS` horizon (#998 item 1) so the digest, the
// dashboard banner, and the fleet `expiringSoon` filter alert on one window — the
// `'D30'` label is a stable idempotency key (a DB ledger value), so it does not
// move with the constant; only the threshold value does.
const BAND_THRESHOLD_DAYS = [
  ['D1', 1],
  ['D7', 7],
  ['D14', 14],
  ['D30', EXPIRY_SOON_DAYS],
] as const

const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Whole calendar days between two YYYY-MM-DD dates (both parsed as UTC midnight,
 *  so no DST drift). Positive when `toIso` is after `fromIso`. */
function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(toIso) - Date.parse(fromIso)) / MS_PER_DAY)
}

/**
 * The alert band a shaken/insurance expiry falls into as of `todayIso` (a JST
 * YYYY-MM-DD date), or null when it is more than 30 days out (no alert yet). A
 * date *on* `todayIso` is not yet expired but is the most urgent reminder (D1).
 */
export function complianceThresholdBand(
  expiryDate: string | null,
  todayIso: string,
): ComplianceAlertBand | null {
  if (expiryDate == null) return 'MISSING'
  if (expiryDate < todayIso) return 'EXPIRED'
  const daysRemaining = daysBetween(todayIso, expiryDate)
  for (const [band, threshold] of BAND_THRESHOLD_DAYS) {
    if (daysRemaining <= threshold) return band
  }
  return null
}
