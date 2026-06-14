import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { REGION_STATUSES, REGION_TYPES } from '@kuruma/shared/enums'
import type { RegionNode } from '@kuruma/shared/types/region'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// #651: the public hierarchical region taxonomy (prefecture -> city -> area) the
// flat list GET /regions returns. Shared web data layer for both consumers — the
// operator location cascade (#651 Slice 2b) and the renter region picker (#651 Slice 3).
const ONE_HOUR_MS = 60 * 60 * 1000

export const REGIONS_QUERY_KEY = ['regions'] as const

// Network-seam validator for one GET /regions node (#711). Pinned to RegionNode
// with `satisfies` so a taxonomy field drift fails to compile. Note the status
// domain is ACTIVE|INACTIVE (not ARCHIVED); createdAt/updatedAt are NOT projected.
const regionNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  nameEn: z.string(),
  nameJa: z.string(),
  nameZh: z.string(),
  sortOrder: z.number(),
  type: z.enum(REGION_TYPES).nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  assignable: z.boolean(),
  status: z.enum(REGION_STATUSES),
  slug: z.string().nullable(),
}) satisfies z.ZodType<RegionNode>

export async function fetchRegions(): Promise<RegionNode[]> {
  // Public, unauthenticated read; credentials are harmless and keep one fetch shape.
  const res = await fetch(`${getApiBaseUrl()}/regions`, { credentials: 'include' })
  return unwrap(res, regionNodeSchema.array())
}

export function regionsQueryOptions() {
  return queryOptions({
    queryKey: REGIONS_QUERY_KEY,
    queryFn: fetchRegions,
    // Platform-global reference data the API already caches for an hour.
    staleTime: ONE_HOUR_MS,
  })
}
