import { describe, expect, test } from 'vitest'

import {
  complianceThresholdBand,
  isDocCurrent,
  isNonCompliant,
  isRoadLegal,
  jstDateString,
} from './compliance'
import { EXPIRY_SOON_DAYS, computeExpiryStatus } from './expiry'

function addDays(iso: string, days: number): string {
  const d = new Date(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * §5.1 compliance predicate. A shaken/insurance certificate is valid THROUGH
 * its printed expiry date (legal boundary, §4): current when `expiry >= asOf`,
 * expired only the day after. A missing date (UNKNOWN) is NOT road-legal — a
 * marketplace listing must be a valid, road-legal car (§11.1).
 */
describe('isDocCurrent', () => {
  test('is current when asOf equals the expiry date (valid through expiry)', () => {
    expect(isDocCurrent('2026-06-30', '2026-06-30')).toBe(true)
  })

  test('is not current the day after expiry', () => {
    expect(isDocCurrent('2026-06-30', '2026-07-01')).toBe(false)
  })

  test('is current well before expiry', () => {
    expect(isDocCurrent('2027-01-01', '2026-06-17')).toBe(true)
  })

  test('a missing date (UNKNOWN) is not current', () => {
    expect(isDocCurrent(null, '2026-06-17')).toBe(false)
  })
})

describe('isRoadLegal', () => {
  const asOf = '2026-06-17'

  test('is road-legal when both shaken and insurance are current', () => {
    expect(
      isRoadLegal({ shakenExpiryDate: '2026-07-01', insuranceExpiryDate: '2026-08-01' }, asOf),
    ).toBe(true)
  })

  test('is not road-legal when shaken has expired', () => {
    expect(
      isRoadLegal({ shakenExpiryDate: '2026-06-16', insuranceExpiryDate: '2026-08-01' }, asOf),
    ).toBe(false)
  })

  test('is not road-legal when insurance is missing', () => {
    expect(isRoadLegal({ shakenExpiryDate: '2026-07-01', insuranceExpiryDate: null }, asOf)).toBe(
      false,
    )
  })
})

/**
 * #998 item 3. The "needs operator attention" rule (a vehicle whose shaken OR
 * insurance is expiring-soon or already expired) is named once so the dashboard
 * banner, the fleet `expiringSoon` facet, and the fleet filter can't drift. A
 * MISSING (null) date is deliberately NOT counted yet — whether a legacy null-doc
 * car should surface as non-compliant is the open #998 item-2 product call; when
 * decided, this predicate is the single place to change.
 */
describe('isNonCompliant', () => {
  const TODAY = '2026-04-12'
  const OK = '2028-12-31'
  const EXPIRING = '2026-05-12' // exactly 30 days out
  const EXPIRED = '2026-04-11' // yesterday

  test('flags a vehicle whose shaken is expiring soon', () => {
    expect(isNonCompliant({ shakenExpiryDate: EXPIRING, insuranceExpiryDate: OK }, TODAY)).toBe(
      true,
    )
  })

  test('flags a vehicle whose insurance has expired', () => {
    expect(isNonCompliant({ shakenExpiryDate: OK, insuranceExpiryDate: EXPIRED }, TODAY)).toBe(true)
  })

  test('does not flag a vehicle with both documents well in date', () => {
    expect(isNonCompliant({ shakenExpiryDate: OK, insuranceExpiryDate: OK }, TODAY)).toBe(false)
  })

  test('does not flag a vehicle with a missing date (UNKNOWN excluded — #998 item 2)', () => {
    expect(isNonCompliant({ shakenExpiryDate: null, insuranceExpiryDate: OK }, TODAY)).toBe(false)
    expect(isNonCompliant({ shakenExpiryDate: null, insuranceExpiryDate: null }, TODAY)).toBe(false)
  })
})

/**
 * §4 "one clock" — the gates compare a rental instant (timestamptz) against a
 * `date` certificate, so the instant is projected to its JST calendar day
 * (UTC+9) before comparison. All operators are Japan/JST.
 */
describe('jstDateString', () => {
  test('an evening-UTC instant rolls into the next JST day', () => {
    expect(jstDateString(new Date('2026-06-30T20:00:00Z'))).toBe('2026-07-01')
  })

  test('an afternoon-UTC instant stays on the same JST day', () => {
    expect(jstDateString(new Date('2026-06-30T14:00:00Z'))).toBe('2026-06-30')
  })

  test('15:00Z is exactly JST midnight — the next day', () => {
    expect(jstDateString(new Date('2026-06-30T15:00:00Z'))).toBe('2026-07-01')
  })

  test('one second before JST midnight is still the same day', () => {
    expect(jstDateString(new Date('2026-06-30T14:59:59Z'))).toBe('2026-06-30')
  })
})

/**
 * §5.4 digest band mapping (pure). Which alert band a certificate's expiry falls
 * into as of a JST `today`. Bands are mutually exclusive and tighten as the date
 * nears (30 -> 14 -> 7 -> 1 -> EXPIRED), so a vehicle fires at most once per band
 * — idempotency is keyed on the band. A missing date is MISSING (§11.1); more
 * than 30 days out is null (no alert yet).
 */
describe('complianceThresholdBand', () => {
  const today = '2026-06-17'

  test('a missing date is MISSING', () => {
    expect(complianceThresholdBand(null, today)).toBe('MISSING')
  })

  test('a date in the past is EXPIRED', () => {
    expect(complianceThresholdBand('2026-06-16', today)).toBe('EXPIRED')
  })

  test('expiring today is the tightest day-band D1 (not yet expired)', () => {
    expect(complianceThresholdBand('2026-06-17', today)).toBe('D1')
  })

  test('expiring tomorrow is D1', () => {
    expect(complianceThresholdBand('2026-06-18', today)).toBe('D1')
  })

  test('two days out crosses into D7', () => {
    expect(complianceThresholdBand('2026-06-19', today)).toBe('D7')
  })

  test('exactly 7 days out is D7', () => {
    expect(complianceThresholdBand('2026-06-24', today)).toBe('D7')
  })

  test('8 days out is D14', () => {
    expect(complianceThresholdBand('2026-06-25', today)).toBe('D14')
  })

  test('exactly 14 days out is D14', () => {
    expect(complianceThresholdBand('2026-07-01', today)).toBe('D14')
  })

  test('15 days out is D30', () => {
    expect(complianceThresholdBand('2026-07-02', today)).toBe('D30')
  })

  test('exactly 30 days out is D30', () => {
    expect(complianceThresholdBand('2026-07-17', today)).toBe('D30')
  })

  test('31 days out is null — no alert yet', () => {
    expect(complianceThresholdBand('2026-07-18', today)).toBeNull()
  })
})

/**
 * #998 item 1. The digest's outer reminder band and the dashboard/fleet
 * "expiring soon" set must share ONE horizon — else an operator gets digest
 * emails for a window the banner won't reflect (and the deep-link lands on an
 * empty list). The boundary is computed FROM EXPIRY_SOON_DAYS, so bumping the
 * constant without re-linking the digest band fails here instead of diverging
 * silently.
 */
describe('compliance horizon is a single source of truth', () => {
  const today = '2026-06-17'

  test('the outer digest band fires on exactly the banner horizon, not a day off', () => {
    const atHorizon = addDays(today, EXPIRY_SOON_DAYS)
    const pastHorizon = addDays(today, EXPIRY_SOON_DAYS + 1)

    expect(computeExpiryStatus(atHorizon, today)).toBe('EXPIRING_SOON')
    expect(complianceThresholdBand(atHorizon, today)).toBe('D30')

    expect(computeExpiryStatus(pastHorizon, today)).toBe('OK')
    expect(complianceThresholdBand(pastHorizon, today)).toBeNull()
  })
})
