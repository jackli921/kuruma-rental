import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { LocationOperatingHours } from '@kuruma/shared/types/location'
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
