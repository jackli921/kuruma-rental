import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type { AdminRevenueResponse } from '@kuruma/shared/types/admin-revenue'
import { queryOptions } from '@tanstack/react-query'

// Platform-admin partner revenue (#462, month filter #628). Cookie-based
// (credentials: 'include') so the API gates on the session role server-side
// (requirePlatformRead = STAFF/ADMIN/PLATFORM_ADMIN); the only query param is the
// optional JST `?month=YYYY-MM` payout-month filter. Mirrors operator-dashboard/api.ts.
export const ADMIN_REVENUE_QUERY_KEY = ['admin-revenue'] as const

export async function fetchAdminRevenue(month?: string): Promise<AdminRevenueResponse> {
  // Omit the param entirely for "all months" so the server returns the full matrix.
  const query = month ? `?month=${encodeURIComponent(month)}` : ''
  const res = await fetch(`${getApiBaseUrl()}/admin/revenue${query}`, {
    credentials: 'include',
  })
  return unwrap<AdminRevenueResponse>(res)
}

export function adminRevenueQueryOptions(month?: string) {
  return queryOptions({
    queryKey: [...ADMIN_REVENUE_QUERY_KEY, month ?? null],
    queryFn: () => fetchAdminRevenue(month),
  })
}
