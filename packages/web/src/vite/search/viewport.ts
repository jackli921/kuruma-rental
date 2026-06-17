/** A geocoded map pin (a result location with real coordinates). */
export interface Pin {
  id: string
  lat: number
  lng: number
}

/** Osaka centroid — viewport fallback when no pin has coordinates. */
export const OSAKA_FALLBACK: [number, number] = [34.6937, 135.5023]
/** Zoom for a single store / a tight cluster (neighborhood level). */
export const SINGLE_PIN_ZOOM = 12
/** Zoom when a region is chosen (#840). City level — deliberately broader than a
 *  single store, since a region (area/city/prefecture) frames an area, not a point. */
export const REGION_ZOOM = 11

/**
 * Fit all pins in view (#458). Centers on the bounding-box midpoint — NOT the
 * first pin, which on a Kansai-wide result set (Osaka/Kyoto/Nara/KIX) pushed most
 * markers off-screen and made the map read as "only one area has cars". Zoom steps
 * out as the span grows. Uncontrolled (`defaultCenter`/`defaultZoom`) so the user
 * can still pan/zoom; the adapter re-fits on a new result set via a remount key.
 *
 * When a region `anchor` ([lat, lng]) is given (#840), center on it at `REGION_ZOOM`
 * instead — a chosen area wins over the pin spread, so the renter lands on the place
 * they picked even if the geocoded results sprawl. A null anchor (no region, or a
 * coord-less region) keeps the fit-all-pins behavior.
 */
export function computeViewport(
  pins: Pin[],
  anchor: [number, number] | null = null,
): { center: [number, number]; zoom: number } {
  if (anchor !== null) return { center: anchor, zoom: REGION_ZOOM }
  if (pins.length === 0) return { center: OSAKA_FALLBACK, zoom: 11 }

  let minLat = Number.POSITIVE_INFINITY
  let maxLat = Number.NEGATIVE_INFINITY
  let minLng = Number.POSITIVE_INFINITY
  let maxLng = Number.NEGATIVE_INFINITY
  for (const { lat, lng } of pins) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lng < minLng) minLng = lng
    if (lng > maxLng) maxLng = lng
  }

  const center: [number, number] = [(minLat + maxLat) / 2, (minLng + maxLng) / 2]
  const span = Math.max(maxLat - minLat, maxLng - minLng)
  return { center, zoom: zoomForSpan(span) }
}

/** Viewport when a result is selected: center on its pin at a close zoom so the
 *  renter sees exactly where that car is picked up. The selection wins over the
 *  fit-all / region-anchor viewport; with nothing selected (or an unknown id) it
 *  defers to computeViewport. Pure. */
export function focusViewport(
  pins: Pin[],
  anchor: [number, number] | null,
  selectedId: string | null,
): { center: [number, number]; zoom: number } {
  const selected = selectedId === null ? null : (pins.find((p) => p.id === selectedId) ?? null)
  if (selected) return { center: [selected.lat, selected.lng], zoom: SINGLE_PIN_ZOOM }
  return computeViewport(pins, anchor)
}

/** Map a lat/lng degree span to a Web-Mercator zoom that keeps it in frame.
 *  Heuristic tiers (one step per ~2x span); the test pins the monotonic property,
 *  not the exact breakpoints. */
function zoomForSpan(span: number): number {
  if (span <= 0.02) return SINGLE_PIN_ZOOM
  if (span <= 0.06) return 11
  if (span <= 0.12) return 10
  if (span <= 0.25) return 9
  if (span <= 0.6) return 8
  if (span <= 1.2) return 7
  return 6
}
