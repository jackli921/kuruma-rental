import { cn } from '@/lib/utils'
import type { SearchResultItem } from '@kuruma/shared/types/search-result'
import { MapPin } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslations } from 'use-intl'
import type { MapAdapter } from './MapAdapter'
import { SearchResultRow } from './SearchResultRow'
import {
  groupByLocation,
  pinPriceLabel,
  resultPriceLabel,
  resultTitle,
  searchResultKey,
} from './result'

interface SearchMapListProps {
  readonly items: SearchResultItem[]
  /** The concrete map component, injected (#458 D1). Tests pass a fake. */
  readonly adapter: MapAdapter
  /** Chosen region center to focus the map on; null = fit all pins (#840). */
  readonly anchor?: [number, number] | null
  /** Search context threaded into each row's detail CTA so dates + filters survive the drill-down (#885 1b). */
  readonly locale: string
  readonly from: string
  readonly to: string
  readonly classFilter?: string | string[] | undefined
  readonly pickupLocationId?: string | undefined
  readonly region?: string | undefined
}

/**
 * Two-pane map + flat list (#458, Slice E). Holds the selected location and syncs
 * it both ways: a marker click highlights its rows, and clicking a row highlights
 * its marker. Library-agnostic — it talks to the injected `MapAdapter` component
 * only (D1), never a map library. The map plots geocoded, deduped-by-location
 * rows; null-coord rows stay in the list (graceful degrade).
 */
export function SearchMapList({
  items,
  adapter: Adapter,
  anchor = null,
  locale,
  from,
  to,
  classFilter,
  pickupLocationId,
  region,
}: SearchMapListProps) {
  const t = useTranslations('search')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Dedupe is keyed on the loader-stable `items`; memoizing keeps the plotted
  // array reference stable across selection-only re-renders (#737).
  const mapItems = useMemo(() => geocodedByLocation(items), [items])
  // Co-located cars per location: the pin's price label is the group minimum, and
  // (#885 slice 2 task 4) the popup carousel walks the whole group.
  const groupItemsById = useMemo(() => {
    const byId = new Map<string, SearchResultItem[]>()
    for (const group of groupByLocation(items)) byId.set(group.locationId, group.items)
    return byId
  }, [items])

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
              // Card-as-affordance (#885 slice 2): hovering or keyboard-focusing a
              // geocoded row flies the map to its pin. Idempotent (sets, never clears)
              // so focus-then-click can't race to a deselect; onFocus bubbles up from
              // the row's CTA/button (focusin) for keyboard parity. Null-coord rows are
              // list-only and stay inert.
              onMouseEnter={geocoded ? () => setSelectedId(locationId) : undefined}
              onFocus={geocoded ? () => setSelectedId(locationId) : undefined}
              className={cn(
                'rounded-xl transition-shadow',
                selected && 'ring-2 ring-primary ring-offset-2',
              )}
            >
              <SearchResultRow
                item={item}
                locale={locale}
                from={from}
                to={to}
                classFilter={classFilter}
                pickupLocationId={pickupLocationId}
                region={region}
              />
              {geocoded && (
                <button
                  type="button"
                  onClick={() => setSelectedId(locationId)}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
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
          <Adapter
            items={mapItems}
            selectedId={selectedId}
            onSelect={setSelectedId}
            anchor={anchor}
            // Price-pill pin (#885 slice 2): the view owns the whole interactive
            // control — group min-price, idempotent select, and a store+price
            // accessible name (P2) so visually identical prices stay distinguishable
            // for screen readers. The adapter only positions it at the pin.
            renderPin={(item, { selected }) => {
              const group = groupItemsById.get(item.location.locationId) ?? [item]
              const price = pinPriceLabel(group, t)
              const store = `${item.location.operatorName} · ${item.location.name}`
              return (
                <button
                  type="button"
                  aria-current={selected ? 'true' : undefined}
                  aria-label={t('map.pinSelect', { store, price })}
                  onClick={() => setSelectedId(item.location.locationId)}
                  className={cn(
                    '-translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border px-2.5 py-1 text-xs font-semibold shadow-md transition-colors',
                    selected
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-border bg-card text-foreground hover:bg-muted',
                  )}
                >
                  {price}
                </button>
              )
            }}
            renderSelected={(item) => (
              <div className="min-w-44 rounded-lg border border-border bg-card p-3 text-sm shadow-md">
                <p className="font-semibold leading-tight">{resultTitle(item)}</p>
                <p className="mt-0.5 text-muted-foreground">
                  {item.location.operatorName} · {item.location.name}
                </p>
                <p className="mt-1 font-medium text-foreground">{resultPriceLabel(item, t)}</p>
              </div>
            )}
          />
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
