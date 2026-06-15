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

  if (daily == null && hourly != null) {
    return {
      ok: true,
      totalPriceJpy: hours * hourly,
      breakdown: { days: 0, remainderHours: hours, dailyRateJpy: 0, hourlyRateJpy: hourly },
    }
  }

  if (hourly == null && daily != null) {
    // daily-only path — round partial days up
    const days = Math.ceil(hours / HOURS_PER_DAY)
    return {
      ok: true,
      totalPriceJpy: days * daily,
      breakdown: { days, remainderHours: 0, dailyRateJpy: daily, hourlyRateJpy: 0 },
    }
  }

  // Both rates set — whole days at daily rate, remainder at hourly rate,
  // but a partial-day remainder is never more expensive than the daily rate.
  // Guard narrows both to non-null (the both-null + single-null branches
  // above already returned, but TS can't see through compound guards).
  if (daily == null || hourly == null) {
    return { ok: false, code: 'NO_RATES_SET' }
  }

  const days = Math.floor(hours / HOURS_PER_DAY)
  const remainderHours = hours - days * HOURS_PER_DAY
  const remainderPrice = Math.min(remainderHours * hourly, daily)
  return {
    ok: true,
    totalPriceJpy: days * daily + remainderPrice,
    breakdown: { days, remainderHours, dailyRateJpy: daily, hourlyRateJpy: hourly },
  }
}

// Rental length in whole days (ceil, min 1) — the unit insurance is billed in,
// matching the daily-rate rounding the base price uses for whole-day rentals.
export function rentalDays(startAt: Date, endAt: Date): number {
  return Math.max(1, Math.ceil((endAt.getTime() - startAt.getTime()) / (HOURS_PER_DAY * HOUR_MS)))
}

// The single composition of a booking's totalPrice: base + insurance-per-day ×
// days + every selected add-on's flat charge. The API (initial creation and
// substitute() re-pricing) and the web reservation estimate BOTH compose through
// here so the renter's up-front quote can never desync from the server's
// authoritative charge — #855 was a silent undercharge when the add-on term was
// folded into one path and not the other (#862, #867). Pure (FC/IS): unit-tested
// once, every call site provably identical.
export function composeBookingTotal(input: {
  baseJpy: number
  insurancePerDayJpy: number
  days: number
  addOns: ReadonlyArray<{ priceJpy: number }>
}): number {
  const addOnsJpy = input.addOns.reduce((sum, addOn) => sum + addOn.priceJpy, 0)
  return input.baseJpy + input.insurancePerDayJpy * input.days + addOnsJpy
}
