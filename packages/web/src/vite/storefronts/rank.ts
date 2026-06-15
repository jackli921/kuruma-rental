import type { StorefrontCardData } from '@/vite/storefronts/api'
import { type GeoPoint, haversineKm } from '@kuruma/shared/lib/region-distance'

export interface RankedStorefront extends StorefrontCardData {
  /** Great-circle km from the search anchor, or null (no anchor, or store has no coords). */
  readonly distanceKm: number | null
}

/**
 * Client-side nearest-first ranking of the current result page (#840, design §6/§7).
 *
 * With an anchor (the chosen region's centre, or the resolved "Near me" area),
 * coord-bearing stores are ordered by great-circle distance ascending and tagged
 * with it; coord-less stores keep their API order at the tail. With no anchor the
 * API's `operator → name → id` order is preserved untouched and nothing is tagged.
 *
 * Per-page only, by design: with the region filter the result set is one page
 * (~9 stores), so a within-page sort is exact. Server-side `?sort=distance` is the
 * documented scale follow-up (§7), not this slice. Functional core — pure, no I/O.
 */
export function rankStorefronts(
  cards: readonly StorefrontCardData[],
  anchor: GeoPoint | null,
): RankedStorefront[] {
  if (anchor === null) return cards.map((card) => ({ ...card, distanceKm: null }))

  return cards
    .map((card, index) => ({
      card,
      index,
      distanceKm:
        card.latitude !== null && card.longitude !== null
          ? haversineKm(anchor, { latitude: card.latitude, longitude: card.longitude })
          : null,
    }))
    .sort((a, b) => {
      // Coord-less stores sink below every measurable one; equal-or-null pairs fall
      // back to original index so the sort is deterministically stable.
      if (a.distanceKm === null || b.distanceKm === null) {
        if (a.distanceKm === b.distanceKm) return a.index - b.index
        return a.distanceKm === null ? 1 : -1
      }
      if (a.distanceKm !== b.distanceKm) return a.distanceKm - b.distanceKm
      return a.index - b.index
    })
    .map(({ card, distanceKm }) => ({ ...card, distanceKm }))
}
