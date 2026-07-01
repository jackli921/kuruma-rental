import {
  type FeatureFlagKey,
  type FeatureFlagOverrides,
  isFeatureFlagKey,
} from '@kuruma/shared/feature-flags/registry'
import { queryOptions } from '@tanstack/react-query'
import { getApiBaseUrl } from '../api-base'

const envOn = (value: string | undefined): boolean => value === 'true'

// Build-time default per flag, read as the fallback when the server has no
// runtime override: effective = override ?? buildDefault ?? false.
//
// Each entry is a LITERAL `import.meta.env.VITE_FEATURE_*` access so Vite inlines
// it at build (a dynamic `import.meta.env[env]` lookup would not be replaced).
// Read directly here rather than via features.ts' isXEnabled() so this module has
// no dependency on `./features` — a consumer that partially mocks that module in
// tests can't break the barrel that also re-exports this one. The env names are
// pinned to the registry by the parity test (feature-flags-parity.test.ts).
const BUILD_TIME_READERS: Record<FeatureFlagKey, () => boolean> = {
  CANCELLATION: () => envOn(import.meta.env.VITE_FEATURE_CANCELLATION),
  OPERATOR_MANUAL_BOOKING: () => envOn(import.meta.env.VITE_FEATURE_OPERATOR_MANUAL_BOOKING),
  OPERATOR_TEAM: () => envOn(import.meta.env.VITE_FEATURE_OPERATOR_TEAM),
  OPERATOR_SETTINGS: () => envOn(import.meta.env.VITE_FEATURE_OPERATOR_SETTINGS),
  RENTER_DOCUMENTS: () => envOn(import.meta.env.VITE_FEATURE_RENTER_DOCUMENTS),
  MESSAGING: () => envOn(import.meta.env.VITE_FEATURE_MESSAGING),
  OPERATOR_BLOCKS: () => envOn(import.meta.env.VITE_FEATURE_OPERATOR_BLOCKS),
  REVIEWS: () => envOn(import.meta.env.VITE_FEATURE_REVIEWS),
  FLEET_TIMELINE: () => envOn(import.meta.env.VITE_FEATURE_FLEET_TIMELINE),
  MULTI_CURRENCY: () => envOn(import.meta.env.VITE_FEATURE_MULTI_CURRENCY),
}

export function isBuildTimeEnabled(key: FeatureFlagKey): boolean {
  return BUILD_TIME_READERS[key]()
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
    initialData: {} as FeatureFlagOverrides,
  })
}
