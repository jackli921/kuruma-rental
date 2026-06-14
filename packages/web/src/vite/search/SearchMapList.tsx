import { cn } from '@/lib/utils'
import type { SearchResultItem } from '@kuruma/shared/types/search-result'
import { MapPin } from 'lucide-react'
import { useMemo, useState } from 'react'
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
  // Dedupe is keyed on the loader-stable `items`; memoizing keeps the plotted
  // array reference stable across selection-only re-renders (#737).
  const mapItems = useMemo(() => geocodedByLocation(items), [items])

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ul
        aria-label={t('list.heading')}
        className="flex max-h-[70vh] flex-col gap-3 overflow-y-auto pr-1"
      >
        {items.map((item) => {
          // Selection syncs both ways: a marker click highlights every row at that
          // pickup location, and the row's "show on map" control selects its marker.
          const { locationId, latitude, longitude } = item.location
          const selected = locationId === selectedId
          const geocoded = latitude !== null && longitude !== null
          return (
            <li
              key={searchResultKey(item)}
              data-location={locationId}
              aria-current={selected ? 'true' : undefined}
              className={cn(
                'rounded-xl transition-shadow',
                selected && 'ring-2 ring-primary ring-offset-2',
              )}
            >
              <SearchResultRow item={item} />
              {geocoded && (
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedId(selected ? null : locationId)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground aria-[pressed=true]:text-primary"
                >
                  <MapPin className="size-4" />
                  {t('showOnMap')}
                </button>
              )}
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
