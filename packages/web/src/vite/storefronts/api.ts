import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import {
  type StorefrontDetailData,
  type StorefrontSearchResultData,
  storefrontDetailResultSchema,
  storefrontSearchResultSchema,
} from '@/vite/storefronts/schema'

// JSON-serialized shapes returned by the public storefront endpoints (#391) are
// defined as Zod schemas in ./schema (the #711/#785 convention) and inferred into
// the DTO types re-exported below, so existing consumers keep importing them from
// this client. The API serializes everything to JSON, so there are no Date
// instances. This module supersedes `modules/storefronts/api.ts` — delete that
// file at cutover (#378).
export type {
  AvailableVehicleData,
  ClassSummaryData,
  OperatingHoursData,
  StorefrontCardData,
  StorefrontDetailData,
  StorefrontSearchResultData,
  StorefrontSummaryData,
} from '@/vite/storefronts/schema'

export interface StorefrontSearchParams {
  from: Date
  to: Date
  /** Narrow to a single storefront. */
  pickupLocationId?: string
  /** #651 Slice 3: filter to a region subtree (resolved from the URL slug to its id). */
  regionId?: string
  /** ACRISS codes (repeatable `class` search param). */
  classes?: string[]
  limit?: number
  cursor?: string
}

export interface StorefrontDetailParams {
  from: Date
  to: Date
  classes?: string[]
  limit?: number
  cursor?: string
}

// Date range + ACRISS filter + cursor pagination are shared by both endpoints.
// Repeatable `class` is appended (not set) so multiple codes survive.
function commonSearchParams(params: {
  from: Date
  to: Date
  classes?: string[]
  limit?: number
  cursor?: string
}): URLSearchParams {
  const sp = new URLSearchParams()
  sp.set('from', params.from.toISOString())
  sp.set('to', params.to.toISOString())
  for (const code of params.classes ?? []) sp.append('class', code)
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.cursor) sp.set('cursor', params.cursor)
  return sp
}

// Public endpoint — no auth required. Anonymous renters browse every operator's
// stores; the API projects only renter-safe fields.
export async function fetchStorefronts(
  params: StorefrontSearchParams,
): Promise<StorefrontSearchResultData> {
  const sp = commonSearchParams(params)
  if (params.pickupLocationId) sp.set('pickupLocationId', params.pickupLocationId)
  if (params.regionId) sp.set('regionId', params.regionId)
  const res = await fetch(`${getApiBaseUrl()}/storefronts/search?${sp.toString()}`, {
    credentials: 'include',
  })
  return unwrap(res, storefrontSearchResultSchema)
}

// Public endpoint — returns null on 404 (unknown/archived store) so the route
// renders notFound() rather than an error boundary. A known-but-full store
// returns 200 with an empty vehicles array, not 404.
export async function fetchStorefrontDetail(
  locationId: string,
  params: StorefrontDetailParams,
): Promise<StorefrontDetailData | null> {
  const sp = commonSearchParams(params)
  const res = await fetch(
    `${getApiBaseUrl()}/storefronts/${encodeURIComponent(locationId)}/vehicles?${sp.toString()}`,
    { credentials: 'include' },
  )
  if (res.status === 404) return null
  return unwrap(res, storefrontDetailResultSchema)
}
