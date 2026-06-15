import type { GeoPoint } from '@kuruma/shared/lib/region-distance'
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

/**
 * The chosen region's center as a distance/centering anchor, or null when no region
 * is chosen, the slug is unknown, or the region has no coordinates (#840). Shared by
 * the store grid (nearest-first ranking + distance labels) and the map view
 * (region-centering), so both resolve the anchor identically from the cached list.
 */
export function resolveRegionAnchor(
  regions: readonly RegionNode[] | undefined,
  slug: string | undefined,
): GeoPoint | null {
  if (!regions || !slug) return null
  const region = findRegionBySlug(regions, slug)
  if (!region || region.latitude === null || region.longitude === null) return null
  return { latitude: region.latitude, longitude: region.longitude }
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
  // Bound the upward walk with a visited set: `regions.parentId` is a self-FK with
  // no DB-level cycle constraint, so a malformed row (self-parent, or A->B->A) is
  // physically storable. This runs on every RegionPicker render over the public,
  // unauthenticated region list, so an unguarded walk would spin forever and freeze
  // the renter's tab. Mirrors the API's collectDescendantIds guard (region-tree.ts).
  const seen = new Set<string>()
  let node = byId.get(regionId) ?? null
  while (node !== null && !seen.has(node.id)) {
    seen.add(node.id)
    if (node.type === 'PREFECTURE') chain.prefecture = node
    else if (node.type === 'CITY') chain.city = node
    else if (node.type === 'AREA') chain.area = node
    node = node.parentId !== null ? (byId.get(node.parentId) ?? null) : null
  }
  return chain
}
