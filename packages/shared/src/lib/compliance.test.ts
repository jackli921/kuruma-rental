import { describe, expect, test } from 'vitest'

import { isDocCurrent, isRoadLegal, jstDateString } from './compliance'

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
