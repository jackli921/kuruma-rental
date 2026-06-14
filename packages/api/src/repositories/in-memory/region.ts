import type { RegionCandidate } from '@kuruma/shared/lib/region-distance'
import type { Region } from '../../stores'
import { collectDescendantIds } from '../region-tree'
import type { RegionRepository } from '../types'

/**
 * In-memory double for the #394 region taxonomy. Holds the flat region list and
 * delegates descendant resolution to the shared pure tree walk — the same
 * contract the Drizzle impl honours. Platform-global (no CallerContext).
 */
export class InMemoryRegionRepository implements RegionRepository {
  // `candidates` (the geo/taxonomy projection #651 Slice 2) is a SEPARATE optional
  // seed from the cascade `regions`, so existing fixtures that only need the tree
  // stay a one-arg construct; the loop-guard tests seed candidates directly.
  constructor(
    private readonly regions: readonly Region[] = [],
    private readonly candidates: readonly RegionCandidate[] = [],
  ) {}

  async findAll(): Promise<Region[]> {
    return [...this.regions]
  }

  async findCandidates(): Promise<RegionCandidate[]> {
    return [...this.candidates]
  }

  async findDescendantIds(rootId: string): Promise<string[]> {
    return collectDescendantIds(this.regions, rootId)
  }
}
