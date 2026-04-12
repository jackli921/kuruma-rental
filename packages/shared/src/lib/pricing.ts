export interface PricingBreakdown {
  days: number
  remainderHours: number
  dailyRateJpy: number
  hourlyRateJpy: number
}

export type PricingResult =
  | { ok: true; totalPriceJpy: number; breakdown: PricingBreakdown }
  | { ok: false; code: 'INVALID_DURATION' | 'NO_RATES_SET' }

export interface VehicleRates {
  dailyRateJpy: number | null
  hourlyRateJpy: number | null
}

const HOUR_MS = 60 * 60 * 1000
const HOURS_PER_DAY = 24

export function calculateBookingPrice(
  vehicle: VehicleRates,
  startAt: Date,
  endAt: Date,
): PricingResult {
  const durationMs = endAt.getTime() - startAt.getTime()
  if (durationMs <= 0) {
    return { ok: false, code: 'INVALID_DURATION' }
  }

  const daily = vehicle.dailyRateJpy
  const hourly = vehicle.hourlyRateJpy
  if (daily == null && hourly == null) {
    return { ok: false, code: 'NO_RATES_SET' }
  }

  const hours = Math.ceil(durationMs / HOUR_MS)

  if (daily == null) {
    const h = hourly ?? 0
    return {
      ok: true,
      totalPriceJpy: hours * h,
      breakdown: { days: 0, remainderHours: hours, dailyRateJpy: 0, hourlyRateJpy: h },
    }
  }

  if (hourly == null) {
    // daily-only path — round partial days up
    const days = Math.ceil(hours / HOURS_PER_DAY)
    return {
      ok: true,
      totalPriceJpy: days * daily,
      breakdown: { days, remainderHours: 0, dailyRateJpy: daily, hourlyRateJpy: 0 },
    }
  }

  // both rates set — whole days at daily rate, remainder at hourly rate,
  // but a partial-day remainder is never more expensive than the daily rate.
  const days = Math.floor(hours / HOURS_PER_DAY)
  const remainderHours = hours - days * HOURS_PER_DAY
  const remainderPrice = Math.min(remainderHours * hourly, daily)
  return {
    ok: true,
    totalPriceJpy: days * daily + remainderPrice,
    breakdown: { days, remainderHours, dailyRateJpy: daily, hourlyRateJpy: hourly },
  }
}
