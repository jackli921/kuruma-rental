import type { FeatureFlagKey, FeatureFlagOverrides } from '@kuruma/shared/feature-flags/registry'
import type { FeatureFlagRepository } from '../types'

// In-memory double for tests and the DB-less runtime. Mirrors the Drizzle repo's
// upsert semantics: one value per key, last write wins. updatedBy is not part of
// the read contract, so it is accepted and ignored here.
export class InMemoryFeatureFlagRepository implements FeatureFlagRepository {
  private readonly store: Map<FeatureFlagKey, boolean>

  constructor(store?: Map<FeatureFlagKey, boolean>) {
    this.store = store ?? new Map()
  }

  async getOverrides(): Promise<FeatureFlagOverrides> {
    const out: FeatureFlagOverrides = {}
    for (const [key, enabled] of this.store) out[key] = enabled
    return out
  }

  async setOverride(key: FeatureFlagKey, enabled: boolean): Promise<void> {
    this.store.set(key, enabled)
  }
}
