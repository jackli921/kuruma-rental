import { computeExpiryStatus } from './expiry'

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
