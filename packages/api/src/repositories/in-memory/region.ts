import type { Region } from '../../stores'
import { collectDescendantIds } from '../region-tree'
import type { RegionRepository } from '../types'

/**
 * In-memory double for the #394 region taxonomy. Holds the flat region list and
 * delegates descendant resolution to the shared pure tree walk — the same
 * contract the Drizzle impl honours. Platform-global (no CallerContext).
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
