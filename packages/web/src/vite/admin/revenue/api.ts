import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import type {
  AdminRevenueMonth,
  AdminRevenuePartner,
  AdminRevenueResponse,
  AdminRevenueTotals,
} from '@kuruma/shared/types/admin-revenue'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// Platform-admin partner revenue (#462, month filter #628). Cookie-based
// (credentials: 'include') so the API gates on the session role server-side
// (requirePlatformRead = STAFF/ADMIN/PLATFORM_ADMIN); the only query param is the
// optional JST `?month=YYYY-MM` payout-month filter. Mirrors operator-dashboard/api.ts.
export const ADMIN_REVENUE_QUERY_KEY = ['admin-revenue'] as const

// Network-seam validators for the revenue report (#711). Each level is pinned to
// its shared wire DTO with `satisfies` so a renamed/added figure fails typecheck
// here; a drifted runtime body (e.g. a yen total arriving as a string) then
// surfaces as a ParseError at the seam instead of a wrong/blank figure on the tab.
const adminRevenueMonthSchema = z.object({
  month: z.string(),
  grossJpy: z.number(),
  platformFeeJpy: z.number(),
  netToPartnerJpy: z.number(),
  paymentCount: z.number(),
}) satisfies z.ZodType<AdminRevenueMonth>

const adminRevenueTotalsSchema = z.object({
  grossJpy: z.number(),
  platformFeeJpy: z.number(),
  netToPartnerJpy: z.number(),
  paymentCount: z.number(),
}) satisfies z.ZodType<AdminRevenueTotals>

const adminRevenuePartnerSchema = z.object({
  operatorId: z.string(),
  operatorName: z.string(),
  operatorSlug: z.string(),
  grossJpy: z.number(),
  platformFeeJpy: z.number(),
  netToPartnerJpy: z.number(),
  paymentCount: z.number(),
  months: z.array(adminRevenueMonthSchema),
}) satisfies z.ZodType<AdminRevenuePartner>

const adminRevenueResponseSchema = z.object({
  partners: z.array(adminRevenuePartnerSchema),
  totals: adminRevenueTotalsSchema,
  availableMonths: z.array(z.string()),
  selectedMonth: z.string().nullable(),
}) satisfies z.ZodType<AdminRevenueResponse>

export async function fetchAdminRevenue(month?: string): Promise<AdminRevenueResponse> {
  // Omit the param entirely for "all months" so the server returns the full matrix.
  const query = month ? `?month=${encodeURIComponent(month)}` : ''
  const res = await fetch(`${getApiBaseUrl()}/admin/revenue${query}`, {
    credentials: 'include',
  })
  return unwrap(res, adminRevenueResponseSchema)
}

export function adminRevenueQueryOptions(month?: string) {
  return queryOptions({
    queryKey: [...ADMIN_REVENUE_QUERY_KEY, month ?? null],
    queryFn: () => fetchAdminRevenue(month),
  })
}
