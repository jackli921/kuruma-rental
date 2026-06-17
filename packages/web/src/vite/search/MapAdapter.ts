import type { SearchResultItem } from '@kuruma/shared/types/search-result'
import type { ComponentType, ReactNode } from 'react'

/**
 * The map view's only dependency on a map library (#458 D1), expressed as a React
 * component type. Any library = a component implementing exactly these props, so
 * the high-level view (SearchMapList) never imports pigeon-maps — both depend on
 * this abstraction (Dependency Inversion). Tests inject a fake component.
 */
export interface MapAdapterProps {
  /** Geocoded, deduped-by-location rows to plot. The VIEW does the filtering —
   *  adapters receive only items whose location has real coordinates, one per
   *  location (null-coord rows are list-only; that graceful degrade is upstream). */
  items: SearchResultItem[]
  /** Selected location id, to highlight its marker; null = none. */
  selectedId: string | null
  /** Fired when a marker is clicked, with the selected location's id. */
  onSelect: (selectedId: string) => void
  /** Chosen region center `[lat, lng]` to focus the map on; null/absent = fit all
   *  pins (#840). A view concern (where to look), so it rides the adapter contract
   *  alongside the pins the adapter plots. */
  anchor?: [number, number] | null
  /** Renders the popup body for the selected location. The VIEW owns presentation
   *  (i18n, router links); the adapter only positions it at the pin. Absent = no
   *  popup. */
  renderSelected?: (item: SearchResultItem) => ReactNode
  /** Renders the interactive pin for a location (e.g. a price pill). The VIEW owns
   *  the whole control — i18n, min-price, onClick, aria-label, styling — and the
   *  adapter only positions it at the pin. Absent = the adapter's default dot. */
  renderPin?: (item: SearchResultItem, state: { selected: boolean }) => ReactNode
}

export type MapAdapter = ComponentType<MapAdapterProps>
