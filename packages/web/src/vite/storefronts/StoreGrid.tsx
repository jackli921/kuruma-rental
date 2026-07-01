import { resolveRegionAnchor } from '@/vite/regions/region-lookup'
import { regionsQueryOptions } from '@/vite/regions/regions-api'
import { reviewAggregatesQueryOptions } from '@/vite/reviews'
import { StorefrontCard } from '@/vite/storefronts/StorefrontCard'
import type { StorefrontSearchResultData } from '@/vite/storefronts/api'
import { type SortOption, sortStorefronts } from '@/vite/storefronts/sort'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useTranslations } from 'use-intl'

interface StoreGridProps {
  readonly result: StorefrontSearchResultData | null
  readonly from: string
  readonly to: string
  readonly classFilter?: string | string[] | undefined
  readonly pickupLocationId?: string | undefined
  /** The chosen region slug (#840): resolves the nearest-first anchor + distance labels. */
  readonly region?: string | undefined
  /** Result ordering + daily-price cap, applied client-side per page (#1291). */
  readonly sort?: SortOption | undefined
  readonly priceMax?: number | undefined
}

/**
 * Slice-5 storefront grid — the default search view. Forwards active filters
 * across the drill-down (#499) and, when a region is chosen (#840), ranks the
 * page nearest-first from that region's centre and labels each store's distance.
 * Ranking is client-side per page by design (§6/§7) — the region filter already
 * narrows the result to one page, so a within-page sort is exact.
 */
export function StoreGrid({
  result,
  from,
  to,
  classFilter,
  pickupLocationId,
  region,
  sort,
  priceMax,
}: StoreGridProps) {
  const t = useTranslations('search')
  // Edge-cached and already ensured by the loader, so this resolves synchronously
  // from cache; used only to read the chosen region's centre as the sort anchor.
  const { data: regions } = useQuery(regionsQueryOptions())
  const anchor = resolveRegionAnchor(regions, region)

  // #1085 slice 5: one batched fetch for every visible operator's review
  // aggregate. Computed + the useQuery call MUST sit above the early returns
  // below — React identifies hooks by call position, not name, so flipping
  // from null/empty → populated would otherwise produce "Rendered more hooks
  // than during the previous render." `reviewAggregatesQueryOptions` is
  // disabled for an empty id list, so the null/empty path costs nothing.
  const ranked =
    result === null ? [] : sortStorefronts(result.storefronts, { anchor, sort, priceMax })
  const operatorIds = ranked.map((s) => s.operatorId)
  const { data: operatorRatings } = useQuery(reviewAggregatesQueryOptions('operators', operatorIds))

  if (result === null) {
    return <p className="py-12 text-center text-muted-foreground">{t('needDates')}</p>
  }
  // A non-empty result that ranks to nothing was filtered out by the price cap
  // (availability alone would return no stores at all) — point the renter at the
  // cap sitting right above the grid, not at a later pickup date (#1291 review).
  if (ranked.length === 0) {
    const cappedOut = priceMax != null && result.storefronts.length > 0
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Search className="mb-4 size-12 text-muted-foreground/30" />
        <p className="text-lg text-muted-foreground">{t(cappedOut ? 'emptyPriceCap' : 'empty')}</p>
        <p className="mt-2 max-w-md text-sm text-muted-foreground/80">
          {t(cappedOut ? 'emptyPriceCapHint' : 'emptyTurnaroundHint')}
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {ranked.map((storefront) => (
        <StorefrontCard
          key={storefront.locationId}
          storefront={storefront}
          from={from}
          to={to}
          classFilter={classFilter}
          pickupLocationId={pickupLocationId}
          region={region}
          distanceKm={storefront.distanceKm}
          operatorRating={operatorRatings?.[storefront.operatorId]}
        />
      ))}
    </div>
  )
}
