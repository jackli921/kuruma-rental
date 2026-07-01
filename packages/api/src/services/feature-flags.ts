import type { FeatureFlagKey, FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
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

  async setOverride(ctx: CallerContext, key: FeatureFlagKey, enabled: boolean): Promise<void> {
    await this.repo.setOverride(key, enabled, ctx.userId)
  }
}
