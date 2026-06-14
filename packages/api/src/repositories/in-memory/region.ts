import type { Region } from '../../stores'
import { collectDescendantIds } from '../region-tree'
import type { RegionRepository } from '../types'

/**
 * In-memory double for the #394 region taxonomy. Holds the flat region list and
 * delegates descendant resolution to the shared pure tree walk — the same
 * contract the Drizzle impl honours. Platform-global (no CallerContext). Each row
 * is a full RegionNode, so the single seed feeds both `findAll` (the cascade) and
 * the location-save geo guard, which reads the geo columns off these same rows.
 */
export class InMemoryRegionRepository implements RegionRepository {
  constructor(private readonly regions: readonly Region[] = []) {}

  async findAll(): Promise<Region[]> {
    return [...this.regions]
  }

  async findDescendantIds(rootId: string): Promise<string[]> {
    return collectDescendantIds(this.regions, rootId)
  }
}
