/**
 * Build-time gates for post-MVP features (beta demo = canonical MVP only).
 *
 * Every feature below was BUILT but sits outside the MVP we committed to, so it is
 * a billable add-on rather than something the beta demo should show. Beta builds
 * ship them OFF so the demo mirrors the contracted scope; a full/paid build opts
 * each one in by baking the matching `VITE_FEATURE_*` var to the literal `'true'`.
 *
 * Strict-string on purpose: only `'true'` enables a flag, so a missing or typo'd
 * value fails safe to OFF — a billable feature must never leak on by accident. This
 * mirrors the sibling search-map gate in `vite/search/flags.ts` (#885).
 */
function isEnabled(value: string | undefined): boolean {
  return value === 'true'
}

/** Renter + operator self-service cancellation, tiered fees, reason capture (#868). */
export function isCancellationEnabled(): boolean {
  return isEnabled(import.meta.env.VITE_FEATURE_CANCELLATION)
}

/** Operator-created walk-in / manual bookings (#589). */
export function isOperatorManualBookingEnabled(): boolean {
  return isEnabled(import.meta.env.VITE_FEATURE_OPERATOR_MANUAL_BOOKING)
}

/** Operator self-service staff invites + team management (#904). */
export function isOperatorTeamEnabled(): boolean {
  return isEnabled(import.meta.env.VITE_FEATURE_OPERATOR_TEAM)
}

/** Operator self-service business settings (#903). */
export function isOperatorSettingsEnabled(): boolean {
  return isEnabled(import.meta.env.VITE_FEATURE_OPERATOR_SETTINGS)
}

/** Renter identity-document upload + verification (#459). Orphaned by instant-book. */
export function isRenterDocumentsEnabled(): boolean {
  return isEnabled(import.meta.env.VITE_FEATURE_RENTER_DOCUMENTS)
}
