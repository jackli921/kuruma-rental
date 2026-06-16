import {
  type VehicleRates,
  calculateBookingPrice,
  composeBookingTotal,
  rentalDays,
} from '@kuruma/shared/lib/pricing'

// Re-exported so DateRangeStep can keep importing rentalDays from this module.
export { rentalDays }

export interface ReservationEstimateInput {
  vehicle: VehicleRates
  from: Date
  to: Date
  /** Per-day price of the chosen insurance option, or null when none selected. */
  insuranceDailyPriceJpy: number | null
  /** Flat per-booking prices of the chosen add-ons (one of each; quantity is MVP-out). */
  addOnPricesJpy: readonly number[]
}

export interface ReservationEstimate {
  baseJpy: number
  insuranceJpy: number
  addOnsJpy: number
  totalJpy: number
}

/**
 * Client-side price estimate for the reservation wizard (#460). Mirrors the
 * server total: base off the assigned vehicle's rates, insurance at
 * `dailyPrice × rentalDays`, each add-on flat. The total is composed through the
 * shared `composeBookingTotal` (#867) — the same function the API uses for the
 * authoritative charge — so the renter's up-front quote can never desync from it.
 *
 * Fees are intentionally excluded — they live on `feeSnapshot` as informational
 * post-rental charges and are never added to `totalPrice`. The authoritative
 * charge is recomputed server-side at booking (#461); this is the renter's
 * up-front estimate.
 */
export function estimateReservation(input: ReservationEstimateInput): ReservationEstimate {
  const pricing = calculateBookingPrice(input.vehicle, input.from, input.to)
  const baseJpy = pricing.ok ? pricing.totalPriceJpy : 0
  const days = rentalDays(input.from, input.to)
  const insurancePerDayJpy = input.insuranceDailyPriceJpy ?? 0
  const insuranceJpy = insurancePerDayJpy * days
  const addOnsJpy = input.addOnPricesJpy.reduce((sum, price) => sum + price, 0)
  const totalJpy = composeBookingTotal({
    baseJpy,
    insurancePerDayJpy,
    days,
    addOns: input.addOnPricesJpy.map((priceJpy) => ({ priceJpy })),
  })
  return { baseJpy, insuranceJpy, addOnsJpy, totalJpy }
}
