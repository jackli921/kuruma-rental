import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { RegionNode } from '@kuruma/shared/types/region'
import { queryOptions } from '@tanstack/react-query'

// #651 2b: the public hierarchical region taxonomy (prefecture -> city -> area) —
// the flat list GET /regions returns. Powers the operator location cascade now; the
// renter region picker (Slice 3) will reuse it, so lift this to a shared module when
// that second consumer lands (kept here, beside its only caller, until then).
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
