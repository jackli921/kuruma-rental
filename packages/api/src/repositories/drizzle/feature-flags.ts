import { featureFlags } from '@kuruma/shared/db/schema'
import {
  type FeatureFlagKey,
  type FeatureFlagOverrides,
  isFeatureFlagKey,
} from '@kuruma/shared/feature-flags/registry'
import type { FeatureFlagRepository } from '../types'
import type { Db } from './shared'

export class DrizzleFeatureFlagRepository implements FeatureFlagRepository {
  constructor(private readonly db: Db) {}

  async getOverrides(): Promise<FeatureFlagOverrides> {
    const rows = await this.db
      .select({ key: featureFlags.key, enabled: featureFlags.enabled })
      .from(featureFlags)

    const out: FeatureFlagOverrides = {}
    for (const row of rows) {
      // A stale row for a retired key is ignored, never surfaced to callers.
      if (isFeatureFlagKey(row.key)) out[row.key] = row.enabled
    }
    return out
  }

  async setOverride(key: FeatureFlagKey, enabled: boolean, updatedBy: string): Promise<void> {
    const now = new Date()
    await this.db
      .insert(featureFlags)
      .values({ key, enabled, updatedBy, updatedAt: now })
      .onConflictDoUpdate({
        target: featureFlags.key,
        set: { enabled, updatedBy, updatedAt: now },
      })
  }
}
