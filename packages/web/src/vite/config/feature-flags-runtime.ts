import {
  type FeatureFlagKey,
  type FeatureFlagOverrides,
  isFeatureFlagKey,
} from '@kuruma/shared/feature-flags/registry'
import { queryOptions } from '@tanstack/react-query'
import { getApiBaseUrl } from '../api-base'
import { isEnvTrue } from './env-flag'

// Build-time default per flag, read as the fallback when the server has no
// runtime override: effective = override ?? buildDefault ?? false.
//
// Each entry is a LITERAL `import.meta.env.VITE_FEATURE_*` access so Vite inlines
// it at build (a dynamic `import.meta.env[env]` lookup would not be replaced). The
// value is interpreted by the shared `isEnvTrue` (`./env-flag`), the same predicate
// features.ts' isXEnabled() uses, so the build-time and runtime readers agree. This
// module deliberately does NOT import `./features` — a consumer that partially mocks
// that module in tests can't break the barrel that also re-exports this one. The env
// names are pinned to the registry by the parity test (feature-flags-parity.test.ts).
const BUILD_TIME_READERS: Record<FeatureFlagKey, () => boolean> = {
  CANCELLATION: () => isEnvTrue(import.meta.env.VITE_FEATURE_CANCELLATION),
  OPERATOR_MANUAL_BOOKING: () => isEnvTrue(import.meta.env.VITE_FEATURE_OPERATOR_MANUAL_BOOKING),
  OPERATOR_TEAM: () => isEnvTrue(import.meta.env.VITE_FEATURE_OPERATOR_TEAM),
  OPERATOR_SETTINGS: () => isEnvTrue(import.meta.env.VITE_FEATURE_OPERATOR_SETTINGS),
  RENTER_DOCUMENTS: () => isEnvTrue(import.meta.env.VITE_FEATURE_RENTER_DOCUMENTS),
  MESSAGING: () => isEnvTrue(import.meta.env.VITE_FEATURE_MESSAGING),
  OPERATOR_BLOCKS: () => isEnvTrue(import.meta.env.VITE_FEATURE_OPERATOR_BLOCKS),
  REVIEWS: () => isEnvTrue(import.meta.env.VITE_FEATURE_REVIEWS),
  FLEET_TIMELINE: () => isEnvTrue(import.meta.env.VITE_FEATURE_FLEET_TIMELINE),
  MULTI_CURRENCY: () => isEnvTrue(import.meta.env.VITE_FEATURE_MULTI_CURRENCY),
}

export function isBuildTimeEnabled(key: FeatureFlagKey): boolean {
  return BUILD_TIME_READERS[key]()
}

/**
 * The effective value of a flag: a server override wins over the build-time
 * default (`override ?? build-time ?? false`). Single source of truth for that
 * rule — `useFeatureFlag` (live render), the admin switchboard, and route loaders
 * that warm a flag-dependent prefetch all call this, so a warmed range can never
 * drift from what the hook renders (#1322).
 */
export function resolveFeatureFlag(overrides: FeatureFlagOverrides, key: FeatureFlagKey): boolean {
  return overrides[key] ?? isBuildTimeEnabled(key)
}

interface OverridesEnvelope {
  success?: boolean
  data?: { overrides?: Record<string, unknown> }
}

// Validate + narrow at the HTTP boundary: only known keys with boolean values
// become overrides; anything else is dropped so an unexpected payload can never
// flip a flag on. An empty map means "no overrides" -> pure build-time behavior.
function parseOverrides(body: unknown): FeatureFlagOverrides {
  if (typeof body !== 'object' || body === null) return {}
  const overrides = (body as OverridesEnvelope).data?.overrides
  if (typeof overrides !== 'object' || overrides === null) return {}

  const out: FeatureFlagOverrides = {}
  for (const [key, value] of Object.entries(overrides)) {
    if (isFeatureFlagKey(key) && typeof value === 'boolean') out[key] = value
  }
  return out
}

/**
 * Read the runtime override map. Fail-safe: any transport or shape error yields
 * an empty map, so the UI falls back to build-time defaults rather than breaking.
 */
export async function fetchFeatureFlagOverrides(): Promise<FeatureFlagOverrides> {
  const response = await fetch(`${getApiBaseUrl()}/feature-flags`, { credentials: 'include' })
  if (!response.ok) return {}
  const body: unknown = await response.json()
  return parseOverrides(body)
}

export function featureFlagsQueryOptions() {
  return queryOptions({
    queryKey: ['feature-flags'],
    queryFn: fetchFeatureFlagOverrides,
    staleTime: 60_000,
    // First paint uses the build-time default (no flash, no async gate on boot);
    // the map reconciles to server overrides when the query resolves.
    initialData: {},
  })
}
