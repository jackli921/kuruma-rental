import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { LocationOperatingHours } from '@kuruma/shared/types/location'
import type { CreateLocationInput } from '@kuruma/shared/validators/location'
import { queryOptions } from '@tanstack/react-query'

// #529: operator locations/storefronts management — Vite port of the frozen
// `modules/locations` admin. Cookie-based and operator-scoped server-side (the
// client passes NO operatorId, so a cross-tenant read is impossible here by
// construction), mirroring `operator-fleet`. Geocoding / lat-lng is out of scope
// for this slice — that is #531; the create/update validators on trunk carry no
// coordinate fields, so this DTO omits them too.

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
  createdAt: string
  updatedAt: string
}

export const LOCATIONS_QUERY_KEY = ['operator-locations'] as const

export async function fetchOperatorLocations(): Promise<OperatorLocation[]> {
  // includeArchived=true so the owner sees soft-archived rows (muted badge) and
  // can tell why a name is taken; archiving frees the name for active inventory.
  const res = await fetch(`${getApiBaseUrl()}/locations?includeArchived=true`, {
    credentials: 'include',
  })
  return unwrap<OperatorLocation[]>(res)
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

export async function createLocation(data: CreateLocationInput): Promise<OperatorLocation> {
  const res = await fetch(`${getApiBaseUrl()}/locations`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  })
  return unwrap<OperatorLocation>(res)
}
