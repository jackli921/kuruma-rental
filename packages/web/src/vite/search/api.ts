import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { SearchResultsData } from '@kuruma/shared/types/search-result'

// The cross-operator flat search result contract (#458) is the shared
// `@kuruma/shared/types/search-result` union — the same DTO the API service
// returns, so there is no separate web mirror to drift. The API serializes to
// JSON, so the payload carries no Date instances (range goes out as ISO).
export interface FlatSearchParams {
  from: Date
  to: Date
  /** Narrow to a single storefront. */
  pickupLocationId?: string
  /** Narrow to one operator's inventory. */
  operatorId?: string
  /** ACRISS codes (repeatable `class` search param). */
  classes?: string[]
  limit?: number
  cursor?: string
}

// Public endpoint — no auth required. Anonymous renters browse every operator's
// inventory as one flat list; the API projects only renter-safe fields (D3).
export async function fetchSearchResults(params: FlatSearchParams): Promise<SearchResultsData> {
  const sp = new URLSearchParams()
  sp.set('from', params.from.toISOString())
  sp.set('to', params.to.toISOString())
  if (params.pickupLocationId) sp.set('pickupLocationId', params.pickupLocationId)
  if (params.operatorId) sp.set('operatorId', params.operatorId)
  for (const code of params.classes ?? []) sp.append('class', code)
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.cursor) sp.set('cursor', params.cursor)

  const res = await fetch(`${getApiBaseUrl()}/search/vehicles?${sp.toString()}`, {
    credentials: 'include',
  })
  return unwrap<SearchResultsData>(res)
}
