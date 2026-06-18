import { estimateReservation, rentalDays } from '@/vite/reservation/pricing'
import { describe, expect, it } from 'vitest'

// Wall-clock JST helper so the spans below read as Tokyo times (the booking
// convention), independent of the test runner's timezone.
const jst = (value: string): Date => new Date(`${value}:00+09:00`)

describe('rentalDays', () => {
  it('counts a whole 48h span as 2 days', () => {
    expect(rentalDays(jst('2026-07-01T10:00'), jst('2026-07-03T10:00'))).toBe(2)
  })

  it('rounds a partial day up (25h -> 2 days)', () => {
    expect(rentalDays(jst('2026-07-01T10:00'), jst('2026-07-02T11:00'))).toBe(2)
  })

  it('never returns less than 1 for a sub-day span', () => {
    expect(rentalDays(jst('2026-07-01T10:00'), jst('2026-07-01T11:00'))).toBe(1)
  })
})

describe('estimateReservation', () => {
  const from = jst('2026-07-01T10:00')
  const to = jst('2026-07-03T10:00') // exactly 2 days

  it('bases the total on the daily rate × days when nothing else is selected', () => {
    expect(
      estimateReservation({
        vehicle: { dailyRateJpy: 8000, hourlyRateJpy: null },
        from,
        to,
        insuranceDailyPriceJpy: null,
        addOnPricesJpy: [],
      }),
    ).toEqual({ baseJpy: 16000, insuranceJpy: 0, totalJpy: 16000 })
  })

  it('bills insurance at dailyPrice × rentalDays', () => {
    expect(
      estimateReservation({
        vehicle: { dailyRateJpy: 8000, hourlyRateJpy: null },
        from,
        to,
        insuranceDailyPriceJpy: 1500,
        addOnPricesJpy: [],
      }),
    ).toEqual({ baseJpy: 16000, insuranceJpy: 3000, totalJpy: 19000 })
  })

  it('sums add-on flat prices once each, regardless of rental length', () => {
    expect(
      estimateReservation({
        vehicle: { dailyRateJpy: 8000, hourlyRateJpy: null },
        from,
        to,
        insuranceDailyPriceJpy: null,
        addOnPricesJpy: [2000, 500],
      }),
    ).toEqual({ baseJpy: 16000, insuranceJpy: 0, totalJpy: 18500 })
  })

  it('combines base + insurance + add-ons into the grand total', () => {
    expect(
      estimateReservation({
        vehicle: { dailyRateJpy: 8000, hourlyRateJpy: null },
        from,
        to,
        insuranceDailyPriceJpy: 1500,
        addOnPricesJpy: [2000, 500],
      }),
    ).toEqual({ baseJpy: 16000, insuranceJpy: 3000, totalJpy: 21500 })
  })

  it('uses rental DAYS for insurance even when the vehicle is priced hourly', () => {
    const start = jst('2026-07-01T10:00')
    const end = jst('2026-07-02T11:00') // 25h -> base = 25 × hourly, insurance = 2 days
    expect(
      estimateReservation({
        vehicle: { dailyRateJpy: null, hourlyRateJpy: 1000 },
        from: start,
        to: end,
        insuranceDailyPriceJpy: 1500,
        addOnPricesJpy: [],
      }),
    ).toEqual({ baseJpy: 25000, insuranceJpy: 3000, totalJpy: 28000 })
  })
})
