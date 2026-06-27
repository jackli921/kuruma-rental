import { describe, expect, test } from 'vitest'

import { formatIndicativePrice } from './indicative-price'

/**
 * #1070 indicative multi-currency display. The JPY amount is authoritative and
 * always charged; `formatIndicativePrice` is a pure, display-only ballpark in the
 * renter's chosen currency. `rate` is JPY→currency (USD 0.0067 ⇒ 1 JPY = 0.0067
 * USD), passed in from a server-side daily cache — never fetched here.
 */
describe('formatIndicativePrice', () => {
  test('converts whole yen to the target currency via the rate', () => {
    expect(formatIndicativePrice(10000, 'USD', 0.0067)).toBe('$67')
  })

  test('uses the currencys own symbol, not the dollar sign', () => {
    expect(formatIndicativePrice(10000, 'EUR', 0.006)).toBe('€60')
    expect(formatIndicativePrice(10000, 'CNY', 0.048)).toBe('CN¥480')
    expect(formatIndicativePrice(10000, 'AUD', 0.007)).toBe('A$70')
  })

  test('groups thousands in the converted figure', () => {
    expect(formatIndicativePrice(1_000_000, 'USD', 0.0067)).toBe('$6,700')
  })

  test('rounds to whole currency units (half-up)', () => {
    expect(formatIndicativePrice(1000, 'USD', 0.0067)).toBe('$7') // 6.7 → 7
    expect(formatIndicativePrice(1000, 'USD', 0.0061)).toBe('$6') // 6.1 → 6
  })

  test('shows a zero-yen price as a zero indicative figure', () => {
    expect(formatIndicativePrice(0, 'USD', 0.0067)).toBe('$0')
  })

  test('returns null when the chosen currency is JPY (no self-conversion)', () => {
    expect(formatIndicativePrice(10000, 'JPY', 1)).toBeNull()
  })

  test('returns null when the rate is absent', () => {
    expect(formatIndicativePrice(10000, 'USD', null)).toBeNull()
    expect(formatIndicativePrice(10000, 'USD', undefined)).toBeNull()
  })

  test('returns null for a non-positive or non-finite rate', () => {
    expect(formatIndicativePrice(10000, 'USD', 0)).toBeNull()
    expect(formatIndicativePrice(10000, 'USD', -0.0067)).toBeNull()
    expect(formatIndicativePrice(10000, 'USD', Number.NaN)).toBeNull()
    expect(formatIndicativePrice(10000, 'USD', Number.POSITIVE_INFINITY)).toBeNull()
  })

  test('returns null for a malformed currency code (never throws)', () => {
    expect(formatIndicativePrice(10000, 'DOLLARS', 0.0067)).toBeNull()
    expect(formatIndicativePrice(10000, 'US', 0.0067)).toBeNull()
    expect(formatIndicativePrice(10000, '', 0.0067)).toBeNull()
  })

  test('returns null for a non-finite yen amount', () => {
    expect(formatIndicativePrice(Number.NaN, 'USD', 0.0067)).toBeNull()
    expect(formatIndicativePrice(Number.POSITIVE_INFINITY, 'USD', 0.0067)).toBeNull()
  })
})
