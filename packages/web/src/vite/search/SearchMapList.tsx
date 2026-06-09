import { cn } from '@/lib/utils'
import type { SearchResultItem } from '@kuruma/shared/types/search-result'
import { useState } from 'react'
import { useTranslations } from 'use-intl'
import type { MapAdapter } from './MapAdapter'
import { SearchResultRow } from './SearchResultRow'
import { searchResultKey } from './result'

interface SearchMapListProps {
  readonly items: SearchResultItem[]
  /** The concrete map component, injected (#458 D1). Tests pass a fake. */
  readonly adapter: MapAdapter
}

/**
 * Two-pane map + flat list (#458, Slice E). Holds the selected location and syncs
 * it both ways: a marker click highlights its rows, and clicking a row highlights
 * its marker. Library-agnostic — it talks to the injected `MapAdapter` component
 * only (D1), never a map library. The map plots geocoded, deduped-by-location
 * rows; null-coord rows stay in the list (graceful degrade).
 */
export function SearchMapList({ items, adapter: Adapter }: SearchMapListProps) {
  const t = useTranslations('search')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const mapItems = geocodedByLocation(items)

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ul
        aria-label={t('list.heading')}
        className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1"
      >
        {items.map((item) => {
          // Clicking a marker highlights every row at that pickup location.
          const selected = item.location.locationId === selectedId
          return (
            <li
              key={searchResultKey(item)}
              data-location={item.location.locationId}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'rounded-xl transition-shadow',
                selected && 'ring-2 ring-primary ring-offset-2',
              )}
            >
              <SearchResultRow item={item} />
            </li>
          )
        })}
      </ul>

      <div className="sticky top-4 h-[60vh] overflow-hidden rounded-xl border border-border bg-muted lg:h-[70vh]">
        {mapItems.length === 0 ? (
          <p className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
            {t('map.noCoordinates')}
          </p>
        ) : (
          <Adapter items={mapItems} selectedId={selectedId} onSelect={setSelectedId} />
        )}
      </div>
    </div>
  )
}

/** Keep the first row per geocoded location; drop null-coord rows entirely. The
 *  list pane still shows them — only the map needs coordinates. */
function geocodedByLocation(items: SearchResultItem[]): SearchResultItem[] {
  const seen = new Set<string>()
  const plotted: SearchResultItem[] = []
  for (const item of items) {
    const { locationId, latitude, longitude } = item.location
    if (latitude === null || longitude === null || seen.has(locationId)) continue
    seen.add(locationId)
    plotted.push(item)
  }
  return plotted
}
