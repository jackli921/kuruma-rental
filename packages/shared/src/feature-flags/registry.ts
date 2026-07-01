// Single source of truth for the runtime feature-flag key set.
//
// The API, the web bundle, and the feature_flags table all agree on this exact
// key set (and each flag's build-time env var) via this one registry, so no side
// can drift. A runtime override in the DB layers on top of the build-time env
// default: effective(key) = dbOverride[key] ?? buildTimeDefault[key] ?? false.
//
// One row per existing VITE_FEATURE_* flag. VITE_SEARCH_MAP_ENABLED is not a
// VITE_FEATURE_ flag and stays out of the runtime control plane.
// See docs/plans/2026-06-30-runtime-feature-flags.md.
export const FEATURE_FLAGS = {
  CANCELLATION: { env: 'VITE_FEATURE_CANCELLATION', label: 'Self-service cancellation' },
  OPERATOR_MANUAL_BOOKING: {
    env: 'VITE_FEATURE_OPERATOR_MANUAL_BOOKING',
    label: 'Operator manual booking',
  },
  OPERATOR_TEAM: { env: 'VITE_FEATURE_OPERATOR_TEAM', label: 'Operator team management' },
  OPERATOR_SETTINGS: { env: 'VITE_FEATURE_OPERATOR_SETTINGS', label: 'Operator settings' },
  RENTER_DOCUMENTS: { env: 'VITE_FEATURE_RENTER_DOCUMENTS', label: 'Renter document upload' },
  MESSAGING: { env: 'VITE_FEATURE_MESSAGING', label: 'Renter–operator messaging' },
  OPERATOR_BLOCKS: { env: 'VITE_FEATURE_OPERATOR_BLOCKS', label: 'Maintenance blocks' },
  REVIEWS: { env: 'VITE_FEATURE_REVIEWS', label: 'Reviews & ratings' },
  FLEET_TIMELINE: { env: 'VITE_FEATURE_FLEET_TIMELINE', label: 'Fleet timeline board' },
  MULTI_CURRENCY: { env: 'VITE_FEATURE_MULTI_CURRENCY', label: 'Multi-currency display' },
} as const

export type FeatureFlagKey = keyof typeof FEATURE_FLAGS
export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]

/** A sparse override map: only keys the platform admin has explicitly set. */
export type FeatureFlagOverrides = Partial<Record<FeatureFlagKey, boolean>>

export function isFeatureFlagKey(value: string): value is FeatureFlagKey {
  return Object.hasOwn(FEATURE_FLAGS, value)
}
