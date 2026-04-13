import { describe, expect, test } from 'vitest'
import { EXPIRY_SOON_DAYS, computeExpiryStatus } from '../../src/lib/expiry'

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
