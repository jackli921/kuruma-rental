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
