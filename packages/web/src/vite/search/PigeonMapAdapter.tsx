import { Marker, Map as PigeonMap } from 'pigeon-maps'
import type { MapAdapterProps } from './MapAdapter'
import { type Pin, computeViewport } from './viewport'

// The ONLY file that imports the map library (#458 D1). Everything else depends
// on the MapAdapter contract, so swapping pigeon-maps for MapLibre later is a
// one-file change. pigeon-maps is zero-dep raster tiles and auto-sizes to its
// parent container (the view gives it a fixed-height box).
const MARKER_COLOR = '#6b7280'
const SELECTED_COLOR = '#2563eb'

// Explicit basemap provider (#660). Without one, pigeon-maps falls back to the
// public OpenStreetMap tile server, which the OSMF tile-usage policy bars from
// production/commercial reliance (no SLA, requires attribution). GSI (Geospatial
// Information Authority of Japan) std raster tiles are free for commercial web
// use with the credit "出典: 国土地理院". https://maps.gsi.go.jp/development/ichiran.html
export function gsiTileProvider(x: number, y: number, z: number): string {
  return `https://cyberjapandata.gsi.go.jp/xyz/std/${z}/${x}/${y}.png`
}

const GSI_ATTRIBUTION = (
  <span>
    出典:{' '}
    <a
      href="https://maps.gsi.go.jp/development/ichiran.html"
      target="_blank"
      rel="noreferrer noopener"
    >
      国土地理院
    </a>
  </span>
)

/** Concrete `MapAdapter` (#458). Maps each geocoded result to a pigeon-maps
 *  `<Marker>`; a marker click reports its location id back to the view. The
 *  viewport is fit to ALL pins so a Kansai-wide result set isn't pinned to one
 *  store. `key` on the map remounts it when the result set changes so the fit
 *  recomputes, while leaving the user free to pan/zoom within a result set. */
export function PigeonMapAdapter({ items, selectedId, onSelect }: MapAdapterProps) {
  const pins = items
    .map((item) => ({
      id: item.location.locationId,
      lat: item.location.latitude,
      lng: item.location.longitude,
    }))
    .filter((p): p is Pin => p.lat !== null && p.lng !== null)

  const viewport = computeViewport(pins)

  return (
    <PigeonMap
      key={pins.map((p) => p.id).join(',')}
      provider={gsiTileProvider}
      attribution={GSI_ATTRIBUTION}
      attributionPrefix={false}
      defaultCenter={viewport.center}
      defaultZoom={viewport.zoom}
    >
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
