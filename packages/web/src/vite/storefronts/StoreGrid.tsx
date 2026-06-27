import { resolveRegionAnchor } from '@/vite/regions/region-lookup'
import { regionsQueryOptions } from '@/vite/regions/regions-api'
import { reviewAggregatesQueryOptions } from '@/vite/reviews'
import { StorefrontCard } from '@/vite/storefronts/StorefrontCard'
import type { StorefrontSearchResultData } from '@/vite/storefronts/api'
import { rankStorefronts } from '@/vite/storefronts/rank'
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
}: StoreGridProps) {
  const t = useTranslations('search')
  // Edge-cached and already ensured by the loader, so this resolves synchronously
  // from cache; used only to read the chosen region's centre as the sort anchor.
  const { data: regions } = useQuery(regionsQueryOptions())
  const anchor = resolveRegionAnchor(regions, region)

  if (result === null) {
    return <p className="py-12 text-center text-muted-foreground">{t('needDates')}</p>
  }
  if (result.storefronts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <Search className="mb-4 size-12 text-muted-foreground/30" />
        <p className="text-lg text-muted-foreground">{t('empty')}</p>
        <p className="mt-2 max-w-md text-sm text-muted-foreground/80">{t('emptyTurnaroundHint')}</p>
      </div>
    )
  }

  const ranked = rankStorefronts(result.storefronts, anchor)
  // #1085 slice 5: one batched fetch for every visible operator's review
  // aggregate. The query options dedupe + sort ids, so two re-renders with the
  // same set share one cache entry. While the fetch is in flight `data` is
  // undefined → each card renders a skeleton; after resolution a missing id
  // surfaces as undefined (still skeleton, but data won't be missing in
  // practice — the API returns every requested id).
  const operatorIds = ranked.map((s) => s.operatorId)
  const { data: operatorRatings } = useQuery(reviewAggregatesQueryOptions('operators', operatorIds))
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
