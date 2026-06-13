import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { AdminRevenueReport } from '@kuruma/shared/types/admin-revenue'
import { queryOptions } from '@tanstack/react-query'

// Platform-admin partner revenue (#462). Cookie-based (credentials: 'include')
// so the API gates on the session role server-side (requirePlatformRead =
// STAFF/ADMIN/PLATFORM_ADMIN); never a query param. Mirrors operator-dashboard/api.ts.
export const ADMIN_REVENUE_QUERY_KEY = ['admin-revenue'] as const

export async function fetchAdminRevenue(): Promise<AdminRevenueReport> {
  const res = await fetch(`${getApiBaseUrl()}/admin/revenue`, {
    credentials: 'include',
  })
  return unwrap<AdminRevenueReport>(res)
}

export function adminRevenueQueryOptions() {
  return queryOptions({
    queryKey: ADMIN_REVENUE_QUERY_KEY,
    queryFn: fetchAdminRevenue,
  })
}
