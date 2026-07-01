import type { FeatureFlagKey, FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'

// Global runtime feature-flag override store. This is a platform control plane,
// not tenant data, so there is no CallerContext/operator scope here — the API
// layer above enforces PLATFORM_ADMIN on writes. getOverrides returns a SPARSE
// map: only keys that carry a stored override (an absent key falls through to
// the build-time default on the web).
export interface FeatureFlagRepository {
  getOverrides(): Promise<FeatureFlagOverrides>
  setOverride(key: FeatureFlagKey, enabled: boolean, updatedBy: string): Promise<void>
}
