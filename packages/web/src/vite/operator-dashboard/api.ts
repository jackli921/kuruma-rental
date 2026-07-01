import { unwrap } from '@/lib/api-error'
import { getApiBaseUrl } from '@/vite/api-base'
import { BOOKING_STATUSES } from '@kuruma/shared/enums'
import type { OperatorOverview, TodayBookingRow, TodayBuckets } from '@kuruma/shared/types/overview'
import { queryOptions } from '@tanstack/react-query'
import { z } from 'zod'

// Operator dashboard overview (#524). Cookie-based (credentials: 'include') so
// an operator session's tenant is derived server-side — never a query param.
// Mirrors operator-fleet/api.ts; deliberately does NOT touch the frozen Next
// `dashboard-stats.ts`, which hits the platform-wide X-API-Key /stats endpoint.
//
// #407 slice 4: a PLATFORM_ADMIN using the operator-context picker can narrow
// this cross-operator aggregate to one operator by appending `?operatorId=X`.
// Sent ONLY when an operator is picked — the endpoint is lenient (no param =
// aggregate), so `includeAll` (buildScopeParam) would be ignored noise here.
export const OPERATOR_OVERVIEW_QUERY_KEY = ['operator-overview'] as const

// Network-seam validator for the dashboard overview (#711). Pinned to
// OperatorOverview with `satisfies` so a renamed/added headline count fails to
// compile. All three are required non-null numbers (the repo coalesces to 0).
// #1102: one today-bucket row. Pinned to TodayBookingRow with `satisfies` so a
// drifted field fails to compile. Dates are ISO strings on the wire.
const todayBookingRowSchema = z.object({
  id: z.string(),
  bookingCode: z.string(),
  status: z.enum(BOOKING_STATUSES),
  startAt: z.string(),
  endAt: z.string(),
  vehicleId: z.string().nullable(),
  renterName: z.string().nullable(),
}) satisfies z.ZodType<TodayBookingRow>

const todayBucketsSchema = z.object({
  pickups: todayBookingRowSchema.array(),
  returns: todayBookingRowSchema.array(),
  overdue: todayBookingRowSchema.array(),
}) satisfies z.ZodType<TodayBuckets>

const operatorOverviewSchema = z.object({
  totalBookings: z.number(),
  activeVehicles: z.number(),
  upcomingBookings: z.number(),
  today: todayBucketsSchema,
}) satisfies z.ZodType<OperatorOverview>

export async function fetchOperatorOverview(pickedOperatorId?: string): Promise<OperatorOverview> {
  const qs = pickedOperatorId ? `?operatorId=${encodeURIComponent(pickedOperatorId)}` : ''
  const res = await fetch(`${getApiBaseUrl()}/dashboard/overview${qs}`, {
    credentials: 'include',
  })
  return unwrap(res, operatorOverviewSchema)
}

export function operatorOverviewQueryOptions(pickedOperatorId?: string) {
  return queryOptions({
    // Key on the picked operator so a context switch never serves another
    // tenant's cached overview; unpicked collapses to a shared 'all' entry.
    queryKey: [...OPERATOR_OVERVIEW_QUERY_KEY, pickedOperatorId ?? 'all'],
    queryFn: () => fetchOperatorOverview(pickedOperatorId),
  })
}
