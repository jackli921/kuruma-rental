import { describe, expect, test } from 'vitest'
import { EXPIRY_SOON_DAYS, computeExpiryStatus, isNonCompliant } from '../../src/lib/expiry'

describe('computeExpiryStatus', () => {
  const TODAY = '2026-04-12'

  test('returns UNKNOWN when date is null', () => {
    expect(computeExpiryStatus(null, TODAY)).toBe('UNKNOWN')
  })

  test('returns EXPIRED when date is yesterday', () => {
    expect(computeExpiryStatus('2026-04-11', TODAY)).toBe('EXPIRED')
  })

  test('returns EXPIRING_SOON when date is today (boundary)', () => {
    expect(computeExpiryStatus('2026-04-12', TODAY)).toBe('EXPIRING_SOON')
  })

  test('returns EXPIRING_SOON when date is 30 days from today (inclusive boundary)', () => {
    expect(computeExpiryStatus('2026-05-12', TODAY)).toBe('EXPIRING_SOON')
  })

  test('returns OK when date is 31 days from today', () => {
    expect(computeExpiryStatus('2026-05-13', TODAY)).toBe('OK')
  })

  test('returns OK when date is far in the future', () => {
    expect(computeExpiryStatus('2028-12-31', TODAY)).toBe('OK')
  })

  test('returns EXPIRED when date is far in the past', () => {
    expect(computeExpiryStatus('2020-01-01', TODAY)).toBe('EXPIRED')
  })

  test('EXPIRY_SOON_DAYS is 30', () => {
    expect(EXPIRY_SOON_DAYS).toBe(30)
  })
})

/**
 * #998 item 3. The "needs operator attention" rule (a vehicle whose shaken OR
 * insurance is expiring-soon or already expired) is named once here so the
 * dashboard banner, the fleet `expiringSoon` facet, and the fleet filter can't
 * drift. A MISSING (null) date is deliberately NOT counted yet — whether a
 * legacy null-doc car should surface as non-compliant is the open #998 item-2
 * product call; when decided, this predicate is the single place to change.
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
