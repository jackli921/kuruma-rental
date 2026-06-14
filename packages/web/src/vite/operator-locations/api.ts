import { ApiError, unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { COORDINATE_SOURCES, LOCATION_STATUSES } from '@kuruma/shared/enums'
import type { ApiResponse } from '@kuruma/shared/types/api-response'
import type { LocationOperatingHours } from '@kuruma/shared/types/location'
import type { CreateLocationInput, UpdateLocationInput } from '@kuruma/shared/validators/location'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// #529: operator locations/storefronts management — Vite port of the frozen
// `modules/locations` admin. Cookie-based and operator-scoped server-side (the
// client passes NO operatorId, so a cross-tenant read is impossible here by
// construction), mirroring `operator-fleet`. Write inputs carry no coordinate
// fields — provenance is server-derived (#531). The DTO surfaces the read-only
// `coordinateSource` so the list can flag a missing or pending map pin (#601);
// lat/lng stay omitted until a map view needs them.

/** JSON-serialized Location — dates arrive as ISO strings from the API. */
export interface OperatorLocation {
  id: string
  operatorId: string
  name: string
  address: string
  operatingHours: LocationOperatingHours
  timezone: string
  defaultTurnaroundMinutes: number
  status: 'ACTIVE' | 'ARCHIVED'
  // Server-derived geocoding provenance (#531/#601): GEOCODED/MANUAL = a usable
  // pin; PENDING = a throttle-skipped retry (#574); null = no pin found. Drives
  // the list's pin-state badge.
  coordinateSource: 'GEOCODED' | 'MANUAL' | 'PENDING' | null
  // #651 2b: the assigned region (deepest AREA node id) or null when unassigned.
  // Prefills the location form's prefecture->city->area cascade on edit; the
  // server loop guard derives one from the address when the operator leaves it null.
  regionId: string | null
  createdAt: string
  updatedAt: string
}

// Network-seam validator for the read/write shape above (#711). Pinned to
// OperatorLocation with `satisfies` so a field drift fails to compile here, not
// silently in render. Non-strict, so the wire's server-only latitude/longitude
// (#531) are dropped — the DTO deliberately omits them until a map view needs them.
const locationSchema = z.object({
  id: z.string(),
  operatorId: z.string(),
  name: z.string(),
  address: z.string(),
  operatingHours: z.object({ openTime: z.string(), closeTime: z.string() }).nullable(),
  timezone: z.string(),
  defaultTurnaroundMinutes: z.number(),
  status: z.enum(LOCATION_STATUSES),
  coordinateSource: z.enum(COORDINATE_SOURCES).nullable(),
  regionId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
}) satisfies z.ZodType<OperatorLocation>

export const LOCATIONS_QUERY_KEY = ['operator-locations'] as const

export async function fetchOperatorLocations(): Promise<OperatorLocation[]> {
  // includeArchived=true so the owner sees soft-archived rows (muted badge) and
  // can tell why a name is taken; archiving frees the name for active inventory.
  //
  // includeAll=true (#435): the `_business` guard admits bypass-scope roles
  // (STAFF/ADMIN/PLATFORM_ADMIN) too, and GET /locations 400s for them unless
  // they opt into a cross-operator read — without this they'd hit the load-error
  // state. Operator-scoped callers auto-scope server-side via the session cookie
  // and the API IGNORES this flag for them, so it's safe to always send (the
  // client still names no operatorId, so an operator's read stays tenant-scoped).
  const res = await fetch(`${getApiBaseUrl()}/locations?includeArchived=true&includeAll=true`, {
    credentials: 'include',
  })
  return unwrap(res, locationSchema.array())
}

export function operatorLocationsQueryOptions() {
  return queryOptions({
    queryKey: LOCATIONS_QUERY_KEY,
    queryFn: fetchOperatorLocations,
  })
}

// --- Mutations (cookie-based; operator-scoped server-side) --------------------
// The client never names a tenant — the session cookie scopes the write. unwrap
// throws ApiError on a failure body, so a 409 duplicate name reaches the
// dialog's useMutation onError with its message intact, mirroring operator-fleet.

async function writeJson(
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
): Promise<OperatorLocation> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return unwrap(res, locationSchema)
}

export function createLocation(data: CreateLocationInput): Promise<OperatorLocation> {
  return writeJson('/locations', 'POST', data)
}

export function updateLocation(id: string, data: UpdateLocationInput): Promise<OperatorLocation> {
  return writeJson(`/locations/${encodeURIComponent(id)}`, 'PATCH', data)
}

/**
 * Thrown when an archive is refused because the location still backs live
 * bookings (#412). Carries the count so the dialog can prompt the owner to
 * reassign/cancel first — the generic {@link ApiError} can't, as `unwrap`
 * discards the `activeBookingsCount` discriminator.
 */
export class LocationArchiveBlockedError extends Error {
  readonly name = 'LocationArchiveBlockedError'
  readonly activeBookingsCount: number

  constructor(activeBookingsCount: number) {
    super('Cannot archive a location with active bookings')
    this.activeBookingsCount = activeBookingsCount
  }
}

// DELETE soft-archives (status -> ARCHIVED). The body is read once and routed:
// the active-bookings 409 becomes a typed error carrying the count; anything
// else collapses to the generic ApiError (same contract as `unwrap`).
export async function archiveLocation(id: string): Promise<OperatorLocation> {
  const res = await fetch(`${getApiBaseUrl()}/locations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  })
  const body = (await res.json().catch(() => ({
    success: false as const,
    error: `Non-JSON response (HTTP ${res.status})`,
  }))) as ApiResponse<OperatorLocation> & { activeBookingsCount?: number }

  if (body.success) return body.data
  if (body.code === 'LOCATION_HAS_ACTIVE_BOOKINGS') {
    throw new LocationArchiveBlockedError(body.activeBookingsCount ?? 0)
  }
  throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status)
}
