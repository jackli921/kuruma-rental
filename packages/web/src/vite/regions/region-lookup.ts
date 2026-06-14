import type { RegionNode } from '@kuruma/shared/types/region'

/**
 * Map a URL region slug (`?region=namba`, the owner-approved public contract —
 * #651 Decision 6) to its stable region id, resolved client-side against the
 * cached `GET /regions` list. Nodes with a null slug are non-addressable;
 * an unknown slug yields undefined so the caller can fall back to the full list.
 */
export function resolveSlugToRegionId(regions: RegionNode[], slug: string): string | undefined {
  return regions.find((region) => region.slug === slug)?.id
}
