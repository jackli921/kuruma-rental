import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { SearchResultsData } from '@kuruma/shared/types/search-result'
import { z } from 'zod'

// #711: a runtime mirror of the shared search-result contract. `satisfies
// z.ZodType<SearchResultsData>` pins it to that single-source type, so the schema
// can't fall out of sync without a compile error — while at runtime a drifted or
// dropped renter-safe field now fails as a ParseError at the seam instead of
// surfacing as `undefined` deep in the map/list.
const resultLocationSchema = z.object({
  locationId: z.string(),
  operatorId: z.string(),
  operatorName: z.string(),
  name: z.string(),
  address: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
})

const searchResultBase = {
  location: resultLocationSchema,
  dailyRateJpy: z.number().nullable(),
  hourlyRateJpy: z.number().nullable(),
  classLabel: z.string(),
  acrissCode: z.string().nullable(),
  seats: z.number(),
  photos: z.array(z.string()),
}

const searchResultsDataSchema = z.object({
  items: z.array(
    z.discriminatedUnion('kind', [
      z.object({
        kind: z.literal('SPECIFIC'),
        ...searchResultBase,
        vehicleId: z.string(),
        name: z.string(),
        make: z.string().nullable(),
        model: z.string().nullable(),
        year: z.number().nullable(),
        transmission: z.enum(['AUTO', 'MANUAL']),
      }),
      z.object({
        kind: z.literal('CLASS_COMBO'),
        ...searchResultBase,
        classId: z.string(),
        availableCount: z.number(),
      }),
    ]),
  ),
  nextCursor: z.string().nullable(),
}) satisfies z.ZodType<SearchResultsData>

// The cross-operator flat search result contract (#458) is the shared
// `@kuruma/shared/types/search-result` union — the same DTO the API service
// returns. `searchResultsDataSchema` above is the runtime mirror. The API
// serializes to JSON, so the payload carries no Date instances (range goes out
// as ISO).
export interface FlatSearchParams {
  from: Date
  to: Date
  /** Narrow to a single storefront. */
  pickupLocationId?: string
  /** Narrow to one operator's inventory. */
  operatorId?: string
  /** #651 Slice 3: filter to a region subtree (resolved from the URL slug to its id). */
  regionId?: string
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
  if (params.regionId) sp.set('regionId', params.regionId)
  for (const code of params.classes ?? []) sp.append('class', code)
  if (params.limit) sp.set('limit', String(params.limit))
  if (params.cursor) sp.set('cursor', params.cursor)

  const res = await fetch(`${getApiBaseUrl()}/search/vehicles?${sp.toString()}`, {
    credentials: 'include',
  })
  return unwrap(res, searchResultsDataSchema)
}
