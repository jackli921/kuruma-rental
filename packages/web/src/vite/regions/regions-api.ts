import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { RegionNode } from '@kuruma/shared/types/region'
import { queryOptions } from '@tanstack/react-query'

// #651: the public hierarchical region taxonomy (prefecture -> city -> area) the
// flat list GET /regions returns. Shared web data layer for both consumers — the
// operator location cascade (#651 Slice 2b) and the renter region picker (#651 Slice 3).
const ONE_HOUR_MS = 60 * 60 * 1000

export const REGIONS_QUERY_KEY = ['regions'] as const

export async function fetchRegions(): Promise<RegionNode[]> {
  // Public, unauthenticated read; credentials are harmless and keep one fetch shape.
  const res = await fetch(`${getApiBaseUrl()}/regions`, { credentials: 'include' })
  return unwrap<RegionNode[]>(res)
}

export function regionsQueryOptions() {
  return queryOptions({
    queryKey: REGIONS_QUERY_KEY,
    queryFn: fetchRegions,
    // Platform-global reference data the API already caches for an hour.
    staleTime: ONE_HOUR_MS,
  })
}
