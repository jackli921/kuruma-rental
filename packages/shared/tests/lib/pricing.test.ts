import { describe, expect, test } from 'vitest'
import { calculateBookingPrice, composeBookingTotal, rentalDays } from '../../src/lib/pricing'

describe('calculateBookingPrice', () => {
  test('hourly-only rate, 1h duration → 1 × hourly rate', () => {
    const result = calculateBookingPrice(
      { dailyRateJpy: null, hourlyRateJpy: 1500 },
      new Date('2026-05-10T10:00:00Z'),
      new Date('2026-05-10T11:00:00Z'),
    )

    expect(result).toEqual({
      ok: true,
      totalPriceJpy: 1500,
      breakdown: { days: 0, remainderHours: 1, dailyRateJpy: 0, hourlyRateJpy: 1500 },
    })
  })

  test('hourly-only rate, 3h duration → 3 × hourly rate', () => {
    const result = calculateBookingPrice(
      { dailyRateJpy: null, hourlyRateJpy: 1500 },
      new Date('2026-05-10T10:00:00Z'),
      new Date('2026-05-10T13:00:00Z'),
    )

    expect(result).toEqual({
      ok: true,
      totalPriceJpy: 4500,
      breakdown: { days: 0, remainderHours: 3, dailyRateJpy: 0, hourlyRateJpy: 1500 },
    })
  })

  test('daily-only rate, exactly 24h → 1 × daily rate', () => {
    const result = calculateBookingPrice(
      { dailyRateJpy: 12000, hourlyRateJpy: null },
      new Date('2026-05-10T10:00:00Z'),
      new Date('2026-05-11T10:00:00Z'),
    )

    expect(result).toEqual({
      ok: true,
      totalPriceJpy: 12000,
      breakdown: { days: 1, remainderHours: 0, dailyRateJpy: 12000, hourlyRateJpy: 0 },
    })
  })

  test('daily-only rate, 25h duration rounds up → 2 × daily', () => {
    const result = calculateBookingPrice(
      { dailyRateJpy: 12000, hourlyRateJpy: null },
      new Date('2026-05-10T10:00:00Z'),
      new Date('2026-05-11T11:00:00Z'),
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.totalPriceJpy).toBe(24000)
      expect(result.breakdown.days).toBe(2)
    }
  })

  test('both rates set, 26h → 1 day + 2 hours (remainder cheaper than capping)', () => {
    // daily = 12000, hourly = 1500. 2 remainder hours × 1500 = 3000 < 12000 daily cap.
    // So price = 1 × 12000 + 2 × 1500 = 15000.
    const result = calculateBookingPrice(
      { dailyRateJpy: 12000, hourlyRateJpy: 1500 },
      new Date('2026-05-10T10:00:00Z'),
      new Date('2026-05-11T12:00:00Z'),
    )

    expect(result).toEqual({
      ok: true,
      totalPriceJpy: 15000,
      breakdown: { days: 1, remainderHours: 2, dailyRateJpy: 12000, hourlyRateJpy: 1500 },
    })
  })

  test('both rates null → NO_RATES_SET error', () => {
    const result = calculateBookingPrice(
      { dailyRateJpy: null, hourlyRateJpy: null },
      new Date('2026-05-10T10:00:00Z'),
      new Date('2026-05-11T10:00:00Z'),
    )

    expect(result).toEqual({ ok: false, code: 'NO_RATES_SET' })
  })

  test('endAt equals startAt → INVALID_DURATION error', () => {
    const result = calculateBookingPrice(
      { dailyRateJpy: 12000, hourlyRateJpy: 1500 },
      new Date('2026-05-10T10:00:00Z'),
      new Date('2026-05-10T10:00:00Z'),
    )

    expect(result).toEqual({ ok: false, code: 'INVALID_DURATION' })
  })

  test('endAt before startAt → INVALID_DURATION error', () => {
    const result = calculateBookingPrice(
      { dailyRateJpy: 12000, hourlyRateJpy: 1500 },
      new Date('2026-05-11T10:00:00Z'),
      new Date('2026-05-10T10:00:00Z'),
    )

    expect(result).toEqual({ ok: false, code: 'INVALID_DURATION' })
  })

  test('sub-hour duration rounds up to 1 hour at hourly rate', () => {
    // 20-minute booking — customer pays for a full hour.
    const result = calculateBookingPrice(
      { dailyRateJpy: null, hourlyRateJpy: 1500 },
      new Date('2026-05-10T10:00:00Z'),
      new Date('2026-05-10T10:20:00Z'),
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.totalPriceJpy).toBe(1500)
      expect(result.breakdown.remainderHours).toBe(1)
    }
  })

  test('both rates set, remainder hourly exceeds daily → cap remainder at daily rate', () => {
    // daily = 10000, hourly = 2000. 10h remainder × 2000 = 20000, which is > 10000 daily.
    // Remainder should cap at 10000 (i.e. customer never pays more for a partial day
    // than for a full day). Final price = 1 × 10000 + 10000 = 20000.
    const result = calculateBookingPrice(
      { dailyRateJpy: 10000, hourlyRateJpy: 2000 },
      new Date('2026-05-10T10:00:00Z'),
      new Date('2026-05-11T20:00:00Z'), // 34h total
    )

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.totalPriceJpy).toBe(20000)
      expect(result.breakdown.days).toBe(1)
      expect(result.breakdown.remainderHours).toBe(10)
    }
  })
})

describe('rentalDays', () => {
  test('whole days → exact day count', () => {
    expect(rentalDays(new Date('2026-07-01T10:00:00Z'), new Date('2026-07-03T10:00:00Z'))).toBe(2)
  })

  test('a partial day rounds up (insurance is billed per started day)', () => {
    expect(rentalDays(new Date('2026-07-01T10:00:00Z'), new Date('2026-07-03T11:00:00Z'))).toBe(3)
  })

  test('a sub-day rental still bills one day (min 1)', () => {
    expect(rentalDays(new Date('2026-07-01T10:00:00Z'), new Date('2026-07-01T11:00:00Z'))).toBe(1)
  })
})

describe('composeBookingTotal', () => {
  test('returns the bare base with no insurance and no add-ons', () => {
    expect(
      composeBookingTotal({ baseJpy: 30000, insurancePerDayJpy: 0, days: 3, addOns: [] }),
    ).toBe(30000)
  })

  test('adds insurance priced per rental day', () => {
    // 30000 + 1500/day * 3 days = 34500
    expect(
      composeBookingTotal({ baseJpy: 30000, insurancePerDayJpy: 1500, days: 3, addOns: [] }),
    ).toBe(34500)
  })

  test('sums every selected add-on as a flat per-booking charge', () => {
    // 30000 + (2000 + 3000) = 35000 — the #855 swap-undercharge guard.
    expect(
      composeBookingTotal({
        baseJpy: 30000,
        insurancePerDayJpy: 0,
        days: 3,
        addOns: [{ priceJpy: 2000 }, { priceJpy: 3000 }],
      }),
    ).toBe(35000)
  })

  test('composes base + insurance-days + add-ons together', () => {
    // 30000 + 1500*2 + 2500 = 35500
    expect(
      composeBookingTotal({
        baseJpy: 30000,
        insurancePerDayJpy: 1500,
        days: 2,
        addOns: [{ priceJpy: 2500 }],
      }),
    ).toBe(35500)
  })
})
