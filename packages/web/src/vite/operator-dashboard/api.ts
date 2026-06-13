import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { OperatorOverview } from '@kuruma/shared/types/overview'
import { queryOptions } from '@tanstack/react-query'

// Operator dashboard overview (#524). Cookie-based (credentials: 'include') so
// the tenant is derived server-side from the session — never a query param.
// Mirrors operator-fleet/api.ts; deliberately does NOT touch the frozen Next
// `dashboard-stats.ts`, which hits the platform-wide X-API-Key /stats endpoint.
export const OPERATOR_OVERVIEW_QUERY_KEY = ['operator-overview'] as const

export async function fetchOperatorOverview(): Promise<OperatorOverview> {
  const res = await fetch(`${getApiBaseUrl()}/dashboard/overview`, {
    credentials: 'include',
  })
  return unwrap<OperatorOverview>(res)
}

export function operatorOverviewQueryOptions() {
  return queryOptions({
    queryKey: OPERATOR_OVERVIEW_QUERY_KEY,
    queryFn: fetchOperatorOverview,
  })
}
