import {
  type FeatureFlagKey,
  type FeatureFlagOverrides,
  isFeatureFlagKey,
} from '@kuruma/shared/feature-flags/registry'
import { queryOptions } from '@tanstack/react-query'
import { getApiBaseUrl } from '../api-base'
import {
  isCancellationEnabled,
  isFleetTimelineEnabled,
  isMessagingEnabled,
  isMultiCurrencyEnabled,
  isOperatorBlocksEnabled,
  isOperatorManualBookingEnabled,
  isOperatorSettingsEnabled,
  isOperatorTeamEnabled,
  isRenterDocumentsEnabled,
  isReviewsEnabled,
} from './features'

// Build-time default per flag. Vite statically replaces each literal
// `import.meta.env.VITE_FEATURE_*` *inside these functions*, so we map each
// registry key to its existing literal reader — a dynamic `import.meta.env[env]`
// lookup would NOT be inlined. This is the fallback when the server has no
// runtime override for a key: effective = override ?? buildDefault ?? false.
const BUILD_TIME_READERS: Record<FeatureFlagKey, () => boolean> = {
  CANCELLATION: isCancellationEnabled,
  OPERATOR_MANUAL_BOOKING: isOperatorManualBookingEnabled,
  OPERATOR_TEAM: isOperatorTeamEnabled,
  OPERATOR_SETTINGS: isOperatorSettingsEnabled,
  RENTER_DOCUMENTS: isRenterDocumentsEnabled,
  MESSAGING: isMessagingEnabled,
  OPERATOR_BLOCKS: isOperatorBlocksEnabled,
  REVIEWS: isReviewsEnabled,
  FLEET_TIMELINE: isFleetTimelineEnabled,
  MULTI_CURRENCY: isMultiCurrencyEnabled,
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
