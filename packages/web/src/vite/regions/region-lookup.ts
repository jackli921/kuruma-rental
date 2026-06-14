import type { RegionNode } from '@kuruma/shared/types/region'

/**
 * Map a URL region slug (`?region=namba`, the owner-approved public contract —
 * #651 Decision 6) to its stable region id, resolved client-side against the
 * cached `GET /regions` list. Nodes with a null slug are non-addressable;
 * an unknown slug yields undefined so the caller can fall back to the full list.
 */
export function resolveSlugToRegionId(
  regions: readonly RegionNode[],
  slug: string,
): string | undefined {
  return findRegionBySlug(regions, slug)?.id
}

/** The full taxonomy node for a slug, or undefined. Null slugs are non-addressable. */
export function findRegionBySlug(
  regions: readonly RegionNode[],
  slug: string,
): RegionNode | undefined {
  return regions.find((region) => region.slug === slug)
}

/** The prefecture -> city -> area lineage of a region, any slot null when absent. */
export interface RegionChain {
  prefecture: RegionNode | null
  city: RegionNode | null
  area: RegionNode | null
}

/**
 * Walk a region's parent chain into its prefecture/city/area slots so the renter
 * cascade can prefill from any-level selection (a chip may be a prefecture, a city,
 * or an area — #651 Decision 6). Slots are filled by each node's `type`, not by tree
 * depth, and an unknown/null id yields an all-null chain.
 */
export function regionChain(regions: readonly RegionNode[], regionId: string | null): RegionChain {
  const chain: RegionChain = { prefecture: null, city: null, area: null }
  if (regionId === null) return chain
  const byId = new Map(regions.map((region) => [region.id, region]))
  let node = byId.get(regionId) ?? null
  while (node) {
    if (node.type === 'PREFECTURE') chain.prefecture = node
    else if (node.type === 'CITY') chain.city = node
    else if (node.type === 'AREA') chain.area = node
    node = node.parentId !== null ? (byId.get(node.parentId) ?? null) : null
  }
  return chain
}
