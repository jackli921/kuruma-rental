/**
 * Build-time gates for post-MVP features (beta demo = canonical MVP only).
 *
 * Every feature below was BUILT but sits outside the MVP we committed to, so it is
 * a billable add-on rather than something the beta demo should show. Beta builds
 * ship them OFF so the demo mirrors the contracted scope; a full/paid build opts
 * each one in by baking the matching `VITE_FEATURE_*` var to the literal `'true'`.
 *
 * The `'true'`-only interpretation lives in `isEnvTrue` (`./env-flag`), shared with
 * the runtime-flag fallback so the two readers can never disagree on a value.
 */
import { isEnvTrue } from './env-flag'

/** Renter + operator self-service cancellation, tiered fees, reason capture (#868). */
export function isCancellationEnabled(): boolean {
  return isEnvTrue(import.meta.env.VITE_FEATURE_CANCELLATION)
}

/** Operator-created walk-in / manual bookings (#589). */
export function isOperatorManualBookingEnabled(): boolean {
  return isEnvTrue(import.meta.env.VITE_FEATURE_OPERATOR_MANUAL_BOOKING)
}

/** Operator self-service staff invites + team management (#904). */
export function isOperatorTeamEnabled(): boolean {
  return isEnvTrue(import.meta.env.VITE_FEATURE_OPERATOR_TEAM)
}

/** Operator self-service business settings (#903). */
export function isOperatorSettingsEnabled(): boolean {
  return isEnvTrue(import.meta.env.VITE_FEATURE_OPERATOR_SETTINGS)
}

/** Renter identity-document upload + verification (#459). Orphaned by instant-book. */
export function isRenterDocumentsEnabled(): boolean {
  return isEnvTrue(import.meta.env.VITE_FEATURE_RENTER_DOCUMENTS)
}

/** In-app renter<->operator messaging (#1032). Hidden in beta; owner previews via admin bypass. */
export function isMessagingEnabled(): boolean {
  return isEnvTrue(import.meta.env.VITE_FEATURE_MESSAGING)
}

/**
 * Operator scheduled vehicle blocks (#1101). Backend-only today; reserved so the
 * operator UI is born gated when it lands. Hidden in beta; owner previews via bypass.
 */
export function isOperatorBlocksEnabled(): boolean {
  return isEnvTrue(import.meta.env.VITE_FEATURE_OPERATOR_BLOCKS)
}

/**
 * Reviews (#1083-1086): renter post-trip prompt, operator rate-renter panel, and the
 * public rating badges on storefront/vehicle cards. Straight flag (no admin-bypass
 * preview) — the badges render on public pages that carry no viewer role, so the
 * feature is uniformly on/off rather than per-viewer.
 */
export function isReviewsEnabled(): boolean {
  return isEnvTrue(import.meta.env.VITE_FEATURE_REVIEWS)
}

/**
 * Operator fleet-timeline planning board (#1100): the multi-day vehicle-vs-time
 * grid and its default landing view. Gated OFF for the beta MVP — the operator
 * calendar falls back to the week grid and the timeline view drops out of the
 * view switcher. Straight flag; the calendar is operator-only, so the view set
 * is uniformly on/off rather than per-viewer.
 */
export function isFleetTimelineEnabled(): boolean {
  return isEnvTrue(import.meta.env.VITE_FEATURE_FLEET_TIMELINE)
}

/**
 * Multi-currency indicative display (#1070): the navbar display-currency picker
 * and the "≈ $X" ballpark notes shown beneath the authoritative JPY price. Gated
 * OFF for the beta MVP — every price shows JPY alone, exactly as before the feature
 * landed. The JPY charge is always authoritative, so gating removes only the
 * secondary conversion display, never a price. Straight flag (public renter pages
 * carry no viewer role).
 */
export function isMultiCurrencyEnabled(): boolean {
  return isEnvTrue(import.meta.env.VITE_FEATURE_MULTI_CURRENCY)
}
