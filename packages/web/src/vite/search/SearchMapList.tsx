import { cn } from '@/lib/utils'
import type { GeoPoint } from '@kuruma/shared/lib/region-distance'
import type { RegionNode } from '@kuruma/shared/types/region'
import type { SearchResultItem } from '@kuruma/shared/types/search-result'
import { MapPin } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslations } from 'use-intl'
import type { MapAdapter } from './MapAdapter'
import { MapPopupCarousel } from './MapPopupCarousel'
import { SearchResultRow } from './SearchResultRow'
import {
  formatGeoContext,
  groupByLocation,
  pinPriceLabel,
  resolveGeoContext,
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
  /** Region taxonomy (cached `GET /regions`) for deriving geo-context labels (#885 slice 3a). */
  readonly regions?: readonly RegionNode[]
  /** Searched region centre; the distance reference for each label, null when none (#885 slice 3a). */
  readonly geoAnchor?: GeoPoint | null
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
  regions = [],
  geoAnchor = null,
  locale,
  from,
  to,
  classFilter,
  pickupLocationId,
  region,
}: SearchMapListProps) {
  const t = useTranslations('search')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Presentation-only show/hide of the map pane (#885 slice 3b). Client state, not
  // URL-persisted: it changes nothing about the data, so it never refetches and
  // doesn't belong in the shareable URL. Hiding the map gives the list full width.
  const [showMap, setShowMap] = useState(true)
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

  // Derive each location's geo-context label once (the shell), so the leaf row and
  // popup take a dumb string and `regions` stays out of them. Iterate per location
  // (not per car) — the label is keyed by locationId and co-located cars share it, so
  // walking the region taxonomy once per group avoids redundant work. Absent until
  // the region query resolves.
  const geoLabelById = useMemo(() => {
    const byId = new Map<string, string>()
    for (const group of groupByLocation(items)) {
      const location = group.items[0]?.location
      if (!location) continue
      const label = formatGeoContext(resolveGeoContext(location, regions, geoAnchor), locale, t)
      if (label) byId.set(group.locationId, label)
    }
    return byId
  }, [items, regions, geoAnchor, locale, t])

  return (
    <div>
      <div className="mb-4 flex justify-end">
        {/* Quiet presentation toggle (#885 slice 3b) — a single button with
            aria-pressed is the right primitive for a binary show/hide (matches the
            FleetViewToggle precedent), not a two-link data-mode segmented control. */}
        <button
          type="button"
          onClick={() => setShowMap((shown) => !shown)}
          aria-pressed={showMap}
          className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MapPin className="size-4" />
          {showMap ? t('map.hideMap') : t('map.showMap')}
        </button>
      </div>
      <div className={cn('grid gap-4', showMap && 'lg:grid-cols-2')}>
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
                  geoLabel={geoLabelById.get(locationId) ?? null}
                />
                {/* The "show on map" affordance only makes sense while the map pane
                  is visible (#885 3b) — flying to a pin you can't see is a dead end. */}
                {showMap && geocoded && (
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

        {showMap && (
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
                // The popup walks the full co-located group (#885 slice 2 task 4), not
                // just the representative pin item — the view's closure holds every car.
                // Key on the location so selecting a different pin remounts the carousel
                // at its first car instead of leaking the previous slide index.
                renderSelected={(item) => (
                  <MapPopupCarousel
                    key={item.location.locationId}
                    items={groupItemsById.get(item.location.locationId) ?? [item]}
                    locale={locale}
                    from={from}
                    to={to}
                    classFilter={classFilter}
                    pickupLocationId={pickupLocationId}
                    region={region}
                    geoLabel={geoLabelById.get(item.location.locationId) ?? null}
                  />
                )}
              />
            )}
          </div>
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
