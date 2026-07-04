import {
  FEATURE_FLAGS,
  type FeatureFlagKey,
  type FeatureFlagOverrides,
} from '@kuruma/shared/feature-flags/registry'
import type { CallerContext } from '../auth/context'
import type { FeatureFlagRepository } from '../repositories/types'

// Runtime feature-flag control plane. Reads the sparse override map (served
// publicly) and writes a single override, stamping the platform admin who set
// it. Key validity and authorization are enforced at the route; this layer owns
// the write policy (who-stamped + persistence) so the public GET and the admin
// PATCH share one collaborator. See docs/plans/2026-06-30-runtime-feature-flags.md.
export class FeatureFlagsService {
  constructor(private readonly repo: FeatureFlagRepository) {}

  async getOverrides(): Promise<FeatureFlagOverrides> {
    return this.repo.getOverrides()
  }

  /**
   * The definitive server-side value of a flag: an admin override wins, else the
   * registry `serverDefault` (the override map is sparse, so a default-ON flag has
   * NO row in the normal state). Single-sources the default from the registry with
   * the web flooring (feature-flags-runtime.ts), so server enforcement and the web
   * surface cannot drift. Used to server-enforce SHARED_CATALOG (#1437).
   *
   * Meaningful ONLY for `serverOnly` flags: a plain web flag has no `serverDefault`
   * (its real default is a `VITE_*` env the API can't read), so this floors it to
   * `false` — which is not that flag's build-time default. Do not call it for one.
   */
  async isEnabled(key: FeatureFlagKey): Promise<boolean> {
    const overrides = await this.repo.getOverrides()
    return overrides[key] ?? FEATURE_FLAGS[key].serverDefault ?? false
  }

  async setOverride(ctx: CallerContext, key: FeatureFlagKey, enabled: boolean): Promise<void> {
    await this.repo.setOverride(key, enabled, ctx.userId)
  }
}
