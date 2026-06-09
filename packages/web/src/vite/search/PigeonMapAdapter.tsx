import { Marker, Map as PigeonMap } from 'pigeon-maps'
import type { MapAdapterProps } from './MapAdapter'

// The ONLY file that imports the map library (#458 D1). Everything else depends
// on the MapAdapter contract, so swapping pigeon-maps for MapLibre later is a
// one-file change. pigeon-maps is zero-dep raster tiles and auto-sizes to its
// parent container (the view gives it a fixed-height box).
const DEFAULT_ZOOM = 11
// Osaka centroid — only used as a fallback when no pin has coordinates (the view
// already shows the "no map" message in that case, so this is belt-and-braces).
const OSAKA_FALLBACK: [number, number] = [34.6937, 135.5023]
const MARKER_COLOR = '#6b7280'
const SELECTED_COLOR = '#2563eb'

interface Pin {
  id: string
  lat: number
  lng: number
}

/** Concrete `MapAdapter` (#458). Maps each geocoded result to a pigeon-maps
 *  `<Marker>`; a marker click reports its location id back to the view. */
export function PigeonMapAdapter({ items, selectedId, onSelect }: MapAdapterProps) {
  const pins = items
    .map((item) => ({
      id: item.location.locationId,
      lat: item.location.latitude,
      lng: item.location.longitude,
    }))
    .filter((p): p is Pin => p.lat !== null && p.lng !== null)

  const center = pins[0] ? ([pins[0].lat, pins[0].lng] as [number, number]) : OSAKA_FALLBACK

  return (
    <PigeonMap defaultCenter={center} defaultZoom={DEFAULT_ZOOM}>
      {pins.map((pin) => (
        <Marker
          key={pin.id}
          anchor={[pin.lat, pin.lng]}
          color={pin.id === selectedId ? SELECTED_COLOR : MARKER_COLOR}
          onClick={() => onSelect(pin.id)}
        />
      ))}
    </PigeonMap>
  )
}
