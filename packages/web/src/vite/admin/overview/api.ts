import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { AdminOverview } from '@kuruma/shared/types/admin-overview'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// Platform-owner home KPIs (#1087, epic #1075 slice 1). Cookie-based
// (credentials: 'include') so the API gates on the session role server-side
// (requirePlatformAdmin). No query params — the endpoint returns the six
// platform-wide figures. Mirrors revenue/api.ts.
export const ADMIN_OVERVIEW_QUERY_KEY = ['admin-overview'] as const

// Network-seam validator (#711 ratchet). `satisfies z.ZodType<AdminOverview>`
// pins it to the shared wire DTO so a renamed/added KPI fails typecheck HERE; a
// drifted runtime body (e.g. a yen total arriving as a string) then surfaces as a
// ParseError at the seam instead of a blank/NaN KPI card.
const adminOverviewSchema = z.object({
  bookings: z.number(),
  gmvJpy: z.number(),
  fleet: z.number(),
  operators: z.number(),
  unresolvedAnomalies: z.number(),
  pendingDocs: z.number(),
}) satisfies z.ZodType<AdminOverview>

export async function fetchAdminOverview(): Promise<AdminOverview> {
  const res = await fetch(`${getApiBaseUrl()}/admin/overview`, { credentials: 'include' })
  return unwrap(res, adminOverviewSchema)
}

export function adminOverviewQueryOptions() {
  return queryOptions({
    queryKey: ADMIN_OVERVIEW_QUERY_KEY,
    queryFn: fetchAdminOverview,
  })
}
