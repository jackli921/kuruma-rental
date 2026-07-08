import { captureHandledError } from '@/lib/observability/sentry'
import {
  FEATURE_FLAGS,
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
// Partial: a serverOnly flag (e.g. SHARED_CATALOG) has NO build-time reader - its
// default lives in the registry (serverDefault) and resolveFeatureFlag floors to it.
const BUILD_TIME_READERS: Partial<Record<FeatureFlagKey, () => boolean>> = {
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
  OPERATOR_TODAY: () => isEnvTrue(import.meta.env.VITE_FEATURE_OPERATOR_TODAY),
  CALENDAR_QUICKVIEW: () => isEnvTrue(import.meta.env.VITE_FEATURE_CALENDAR_QUICKVIEW),
}

export function isBuildTimeEnabled(key: FeatureFlagKey): boolean {
  // A serverOnly flag has no reader here; it is never a build-time default, so false.
  const reader = BUILD_TIME_READERS[key]
  return reader ? reader() : false
}

/**
 * The effective value of a flag: a server override wins over the build-time
 * default (`override ?? build-time ?? false`). Single source of truth for that
 * rule — `useFeatureFlag` (live render), the admin switchboard, and route loaders
 * that warm a flag-dependent prefetch all call this, so a warmed range can never
 * drift from what the hook renders (#1322).
 */
export function resolveFeatureFlag(overrides: FeatureFlagOverrides, key: FeatureFlagKey): boolean {
  const entry = FEATURE_FLAGS[key]
  // serverOnly keys (e.g. SHARED_CATALOG) floor to the registry serverDefault, NOT the
  // build-time reader: the sparse map carries no row in the default state, and an envless
  // reader is false, so falling to it would hide a default-ON flag from itself. Flooring
  // to serverDefault makes every fail-safe path (empty initialData, non-ok fetch, parse
  // error) resolve to the flag's real default. Non-serverOnly keys keep build-time fallback.
  const fallback = entry.serverOnly ? (entry.serverDefault ?? false) : isBuildTimeEnabled(key)
  return overrides[key] ?? fallback
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
 *
 * The try/catch matters because route flag GATES fetchQuery() this (not just the
 * provider's error-tolerant useQuery): a bare fetch rejection (offline, DNS, abort)
 * would otherwise propagate through fetchQuery and throw the whole route to its error
 * boundary. Swallowing to {} keeps a gate degrading to the build-time default instead.
 *
 * Because we swallow rather than reject, React Query's retry never fires and the whole
 * runtime-flag control plane can silently degrade to build defaults. So each fail-safe
 * exit reports to Sentry first: the degradation stays observable instead of invisible.
 */
export async function fetchFeatureFlagOverrides(): Promise<FeatureFlagOverrides> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/feature-flags`, { credentials: 'include' })
    if (!response.ok) {
      captureHandledError(new Error(`feature-flags fetch failed: ${response.status}`))
      return {}
    }
    const body: unknown = await response.json()
    return parseOverrides(body)
  } catch (error) {
    captureHandledError(error)
    return {}
  }
}

export function featureFlagsQueryOptions() {
  return queryOptions({
    queryKey: ['feature-flags'],
    queryFn: fetchFeatureFlagOverrides,
    staleTime: 60_000,
    // First paint uses the build-time default (no flash, no async gate on boot);
    // the map reconciles to server overrides when the query resolves.
    initialData: {},
    // ...but mark that initialData stale (React Query otherwise stamps supplied
    // initialData as fetched "now"), so refetchOnMount pulls the runtime override on
    // every fresh load instead of serving the baked-in defaults for staleTime. Without
    // this a switchboard flip is invisible for ~60s on any fresh page load (#1486/#1476).
    initialDataUpdatedAt: 0,
  })
}
