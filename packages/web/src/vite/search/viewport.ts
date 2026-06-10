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

/**
 * Fit all pins in view (#458). Centers on the bounding-box midpoint — NOT the
 * first pin, which on a Kansai-wide result set (Osaka/Kyoto/Nara/KIX) pushed most
 * markers off-screen and made the map read as "only one area has cars". Zoom steps
 * out as the span grows. Uncontrolled (`defaultCenter`/`defaultZoom`) so the user
 * can still pan/zoom; the adapter re-fits on a new result set via a remount key.
 */
export function computeViewport(pins: Pin[]): { center: [number, number]; zoom: number } {
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
