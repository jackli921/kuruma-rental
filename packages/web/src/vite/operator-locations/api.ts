import { ApiError, unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { type WithOperatorId, buildScopeParam } from '@/vite/operator-context'
import { COORDINATE_SOURCES, LOCATION_STATUSES } from '@kuruma/shared/enums'
import type { ApiResponse } from '@kuruma/shared/types/api-response'
import type { LocationOperatingHours } from '@kuruma/shared/types/location'
import type { CreateLocationInput, UpdateLocationInput } from '@kuruma/shared/validators/location'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// Canonical write types come from @kuruma/shared so the form/dialog stay in
// lockstep with the Zod validators rather than drifting a parallel copy.
export type { CreateLocationInput, UpdateLocationInput }

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

export async function fetchOperatorLocations(
  pickedOperatorId?: string,
): Promise<OperatorLocation[]> {
  // includeArchived=true so the owner sees soft-archived rows (muted badge) and
  // can tell why a name is taken; archiving frees the name for active inventory.
  //
  // The scope param is `operatorId=<picked>` when an admin has picked a tenant,
  // else `includeAll=true` (#435): the `_business` guard admits bypass-scope roles
  // (STAFF/ADMIN/PLATFORM_ADMIN) too, and GET /locations 400s for them unless
  // they opt into a cross-operator read — without this they'd hit the load-error
  // state. Operator-scoped callers auto-scope server-side via the session cookie
  // and the API IGNORES the flag for them, so it's safe to always send (the
  // client still names no operatorId, so an operator's read stays tenant-scoped).
  const res = await fetch(
    `${getApiBaseUrl()}/locations?includeArchived=true&${buildScopeParam(pickedOperatorId)}`,
    { credentials: 'include' },
  )
  return unwrap(res, locationSchema.array())
}

// The picked operator id is part of the cache key so switching context refetches
// (and never serves another tenant's cached list). Optional param keeps any
// no-arg caller working.
export function operatorLocationsQueryOptions(pickedOperatorId?: string) {
  return queryOptions({
    queryKey: [...LOCATIONS_QUERY_KEY, pickedOperatorId ?? 'all'] as const,
    queryFn: () => fetchOperatorLocations(pickedOperatorId),
  })
}

// --- Mutations (cookie-based, CSRF-gated; operator-scoped server-side) ---------
// The global csrf() middleware rejects any cookie-authenticated mutation that
// omits a matching X-CSRF-Token (middleware/csrf.ts), so every write threads the
// session's csrfToken. The client never names a tenant — the session cookie
// scopes the write. unwrap throws ApiError on a failure body, so a 409 duplicate
// name reaches the dialog's useMutation onError with its message intact.

async function writeJson(
  path: string,
  method: 'POST' | 'PATCH',
  body: unknown,
  csrfToken: string,
): Promise<OperatorLocation> {
  const res = await fetch(`${getApiBaseUrl()}${path}`, {
    method,
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
    body: JSON.stringify(body),
  })
  return unwrap(res, locationSchema)
}

// A platform admin operating as a picked tenant names the target operator in the
// body (the server's platform-admin create schema requires it); an operator
// session omits it and is auto-scoped server-side. PATCH/DELETE are id-scoped.
export function createLocation(
  data: WithOperatorId<CreateLocationInput>,
  csrfToken: string,
): Promise<OperatorLocation> {
  return writeJson('/locations', 'POST', data, csrfToken)
}

export function updateLocation(
  id: string,
  data: UpdateLocationInput,
  csrfToken: string,
): Promise<OperatorLocation> {
  return writeJson(`/locations/${encodeURIComponent(id)}`, 'PATCH', data, csrfToken)
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
// else collapses to the generic ApiError (same contract as `unwrap`). The CSRF
// header still rides along because a cookie-authed DELETE is a mutation the guard
// protects.
export async function archiveLocation(id: string, csrfToken: string): Promise<OperatorLocation> {
  const res = await fetch(`${getApiBaseUrl()}/locations/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-CSRF-Token': csrfToken },
  })
  const body = (await res.json().catch(() => ({
    success: false as const,
    error: `Non-JSON response (HTTP ${res.status})`,
  }))) as ApiResponse<OperatorLocation> & { activeBookingsCount?: number }

  if (body.success) return body.data
  if (body.code === 'LOCATION_HAS_ACTIVE_BOOKINGS') {
    throw new LocationArchiveBlockedError(body.activeBookingsCount ?? 0)
  }
  // Preserve the envelope `code` like `unwrap` does, so a non-active-bookings
  // failure stays discriminable by code rather than collapsing to a message (#934).
  throw new ApiError(body.error ?? `HTTP ${res.status}`, res.status, body.code)
}
