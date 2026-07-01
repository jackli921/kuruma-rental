import type { StorefrontCardData } from '@/vite/storefronts/api'
import { type RankedStorefront, rankStorefronts } from '@/vite/storefronts/rank'
import type { GeoPoint } from '@kuruma/shared/lib/region-distance'

// Renter-selectable result ordering. `nearest` is the default (region-anchored
// distance, the existing behavior); the price sorts order by the store's cheapest
// daily rate. Kept client-side per page like `rankStorefronts` (design §7) — the
// region filter already narrows the result to one page, so a within-page sort is
// exact. Server-side `?sort` stays the documented scale follow-up.
export const SORT_OPTIONS = ['nearest', 'priceAsc', 'priceDesc'] as const
export type SortOption = (typeof SORT_OPTIONS)[number]
export const DEFAULT_SORT: SortOption = 'nearest'

/** Narrow an unknown URL value to a supported sort, or undefined (the default). */
export function parseSort(value: unknown): SortOption | undefined {
  return typeof value === 'string' && (SORT_OPTIONS as readonly string[]).includes(value)
    ? (value as SortOption)
    : undefined
}

/** Narrow an unknown URL value to a positive yen cap, or undefined (no cap). */
export function parsePriceMax(value: unknown): number | undefined {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN
  return Number.isFinite(n) && n > 0 ? n : undefined
}

interface SortAndFilterOptions {
  readonly anchor: GeoPoint | null
  readonly sort?: SortOption | undefined
  readonly priceMax?: number | undefined
}

/**
 * Filter the current result page to a daily-price cap (when set), then order it.
 * `nearest` defers to `rankStorefronts` (distance ascending, coord-less at the
 * tail); the price sorts order by cheapest daily rate with priceless stores
 * always last, falling back to the nearest-first order for ties so the sort is
 * deterministic. Functional core — pure, no I/O.
 */
export function sortStorefronts(
  cards: readonly StorefrontCardData[],
  { anchor, sort = DEFAULT_SORT, priceMax }: SortAndFilterOptions,
): RankedStorefront[] {
  const filtered =
    priceMax == null
      ? cards
      : cards.filter((c) => c.fromDailyPriceJpy != null && c.fromDailyPriceJpy <= priceMax)

  // rankStorefronts tags distanceKm and gives the nearest-first baseline order.
  const ranked = rankStorefronts(filtered, anchor)
  if (sort === 'nearest') return ranked

  const direction = sort === 'priceAsc' ? 1 : -1
  return [...ranked].sort((a, b) =>
    comparePrice(a.fromDailyPriceJpy, b.fromDailyPriceJpy, direction),
  )
}

// Stores with no daily price sink to the tail regardless of direction; equal
// prices return 0 so the stable sort keeps the nearest-first baseline order.
function comparePrice(a: number | null, b: number | null, direction: number): number {
  if (a === b) return 0
  if (a === null) return 1
  if (b === null) return -1
  return (a - b) * direction
}
