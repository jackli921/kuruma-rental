import { type VehicleRates, calculateBookingPrice } from '@kuruma/shared/lib/pricing'

const MS_PER_DAY = 24 * 60 * 60 * 1000

/**
 * Rental length in whole days (ceil, min 1) — the unit insurance is billed in.
 * Mirrors the API's private `rentalDays` (services/booking.ts) so the wizard's
 * insurance line matches the eventual server charge.
 */
export function rentalDays(from: Date, to: Date): number {
  return Math.max(1, Math.ceil((to.getTime() - from.getTime()) / MS_PER_DAY))
}

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
 * server total (services/booking.ts `submitInTx`): base off the assigned
 * vehicle's rates, insurance at `dailyPrice × rentalDays`, each add-on flat.
 *
 * Fees are intentionally excluded — they live on `feeSnapshot` as informational
 * post-rental charges and are never added to `totalPrice`. The authoritative
 * charge is recomputed server-side at booking (#461); this is the renter's
 * up-front estimate.
 */
export function estimateReservation(input: ReservationEstimateInput): ReservationEstimate {
  const pricing = calculateBookingPrice(input.vehicle, input.from, input.to)
  const baseJpy = pricing.ok ? pricing.totalPriceJpy : 0
  const insuranceJpy =
    input.insuranceDailyPriceJpy != null
      ? input.insuranceDailyPriceJpy * rentalDays(input.from, input.to)
      : 0
  const addOnsJpy = input.addOnPricesJpy.reduce((sum, price) => sum + price, 0)
  return { baseJpy, insuranceJpy, addOnsJpy, totalJpy: baseJpy + insuranceJpy + addOnsJpy }
}
