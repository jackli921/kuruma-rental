// Pricing helpers for the booking creation and lifecycle services (#713 split).
// rentalDays + composeBookingTotal now live in @kuruma/shared/lib/pricing (#867)
// so the web reservation estimate composes the booking total through the exact
// same function as the server's authoritative charge — re-exported here so the
// existing service + test import lines stay untouched.
export { composeBookingTotal, rentalDays } from '@kuruma/shared/lib/pricing'

// Turnaround buffer math (booking-creation effectiveEndAt) — API-only, stays here.
export const MS_PER_MINUTE = 60 * 1000
