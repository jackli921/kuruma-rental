import { Marker, Overlay, Map as PigeonMap } from 'pigeon-maps'
import { useEffect, useState } from 'react'
import type { MapAdapterProps } from './MapAdapter'
import { type Pin, focusViewport } from './viewport'

// The ONLY file that imports the map library (#458 D1). Everything else depends
// on the MapAdapter contract, so swapping pigeon-maps for MapLibre later is a
// one-file change. pigeon-maps is zero-dep raster tiles and auto-sizes to its
// parent container (the view gives it a fixed-height box).
const MARKER_COLOR = '#6b7280'
const SELECTED_COLOR = '#2563eb'
/** Pixel nudge so the popup clears the marker: [px right, px up] from the pin. */
const OVERLAY_OFFSET: [number, number] = [120, 20]

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
 *  viewport fits ALL pins so a Kansai-wide result set isn't pinned to one store —
 *  unless a region `anchor` is given (#840), which centers on the chosen area, or a
 *  result is selected, which flies to its pin (#885).
 *
 *  Controlled viewport (#885 slice 2): `center`/`zoom` live in state, synced from
 *  `onBoundsChanged` so a user pan/zoom sticks. A single precedence effect retargets
 *  on selection/anchor/pin changes via `focusViewport` (selected pin → region anchor
 *  → fit-all). There is deliberately NO remount `key`: the old key remounted `<Map>`
 *  on every selection, re-fetching all tiles. Controlled props animate an in-place
 *  fly-to instead (pigeon `setCenterZoomTarget`), so per-row interaction never
 *  thrashes tiles. */
export function PigeonMapAdapter({
  items,
  selectedId,
  onSelect,
  anchor = null,
  renderSelected,
  renderPin,
}: MapAdapterProps) {
  const pins = items
    .map((item) => ({
      id: item.location.locationId,
      lat: item.location.latitude,
      lng: item.location.longitude,
    }))
    .filter((p): p is Pin => p.lat !== null && p.lng !== null)

  // Controlled viewport: initial fit on mount, then synced from user pan/zoom
  // (onBoundsChanged) and re-targeted by the precedence effect below.
  const [view, setView] = useState(() => focusViewport(pins, anchor, selectedId))

  // One precedence function (focusViewport) drives every programmatic recenter, so
  // two effects can never disagree (selection vs anchor). The signature serializes
  // exactly the inputs focusViewport reads — selection, anchor, and each pin's
  // id:lat:lng — so a coord move for a stable location id still recenters (P2), while
  // a manual pan (which changes none of them) is never clobbered.
  const targetSignature = `${selectedId ?? ''}|${anchor ? anchor.join(',') : 'fit'}|${pins
    .map((p) => `${p.id}:${p.lat}:${p.lng}`)
    .join(',')}`
  // biome-ignore lint/correctness/useExhaustiveDependencies: targetSignature serializes pins/anchor/selectedId — the real reactive inputs.
  useEffect(() => {
    setView(focusViewport(pins, anchor, selectedId))
  }, [targetSignature])

  const selectedPin = selectedId === null ? null : (pins.find((p) => p.id === selectedId) ?? null)
  const selectedItem =
    selectedId === null ? null : (items.find((i) => i.location.locationId === selectedId) ?? null)

  return (
    <PigeonMap
      provider={gsiTileProvider}
      attribution={GSI_ATTRIBUTION}
      attributionPrefix={false}
      center={view.center}
      zoom={view.zoom}
      onBoundsChanged={({ center, zoom }) => setView({ center, zoom })}
    >
      {pins.map((pin) => {
        // renderPin (#885 slice 2): the view supplies the whole interactive pill
        // (price, onClick, aria-label) and the adapter only anchors it; without it,
        // fall back to the default marker dot wired to onSelect.
        const item = renderPin ? items.find((i) => i.location.locationId === pin.id) : undefined
        if (renderPin && item) {
          return (
            <Overlay key={pin.id} anchor={[pin.lat, pin.lng]}>
              {renderPin(item, { selected: pin.id === selectedId })}
            </Overlay>
          )
        }
        return (
          <Marker
            key={pin.id}
            anchor={[pin.lat, pin.lng]}
            color={pin.id === selectedId ? SELECTED_COLOR : MARKER_COLOR}
            onClick={() => onSelect(pin.id)}
          />
        )
      })}
      {selectedPin && selectedItem && renderSelected && (
        <Overlay anchor={[selectedPin.lat, selectedPin.lng]} offset={OVERLAY_OFFSET}>
          {renderSelected(selectedItem)}
        </Overlay>
      )}
    </PigeonMap>
  )
}
