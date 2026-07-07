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
//
// `runtimeControlled` = at least one consumer reads the flag via useFeatureFlag(),
// so a dashboard toggle takes effect live. Flip it to true in the same slice that
// migrates the flag off the build-time isXEnabled() reader (#1322); the admin page
// badges a not-yet-migrated flag as "build-time only" so its toggle isn't mistaken
// for a no-op.
// A registry entry. `env` is the build-time VITE_FEATURE_* var a web flag reads;
// a `serverOnly` flag has NONE (it is enforced by the API and defaults from code,
// not the bundle) and instead carries a `serverDefault` fail-safe floor. Typing
// the registry as Record<Key, FeatureFlagEntry> (below) keeps indexed `.env`
// access uniform even though serverOnly entries omit it.
export type FeatureFlagEntry = {
  env?: string
  label: string
  runtimeControlled: boolean
  // Server-enforced flag with no web build-time env (#1437 SHARED_CATALOG). The
  // web floors it to `serverDefault` rather than a build-time reader; the API
  // reads `serverDefault` as the default when no admin override exists.
  serverOnly?: boolean
  serverDefault?: boolean
}

const REGISTRY = {
  CANCELLATION: {
    env: 'VITE_FEATURE_CANCELLATION',
    label: 'Self-service cancellation',
    runtimeControlled: true,
  },
  OPERATOR_MANUAL_BOOKING: {
    env: 'VITE_FEATURE_OPERATOR_MANUAL_BOOKING',
    label: 'Operator manual booking',
    runtimeControlled: true,
  },
  OPERATOR_TEAM: {
    env: 'VITE_FEATURE_OPERATOR_TEAM',
    label: 'Operator team management',
    runtimeControlled: true,
  },
  OPERATOR_SETTINGS: {
    env: 'VITE_FEATURE_OPERATOR_SETTINGS',
    label: 'Operator settings',
    runtimeControlled: true,
  },
  RENTER_DOCUMENTS: {
    env: 'VITE_FEATURE_RENTER_DOCUMENTS',
    label: 'Renter document upload',
    runtimeControlled: true,
  },
  MESSAGING: {
    env: 'VITE_FEATURE_MESSAGING',
    label: 'Renter–operator messaging',
    runtimeControlled: true,
  },
  OPERATOR_BLOCKS: {
    env: 'VITE_FEATURE_OPERATOR_BLOCKS',
    label: 'Maintenance blocks',
    runtimeControlled: true,
  },
  REVIEWS: { env: 'VITE_FEATURE_REVIEWS', label: 'Reviews & ratings', runtimeControlled: true },
  // GA gate: the board is built on a pinned react-calendar-timeline pre-release whose bars are
  // mouse-only (no keyboard/ARIA). Do not flip this on in a paid/GA build until #1349 lands an
  // accessible path. Background: #1330 / docs/2026-07-02-fleet-timeline-lib-pin.md.
  FLEET_TIMELINE: {
    env: 'VITE_FEATURE_FLEET_TIMELINE',
    label: 'Fleet timeline board',
    runtimeControlled: true,
  },
  MULTI_CURRENCY: {
    env: 'VITE_FEATURE_MULTI_CURRENCY',
    label: 'Multi-currency display',
    runtimeControlled: true,
  },
  OPERATOR_TODAY: {
    env: 'VITE_FEATURE_OPERATOR_TODAY',
    label: 'Operator today panel',
    runtimeControlled: true,
  },
  CALENDAR_QUICKVIEW: {
    env: 'VITE_FEATURE_CALENDAR_QUICKVIEW',
    label: 'Calendar quick-view',
    runtimeControlled: false,
  },
  // #1437: platform kill-switch for the shared add-on template catalog. Default ON
  // in CODE (serverDefault) - the feature_flags table is override-only, so no seed
  // row exists. serverOnly because the API enforces it (picker endpoint + create
  // path), which no existing web-only flag does. runtimeControlled: the web reads it
  // to hide the operator picker + admin template library live.
  SHARED_CATALOG: {
    label: 'Shared add-on template catalog',
    runtimeControlled: true,
    serverOnly: true,
    serverDefault: true,
  },
} satisfies Record<string, FeatureFlagEntry>

// Typed as Record<Key, FeatureFlagEntry> (not the `as const` literal) so indexed
// `.env` access is uniformly `string | undefined` across all entries - a serverOnly
// entry omits `env`, which would otherwise make `FEATURE_FLAGS[key].env` a union
// error. Keys stay literal via `keyof typeof REGISTRY`.
export const FEATURE_FLAGS: Record<keyof typeof REGISTRY, FeatureFlagEntry> = REGISTRY

export type FeatureFlagKey = keyof typeof REGISTRY
export const FEATURE_FLAG_KEYS = Object.keys(FEATURE_FLAGS) as FeatureFlagKey[]

/** A sparse override map: only keys the platform admin has explicitly set. */
export type FeatureFlagOverrides = Partial<Record<FeatureFlagKey, boolean>>

export function isFeatureFlagKey(value: string): value is FeatureFlagKey {
  return Object.hasOwn(FEATURE_FLAGS, value)
}
