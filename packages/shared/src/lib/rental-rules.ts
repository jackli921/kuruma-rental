// Per-vehicle rental rules. The owner declares these on each vehicle (#50);
// this helper enforces them at booking time and is also called client-side
// so the time picker can disable submit with a translated hint before the
// request even leaves the browser. Both callers must agree, so this is the
// single source of truth for "does this time range satisfy this vehicle's
// rules" — don't duplicate the math anywhere else.

export type RentalRuleCode =
  | 'RENTAL_RULE_ADVANCE_BOOKING'
  | 'RENTAL_RULE_MIN_DURATION'
  | 'RENTAL_RULE_MAX_DURATION'

export type RentalRulesResult =
  | { ok: true }
  | {
      ok: false
      code: RentalRuleCode
      // Hours the rule requires (e.g. min=4, max=72, advance=24).
      required: number
      // Hours actually present in the booking (duration or advance offset).
      actual: number
    }

export interface RentalRules {
  minRentalHours: number | null
  maxRentalHours: number | null
  advanceBookingHours: number | null
}

const HOURS_MS = 60 * 60 * 1000

export function checkRentalRules(
  rules: RentalRules,
  startAt: Date,
  endAt: Date,
  now: Date,
): RentalRulesResult {
  const hoursUntilStart = (startAt.getTime() - now.getTime()) / HOURS_MS
  const durationHours = (endAt.getTime() - startAt.getTime()) / HOURS_MS

  // Order matters: advance-booking failures are the hardest to fix (renter
  // must move the start date) so we surface them first. Min/max duration
  // are reported after — those are fixable by extending or shortening the
  // return time. If both advance and duration fail we still only report
  // one code (the API error shape is a single code + details).
  if (rules.advanceBookingHours != null && hoursUntilStart < rules.advanceBookingHours) {
    return {
      ok: false,
      code: 'RENTAL_RULE_ADVANCE_BOOKING',
      required: rules.advanceBookingHours,
      actual: hoursUntilStart,
    }
  }

  if (rules.minRentalHours != null && durationHours < rules.minRentalHours) {
    return {
      ok: false,
      code: 'RENTAL_RULE_MIN_DURATION',
      required: rules.minRentalHours,
      actual: durationHours,
    }
  }

  if (rules.maxRentalHours != null && durationHours > rules.maxRentalHours) {
    return {
      ok: false,
      code: 'RENTAL_RULE_MAX_DURATION',
      required: rules.maxRentalHours,
      actual: durationHours,
    }
  }

  return { ok: true }
}
