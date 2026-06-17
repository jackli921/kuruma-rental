import type { GeoPoint } from '@kuruma/shared/lib/region-distance'
import type { RegionNode } from '@kuruma/shared/types/region'
import type { SearchResultsData } from '@kuruma/shared/types/search-result'
import { Search } from 'lucide-react'
import { useTranslations } from 'use-intl'
import { PigeonMapAdapter } from './PigeonMapAdapter'
import { SearchMapList } from './SearchMapList'

interface SearchMapProps {
  /** null = no valid date range yet → show the date prompt. */
  readonly result: SearchResultsData | null
  /** Chosen region center to focus the map on; null = fit all pins (#840). */
  readonly anchor?: [number, number] | null
  /** Region taxonomy for geo-context labels, forwarded to the list (#885 slice 3a). */
  readonly regions?: readonly RegionNode[]
  /** Searched region centre — the distance reference for each geo label (#885 slice 3a). */
  readonly geoAnchor?: GeoPoint | null
  /** Search context threaded into each row's detail CTA so dates + filters survive the drill-down (#885 1b). */
  readonly locale: string
  readonly from: string
  readonly to: string
  readonly classFilter?: string | string[] | undefined
  readonly pickupLocationId?: string | undefined
  readonly region?: string | undefined
}

/**
 * Map-view host (#458, Slice E). Injects the concrete `PigeonMapAdapter` into the
 * library-agnostic `SearchMapList`, and gates the date-prompt / empty states so
 * the two-pane layout only renders once there are results. No `dynamic ssr:false`
 * — the Vite shell is a client SPA, so the map host is a plain component.
 */
export function SearchMap({
  result,
  anchor = null,
  regions = [],
  geoAnchor = null,
  locale,
  from,
  to,
  classFilter,
  pickupLocationId,
  region,
}: SearchMapProps) {
  const t = useTranslations('search')

  if (result === null) {
    return <p className="py-12 text-center text-muted-foreground">{t('needDates')}</p>
  }

  if (result.items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <Search className="mb-4 size-12 text-muted-foreground/30" />
        <p className="text-lg text-muted-foreground">{t('list.empty')}</p>
      </div>
    )
  }

  return (
    <SearchMapList
      items={result.items}
      adapter={PigeonMapAdapter}
      anchor={anchor}
      regions={regions}
      geoAnchor={geoAnchor}
      locale={locale}
      from={from}
      to={to}
      classFilter={classFilter}
      pickupLocationId={pickupLocationId}
      region={region}
    />
  )
}
