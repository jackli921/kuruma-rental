import type { SearchResultItem } from '@kuruma/shared/types/search-result'
import type { ComponentType } from 'react'

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
}

export type MapAdapter = ComponentType<MapAdapterProps>
