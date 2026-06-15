// Pure time/price helpers shared by the booking creation and lifecycle services
// (#713 split). Kept in one place so substitution re-pricing and initial pricing
// round insurance days identically.

export const MS_PER_MINUTE = 60 * 1000
// Module-local: only rentalDays() below needs it; other modules define their own.
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE

// Insurance is priced per rental day (ceil), min 1 — matches the daily-rate
// rounding the base price uses for whole-day rentals.
export function rentalDays(startAt: Date, endAt: Date): number {
  return Math.max(1, Math.ceil((endAt.getTime() - startAt.getTime()) / MS_PER_DAY))
}

// The single composition of a booking's totalPrice: base + insurance-per-day ×
// days + every selected add-on's flat charge. Both initial creation and
// substitute() re-pricing MUST go through here so they can never desync — #855
// was a silent undercharge on every vehicle swap because the add-on term was
// folded into one path and not the other (#862). Pure: unit-tested once, both
// call sites provably identical (Functional Core / Imperative Shell).
export function composeBookingTotal(input: {
  baseJpy: number
  insurancePerDayJpy: number
  days: number
  addOns: ReadonlyArray<{ priceJpy: number }>
}): number {
  const addOnsJpy = input.addOns.reduce((sum, addOn) => sum + addOn.priceJpy, 0)
  return input.baseJpy + input.insurancePerDayJpy * input.days + addOnsJpy
}
