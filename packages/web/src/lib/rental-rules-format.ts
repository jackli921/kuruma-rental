// Display helpers for per-vehicle rental rules (#65). The owner types values
// in hours but renters read durations in the chunks that feel natural: a
// 72h max becomes "3 days," a 4h minimum stays "4 hours." The unit switch
// lives here so it's consistent across the detail page, the list card
// badge, and the booking form's inline validation.

type TranslateWithCount = (key: string, values: { count: number }) => string

/**
 * Turn a raw hours value into a localized duration string, using days when
 * the value is a clean multiple of 24 and >= 24h. Anything else stays in
 * hours (e.g. 36h → "36 hours" — don't guess "1.5 days" and confuse anyone).
 *
 * Requires two translation keys on the caller's namespace: `hours` and
 * `days`, each an ICU plural message like "{count, plural, one {# hour}
 * other {# hours}}".
 */
export function formatDurationHours(hours: number, t: TranslateWithCount): string {
  if (hours >= 24 && hours % 24 === 0) {
    return t('days', { count: hours / 24 })
  }
  return t('hours', { count: hours })
}

export interface DisplayRentalRules {
  minRentalHours: number | null
  maxRentalHours: number | null
  advanceBookingHours: number | null
}

/**
 * True when at least one rule is set. Used to decide whether to render the
 * rental-rules block at all on the detail page, and whether to show the
 * compact badge on the list card.
 */
export function hasAnyRentalRule(rules: DisplayRentalRules): boolean {
  return (
    rules.minRentalHours != null ||
    rules.maxRentalHours != null ||
    rules.advanceBookingHours != null
  )
}

/**
 * Pick the single "most likely to surprise a renter" rule for the compact
 * list-card badge. Precedence mirrors the API enforcement order so the
 * badge matches the error the renter would hit: advance booking first
 * (can't be fixed by tweaking duration), then min, then max.
 */
export function pickPrimaryRentalRule(
  rules: DisplayRentalRules,
): { code: 'advance' | 'min' | 'max'; hours: number } | null {
  if (rules.advanceBookingHours != null) {
    return { code: 'advance', hours: rules.advanceBookingHours }
  }
  if (rules.minRentalHours != null) {
    return { code: 'min', hours: rules.minRentalHours }
  }
  if (rules.maxRentalHours != null) {
    return { code: 'max', hours: rules.maxRentalHours }
  }
  return null
}
