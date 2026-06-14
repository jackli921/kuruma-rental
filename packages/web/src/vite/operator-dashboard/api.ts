import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { OperatorOverview } from '@kuruma/shared/types/overview'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// Operator dashboard overview (#524). Cookie-based (credentials: 'include') so
// the tenant is derived server-side from the session — never a query param.
// Mirrors operator-fleet/api.ts; deliberately does NOT touch the frozen Next
// `dashboard-stats.ts`, which hits the platform-wide X-API-Key /stats endpoint.
export const OPERATOR_OVERVIEW_QUERY_KEY = ['operator-overview'] as const

// Network-seam validator for the dashboard overview (#711). Pinned to
// OperatorOverview with `satisfies` so a renamed/added headline count fails to
// compile. All three are required non-null numbers (the repo coalesces to 0).
const operatorOverviewSchema = z.object({
  totalBookings: z.number(),
  activeVehicles: z.number(),
  upcomingBookings: z.number(),
}) satisfies z.ZodType<OperatorOverview>

export async function fetchOperatorOverview(): Promise<OperatorOverview> {
  const res = await fetch(`${getApiBaseUrl()}/dashboard/overview`, {
    credentials: 'include',
  })
  return unwrap(res, operatorOverviewSchema)
}

export function operatorOverviewQueryOptions() {
  return queryOptions({
    queryKey: OPERATOR_OVERVIEW_QUERY_KEY,
    queryFn: fetchOperatorOverview,
  })
}
