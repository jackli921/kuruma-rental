import type { RegionStatus } from '../enums'

/**
 * Region geo-matching (#651 Slice 1). Pure functions shared by the one-off
 * location→region backfill (this slice), the operator location-save suggestion
 * (Slice 2), and the renter "near me" labels (Slice 3). No DB, no I/O — the
 * decision is pure; the thin shell that reads/writes the DB lives in
 * `scripts/backfill-location-regions.ts` (Functional Core / Imperative Shell).
 *
 * Distances use the Haversine great-circle formula on WGS84 decimal degrees.
 * Kansai is small (the demo prefectures span ~80 km), so spherical-earth error
 * (<0.5%) is irrelevant to "which area is nearest".
 */

/** A WGS84 point in decimal degrees. */
export interface GeoPoint {
  latitude: number
  longitude: number
}

/** Minimal structural shape of a region needed to match a point to it. */
export interface RegionCandidate {
  id: string
  latitude: number | null
  longitude: number | null
  assignable: boolean
  status: RegionStatus
  /** Stable tiebreak when two assignable regions are equidistant. */
  sortOrder: number
}

/**
 * Cap on how far a point may sit from its nearest assignable area before we
 * decline to assign one (returning null instead of mis-assigning). Kansai's
 * assignable areas are dense city districts, so a legitimate pickup point is
 * always within a few km of its area centre; 100 km comfortably covers suburban
 * Kansai while rejecting other regions (Tokyo is ~400 km away).
 */
export const REGION_SANITY_RADIUS_KM = 100

const EARTH_RADIUS_KM = 6371
const DEG_TO_RAD = Math.PI / 180

/** Great-circle distance between two points, in kilometres. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = (b.latitude - a.latitude) * DEG_TO_RAD
  const dLng = (b.longitude - a.longitude) * DEG_TO_RAD
  const lat1 = a.latitude * DEG_TO_RAD
  const lat2 = b.latitude * DEG_TO_RAD
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(h))
}

// `Number.isFinite` over a bare `!== null` so a NaN/Infinity coordinate is
// rejected too, not just null — a non-finite latitude would make every haversine
// distance NaN and can never be selected, but the predicate should still tell the
// truth: a `GeoPoint` carries real, finite degrees.
function hasCoords(r: RegionCandidate): r is RegionCandidate & GeoPoint {
  return Number.isFinite(r.latitude) && Number.isFinite(r.longitude)
}

/**
 * The nearest assignable, ACTIVE, coordinate-bearing region to `point`, or null
 * when there is no point, no eligible region, or the closest one sits beyond
 * REGION_SANITY_RADIUS_KM. Ties break by sortOrder then id for determinism.
 *
 * The return is narrowed to `(T & GeoPoint)` (never just `T`): a match always has
 * finite coords, so callers can read `.latitude/.longitude` without a non-null `!`.
 */
export function nearestAssignableRegion<T extends RegionCandidate>(
  regions: readonly T[],
  point: GeoPoint | null,
): (T & GeoPoint) | null {
  if (point === null) return null

  let best: (T & GeoPoint) | null = null
  let bestKm = Number.POSITIVE_INFINITY
  for (const region of regions) {
    if (!region.assignable || region.status !== 'ACTIVE' || !hasCoords(region)) continue
    const km = haversineKm(point, region)
    if (km > REGION_SANITY_RADIUS_KM) continue
    if (km < bestKm || (km === bestKm && isPreferredTiebreak(region, best))) {
      best = region
      bestKm = km
    }
  }
  return best
}

function isPreferredTiebreak(candidate: RegionCandidate, current: RegionCandidate | null): boolean {
  if (current === null) return true
  if (candidate.sortOrder !== current.sortOrder) return candidate.sortOrder < current.sortOrder
  return candidate.id < current.id
}

/** A location considered by the backfill. */
export interface BackfillLocation {
  id: string
  latitude: number | null
  longitude: number | null
  regionId: string | null
  status: 'ACTIVE' | 'ARCHIVED'
}

export interface RegionBackfillPlan {
  /** Locations that should be updated to point at the named region. */
  assignments: readonly { locationId: string; regionId: string }[]
  /** ACTIVE, coord-bearing, region-less locations with no area within radius. */
  unassigned: readonly string[]
}

/**
 * Idempotent plan for assigning every ACTIVE location that has coordinates but
 * no region to its nearest assignable area. Already-assigned, archived, and
 * coordinate-less locations are left alone; far-away locations are reported in
 * `unassigned` rather than mis-assigned.
 */
export function planRegionBackfill(
  regions: readonly RegionCandidate[],
  locations: readonly BackfillLocation[],
): RegionBackfillPlan {
  const assignments: { locationId: string; regionId: string }[] = []
  const unassigned: string[] = []
  for (const loc of locations) {
    if (loc.regionId !== null || loc.status !== 'ACTIVE') continue
    if (loc.latitude === null || loc.longitude === null) continue
    const match = nearestAssignableRegion(regions, {
      latitude: loc.latitude,
      longitude: loc.longitude,
    })
    if (match === null) unassigned.push(loc.id)
    else assignments.push({ locationId: loc.id, regionId: match.id })
  }
  return { assignments, unassigned }
}
